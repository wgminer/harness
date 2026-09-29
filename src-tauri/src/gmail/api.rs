//! Thin Gmail REST client (users/me) on top of the cached OAuth access token.

use std::time::Duration;

use reqwest::{Client, Method};
use serde_json::Value;

use super::auth::access_token;

const API_BASE: &str = "https://gmail.googleapis.com/gmail/v1/users/me";

async fn request(method: Method, path: &str, query: &[(&str, String)], body: Option<&Value>) -> Result<Value, String> {
    let token = access_token().await?;
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client
        .request(method, format!("{API_BASE}{path}"))
        .bearer_auth(token)
        .query(query);
    if let Some(body) = body {
        req = req.json(body);
    }
    let res = req.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.pointer("/error/message")?.as_str().map(str::to_string))
            .unwrap_or(text);
        return Err(format!("Gmail API error ({status}): {message}"));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

pub async fn get(path: &str, query: &[(&str, String)]) -> Result<Value, String> {
    request(Method::GET, path, query, None).await
}

pub async fn post(path: &str, body: &Value) -> Result<Value, String> {
    request(Method::POST, path, &[], Some(body)).await
}

pub async fn profile_email() -> Result<String, String> {
    let profile = get("/profile", &[]).await?;
    profile
        .get("emailAddress")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "Gmail profile had no email address.".into())
}
