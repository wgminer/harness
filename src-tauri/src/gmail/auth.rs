//! Google OAuth for Gmail: installed-app loopback flow with PKCE, refresh token
//! in the credential store, short-lived access token cached in memory.

use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

use crate::credentials::{delete_credential, get_credential, set_credential, CredentialKey};

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// Read, compose, send, and label. Excludes permanent delete.
const SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
const CONSENT_TIMEOUT: Duration = Duration::from_secs(300);
/// Refresh a little early so a token never expires mid-request.
const EXPIRY_SLACK: Duration = Duration::from_secs(60);

struct CachedToken {
    access_token: String,
    expires_at: Instant,
}

fn token_cache() -> &'static Mutex<Option<CachedToken>> {
    static CACHE: OnceLock<Mutex<Option<CachedToken>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
}

pub struct ClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

pub fn client_config() -> Option<ClientConfig> {
    Some(ClientConfig {
        client_id: get_credential(CredentialKey::GoogleClientId)?,
        client_secret: get_credential(CredentialKey::GoogleClientSecret).unwrap_or_default(),
    })
}

pub fn is_connected() -> bool {
    get_credential(CredentialKey::GmailRefreshToken).is_some()
}

fn random_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

fn cached_from(resp: &TokenResponse) -> CachedToken {
    let ttl = Duration::from_secs(resp.expires_in.unwrap_or(3600));
    CachedToken {
        access_token: resp.access_token.clone(),
        expires_at: Instant::now() + ttl.saturating_sub(EXPIRY_SLACK),
    }
}

async fn post_token(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = http_client()?
        .post(TOKEN_URL)
        .form(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Google token request failed ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Parse `GET /path?query HTTP/1.1` into its query pairs.
fn parse_request_query(request: &str) -> Option<Vec<(String, String)>> {
    let target = request.lines().next()?.split_whitespace().nth(1)?;
    let url = url::Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    Some(url.query_pairs().into_owned().collect())
}

async fn respond(stream: &mut tokio::net::TcpStream, message: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Harness</title>\
<body style=\"font:15px -apple-system,sans-serif;padding:48px\">{message}</body>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

/// Accept loopback requests until one carries the OAuth callback (skips favicon etc.).
async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> Result<String, String> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let Some(params) = parse_request_query(&request) else {
            respond(&mut stream, "").await;
            continue;
        };
        let get = |key: &str| params.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        if let Some(err) = get("error") {
            respond(&mut stream, "Gmail was not connected. You can close this tab.").await;
            return Err(format!("Google sign-in was cancelled ({err})."));
        }
        let Some(code) = get("code") else {
            respond(&mut stream, "").await;
            continue;
        };
        if get("state").as_deref() != Some(expected_state) {
            respond(&mut stream, "Sign-in state did not match. Try again from Harness.").await;
            return Err("OAuth state mismatch.".into());
        }
        respond(&mut stream, "Gmail is connected. You can close this tab and return to Harness.").await;
        return Ok(code);
    }
}

/// Run the browser consent flow and store the refresh token. `open_url` launches the
/// system browser (injected so this module stays independent of Tauri).
pub async fn connect(open_url: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    let config = client_config()
        .ok_or("Add your Google OAuth client ID in Settings before connecting Gmail.")?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let verifier = random_urlsafe(48);
    let state = random_urlsafe(16);
    let mut auth = url::Url::parse(AUTH_URL).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", SCOPE)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge", &pkce_challenge(&verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state);
    open_url(auth.as_str())?;

    let code = tokio::time::timeout(CONSENT_TIMEOUT, wait_for_code(&listener, &state))
        .await
        .map_err(|_| "Timed out waiting for Google sign-in.".to_string())??;

    let tokens = post_token(&[
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("code", code.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect_uri.as_str()),
    ])
    .await?;
    let refresh = tokens
        .refresh_token
        .as_deref()
        .ok_or("Google did not return a refresh token. Remove Harness at myaccount.google.com/permissions and connect again.")?;
    set_credential(CredentialKey::GmailRefreshToken, refresh).map_err(|e| e.to_string())?;
    *token_cache().lock().await = Some(cached_from(&tokens));
    Ok(())
}

/// Revoke the grant (best effort) and forget all stored tokens.
pub async fn disconnect() -> Result<(), String> {
    if let Some(refresh) = get_credential(CredentialKey::GmailRefreshToken) {
        if let Ok(client) = http_client() {
            let _ = client.post(REVOKE_URL).form(&[("token", refresh)]).send().await;
        }
    }
    *token_cache().lock().await = None;
    delete_credential(CredentialKey::GmailRefreshToken).map_err(|e| e.to_string())?;
    delete_credential(CredentialKey::GmailAccountEmail).map_err(|e| e.to_string())?;
    Ok(())
}

/// A valid access token, refreshing from the stored refresh token when needed.
pub async fn access_token() -> Result<String, String> {
    let mut cache = token_cache().lock().await;
    if let Some(cached) = cache.as_ref() {
        if Instant::now() < cached.expires_at {
            return Ok(cached.access_token.clone());
        }
    }
    let refresh = get_credential(CredentialKey::GmailRefreshToken)
        .ok_or("Gmail is not connected. Connect it in Settings > Data.")?;
    let config = client_config().ok_or("Google OAuth client ID is missing in Settings.")?;
    let tokens = post_token(&[
        ("client_id", config.client_id.as_str()),
        ("client_secret", config.client_secret.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ])
    .await?;
    *cache = Some(cached_from(&tokens));
    Ok(tokens.access_token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_callback_query() {
        let req = "GET /?state=abc&code=4%2F0Ab&scope=x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        let params = parse_request_query(req).unwrap();
        assert!(params.contains(&("code".into(), "4/0Ab".into())));
        assert!(params.contains(&("state".into(), "abc".into())));
    }

    #[test]
    fn pkce_challenge_matches_rfc7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
