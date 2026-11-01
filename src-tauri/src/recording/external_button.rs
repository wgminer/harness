//! Home Assistant Voice PE centre button as a stand-in for the Fn key.
//!
//! Harness holds the ESPHome native API connection itself (encrypted, port
//! 6053) and feeds button edges into the same path as Fn. Host and the enable
//! switch are per profile (`external-button.json`), so Harness and Harness Dev
//! do not both claim the button; the encryption key lives in the credential
//! store. The LED ring follows the tray icon: dim when ready, red while
//! recording, pulsing while the take is processed.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use esphome_client::error::ClientError;
use esphome_client::types::{
    DisconnectResponse, EspHomeMessage, LightCommandRequest, ListEntitiesRequest, PingRequest,
    SubscribeStatesRequest,
};
use esphome_client::{EspHomeClient, EspHomeClientWriteStream};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::credentials::{get_credential, set_credential, CredentialKey};
use crate::paths::get_app_state_dir;
use crate::recording::global::{dispatch_fn_edge, GlobalRecordingRuntime};
use crate::recording::global_effects::TrayIconState;

const DEFAULT_HOST: &str = "voicepe.local";
const API_PORT: u16 = 6053;
const BUTTON_NAME: &str = "Center button";
const BUTTON_OBJECT_ID: &str = "center_button";
const RING_NAME: &str = "LED ring";
const RING_OBJECT_ID: &str = "led_ring";
/// Effect name from the firmware's `led_ring` light.
const RING_PULSE: &str = "Pulse";
const RING_OFF_TIMEOUT: Duration = Duration::from_millis(500);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Quiet this long and we ping; quiet for two in a row and the device is gone.
const PING_INTERVAL: Duration = Duration::from_secs(20);
const MIN_RETRY: Duration = Duration::from_secs(2);
const MAX_RETRY: Duration = Duration::from_secs(30);
const STATUS_EVENT: &str = "external-button-status";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    enabled: bool,
    host: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            host: DEFAULT_HOST.to_string(),
        }
    }
}

fn config_path() -> std::path::PathBuf {
    get_app_state_dir().join("external-button.json")
}

fn load_config() -> Config {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_config(config: &Config) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(config_path(), raw).map_err(|e| e.to_string())
}

fn stored_key() -> Option<String> {
    get_credential(CredentialKey::ExternalButtonKey).filter(|k| !k.trim().is_empty())
}

/// ESPHome API keys are 32 random bytes, base64 encoded.
fn validate_key(key: &str) -> Result<(), String> {
    match base64::engine::general_purpose::STANDARD.decode(key) {
        Ok(bytes) if bytes.len() == 32 => Ok(()),
        _ => Err("The encryption key should be the 44-character api_key from the device config.".into()),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Off,
    Searching,
    Connected,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalButtonStatus {
    pub enabled: bool,
    pub host: String,
    pub key_configured: bool,
    pub state: ConnectionState,
    pub message: Option<String>,
}

/// What the LED ring shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Ring {
    Off,
    Ready,
    Recording,
    Processing,
}

struct Inner {
    config: Config,
    state: ConnectionState,
    message: Option<String>,
    cancel: Option<CancellationToken>,
    /// Writer and light key of the live connection, to switch the ring off on quit.
    ring: Option<(EspHomeClientWriteStream, u32)>,
}

pub struct ExternalButton {
    runtime: Arc<GlobalRecordingRuntime>,
    inner: Mutex<Inner>,
    activity: watch::Sender<Ring>,
}

impl ExternalButton {
    pub fn new(runtime: Arc<GlobalRecordingRuntime>) -> Arc<Self> {
        Arc::new(Self {
            runtime,
            inner: Mutex::new(Inner {
                config: load_config(),
                state: ConnectionState::Off,
                message: None,
                cancel: None,
                ring: None,
            }),
            activity: watch::channel(Ring::Ready).0,
        })
    }

    /// Mirrors a tray icon change on the ring, whether or not a device is connected.
    pub fn show_activity(app: &AppHandle, state: TrayIconState) {
        let Some(button) = app.try_state::<Arc<ExternalButton>>() else {
            return;
        };
        button.activity.send_replace(match state {
            TrayIconState::Ready => Ring::Ready,
            TrayIconState::Recording => Ring::Recording,
            TrayIconState::Processing => Ring::Processing,
        });
    }

    /// Switches the ring off before the app quits so it does not stay lit.
    pub fn shutdown(&self) {
        let Some((writer, key)) = self.inner.lock().unwrap().ring.take() else {
            return;
        };
        tauri::async_runtime::block_on(async {
            let _ = tokio::time::timeout(
                RING_OFF_TIMEOUT,
                writer.try_write(ring_command(key, Ring::Off)),
            )
            .await;
        });
    }

    pub fn status(&self) -> ExternalButtonStatus {
        let inner = self.inner.lock().unwrap();
        ExternalButtonStatus {
            enabled: inner.config.enabled,
            host: inner.config.host.clone(),
            key_configured: stored_key().is_some(),
            state: inner.state,
            message: inner.message.clone(),
        }
    }

    /// Saves the settings and reconnects. An empty `key` keeps the stored one.
    pub fn configure(
        self: &Arc<Self>,
        app: &AppHandle,
        enabled: bool,
        host: &str,
        key: Option<&str>,
    ) -> Result<ExternalButtonStatus, String> {
        if let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) {
            validate_key(key)?;
            set_credential(CredentialKey::ExternalButtonKey, key).map_err(|e| e.to_string())?;
        }
        let host = host.trim();
        let config = Config {
            enabled,
            host: if host.is_empty() { DEFAULT_HOST.to_string() } else { host.to_string() },
        };
        save_config(&config)?;
        self.inner.lock().unwrap().config = config;
        self.restart(app);
        Ok(self.status())
    }

    /// Stops any running connection and starts a new one if enabled.
    pub fn restart(self: &Arc<Self>, app: &AppHandle) {
        let (config, previous) = {
            let mut inner = self.inner.lock().unwrap();
            (inner.config.clone(), inner.cancel.take())
        };
        if let Some(cancel) = previous {
            cancel.cancel();
        }
        let key = stored_key();
        let Some(key) = key.filter(|_| config.enabled) else {
            let message = config.enabled.then(|| "Add the encryption key to connect.".to_string());
            let state = if config.enabled { ConnectionState::Error } else { ConnectionState::Off };
            self.set_state(app, state, message);
            return;
        };
        let cancel = CancellationToken::new();
        self.inner.lock().unwrap().cancel = Some(cancel.clone());
        tauri::async_runtime::spawn(run(app.clone(), self.clone(), config.host, key, cancel));
    }

    fn set_state(&self, app: &AppHandle, state: ConnectionState, message: Option<String>) {
        {
            let mut inner = self.inner.lock().unwrap();
            if inner.state == state && inner.message == message {
                return;
            }
            inner.state = state;
            inner.message = message;
        }
        let _ = app.emit(STATUS_EVENT, self.status());
    }
}

enum Ended {
    /// Was connected, then the connection dropped.
    Dropped,
    /// Could not reach the device (unplugged, asleep, off the network).
    Unreachable,
    /// Reached the device but cannot use it (wrong key, missing button).
    Failed(String),
}

async fn run(
    app: AppHandle,
    button: Arc<ExternalButton>,
    host: String,
    key: String,
    cancel: CancellationToken,
) {
    let held = AtomicBool::new(false);
    let mut retry = MIN_RETRY;
    button.set_state(&app, ConnectionState::Searching, None);
    loop {
        let ended = tokio::select! {
            _ = cancel.cancelled() => None,
            ended = session(&app, &button, &host, &key, &held, &cancel) => Some(ended),
        };
        // Losing the connection mid-press must not leave a recording running.
        if held.swap(false, Ordering::SeqCst) {
            dispatch_fn_edge(&app, &button.runtime, "up", now_ms()).await;
        }
        let Some(ended) = ended else {
            return;
        };
        match ended {
            Ended::Dropped => {
                retry = MIN_RETRY;
                button.set_state(&app, ConnectionState::Searching, None);
            }
            Ended::Unreachable => {
                // Keep a key or config error visible until a connection works.
                if button.inner.lock().unwrap().state != ConnectionState::Error {
                    button.set_state(&app, ConnectionState::Searching, None);
                }
            }
            Ended::Failed(message) => {
                eprintln!("[Harness:recording] external button: {message}");
                button.set_state(&app, ConnectionState::Error, Some(message));
            }
        }
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = tokio::time::sleep(retry) => {}
        }
        retry = (retry * 2).min(MAX_RETRY);
    }
}

async fn session(
    app: &AppHandle,
    button: &Arc<ExternalButton>,
    host: &str,
    key: &str,
    held: &AtomicBool,
    cancel: &CancellationToken,
) -> Ended {
    let mut client = match EspHomeClient::builder()
        .address(&format!("{host}:{API_PORT}"))
        .key(key)
        .client_info("Harness")
        .timeout(CONNECT_TIMEOUT)
        .connect()
        .await
    {
        Ok(client) => client,
        Err(e) => return classify(e),
    };

    let (button_key, ring_key) = match find_entities(&mut client).await {
        Ok((Some(k), ring)) => (k, ring),
        Ok((None, _)) => {
            return Ended::Failed(format!("The device at {host} has no \"{BUTTON_NAME}\"."))
        }
        Err(e) => return classify(e),
    };
    if let Err(e) = client.try_write(SubscribeStatesRequest {}).await {
        return classify(e);
    }
    button.set_state(app, ConnectionState::Connected, None);
    eprintln!("[Harness:recording] external button connected to {host}");
    let _ring = ring_key.map(|key| RingLink::start(button, client.write_stream(), key, cancel));

    let mut seen_first = false;
    let mut awaiting_pong = false;
    loop {
        let message = match tokio::time::timeout(PING_INTERVAL, client.try_read()).await {
            Err(_) if awaiting_pong => return Ended::Dropped,
            Err(_) => {
                if client.try_write(PingRequest {}).await.is_err() {
                    return Ended::Dropped;
                }
                awaiting_pong = true;
                continue;
            }
            Ok(Err(_)) => return Ended::Dropped,
            Ok(Ok(message)) => message,
        };
        awaiting_pong = false;
        match message {
            EspHomeMessage::BinarySensorStateResponse(state)
                if state.key == button_key && !state.missing_state =>
            {
                let first = !seen_first;
                seen_first = true;
                let was_held = held.load(Ordering::SeqCst);
                for &phase in button_edges(first, was_held, state.state) {
                    held.store(phase == "down", Ordering::SeqCst);
                    dispatch_fn_edge(app, &button.runtime, phase, now_ms()).await;
                }
            }
            EspHomeMessage::DisconnectRequest(_) => {
                let _ = client.try_write(DisconnectResponse {}).await;
                return Ended::Dropped;
            }
            _ => {}
        }
    }
}

/// Keys of the centre button and, when the firmware has one, the LED ring.
async fn find_entities(
    client: &mut EspHomeClient,
) -> Result<(Option<u32>, Option<u32>), ClientError> {
    client.try_write(ListEntitiesRequest {}).await?;
    let mut button = None;
    let mut ring = None;
    loop {
        match client.try_read().await? {
            EspHomeMessage::ListEntitiesBinarySensorResponse(entity)
                if entity.name == BUTTON_NAME || entity.object_id == BUTTON_OBJECT_ID =>
            {
                button = Some(entity.key);
            }
            EspHomeMessage::ListEntitiesLightResponse(entity)
                if entity.name == RING_NAME || entity.object_id == RING_OBJECT_ID =>
            {
                ring = Some(entity.key);
            }
            EspHomeMessage::ListEntitiesDoneResponse(_) => return Ok((button, ring)),
            _ => {}
        }
    }
}

/// Keeps the ring in step with recording activity for one connection. Dropping
/// it, when the connection ends, stops the updates.
struct RingLink<'a> {
    button: &'a ExternalButton,
    ended: CancellationToken,
}

impl<'a> RingLink<'a> {
    fn start(
        button: &'a ExternalButton,
        writer: EspHomeClientWriteStream,
        key: u32,
        cancel: &CancellationToken,
    ) -> Self {
        button.inner.lock().unwrap().ring = Some((writer.clone(), key));
        let ended = CancellationToken::new();
        tauri::async_runtime::spawn(drive_ring(
            writer,
            key,
            button.activity.subscribe(),
            cancel.clone(),
            ended.clone(),
        ));
        Self { button, ended }
    }
}

impl Drop for RingLink<'_> {
    fn drop(&mut self) {
        self.ended.cancel();
        self.button.inner.lock().unwrap().ring = None;
    }
}

async fn drive_ring(
    writer: EspHomeClientWriteStream,
    key: u32,
    mut activity: watch::Receiver<Ring>,
    cancel: CancellationToken,
    ended: CancellationToken,
) {
    loop {
        let ring = *activity.borrow_and_update();
        if writer.try_write(ring_command(key, ring)).await.is_err() {
            return;
        }
        tokio::select! {
            // Turned off in Settings: leave the ring dark. Checked first because
            // the connection ends at the same moment.
            biased;
            _ = cancel.cancelled() => {
                let _ = writer.try_write(ring_command(key, Ring::Off)).await;
                return;
            }
            _ = ended.cancelled() => return,
            changed = activity.changed() => {
                if changed.is_err() {
                    return;
                }
            }
        }
    }
}

fn ring_command(key: u32, ring: Ring) -> LightCommandRequest {
    let ([red, green, blue], brightness, effect) = match ring {
        Ring::Off => {
            return LightCommandRequest {
                key,
                has_state: true,
                state: false,
                ..Default::default()
            }
        }
        Ring::Ready => ([1.0, 1.0, 1.0], 0.15, "None"),
        Ring::Recording => ([1.0, 0.08, 0.04], 0.8, "None"),
        Ring::Processing => ([0.3, 0.5, 1.0], 0.6, RING_PULSE),
    };
    LightCommandRequest {
        key,
        has_state: true,
        state: true,
        has_brightness: true,
        brightness,
        has_rgb: true,
        red,
        green,
        blue,
        has_effect: true,
        effect: effect.to_string(),
        ..Default::default()
    }
}

fn classify(error: ClientError) -> Ended {
    match error {
        ClientError::Connection(_) | ClientError::Timeout { .. } | ClientError::Stream(_) => {
            Ended::Unreachable
        }
        other => Ended::Failed(format!("Could not connect: {other}")),
    }
}

/// Fn edges for one centre button state update. The first update after
/// subscribing is the current value, not a press, unless it is already down.
/// A release with no press means the press update was lost, so both edges go
/// out to keep every `up` paired with a `down`.
fn button_edges(first: bool, held: bool, pressed: bool) -> &'static [&'static str] {
    match (pressed, held) {
        (true, true) => &[],
        (true, false) => &["down"],
        (false, true) => &["up"],
        (false, false) if first => &[],
        (false, false) => &["down", "up"],
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_release_is_not_a_press() {
        assert!(button_edges(true, false, false).is_empty());
    }

    #[test]
    fn initial_press_starts_recording() {
        assert_eq!(button_edges(true, false, true), ["down"]);
    }

    #[test]
    fn press_and_release() {
        assert_eq!(button_edges(false, false, true), ["down"]);
        assert_eq!(button_edges(false, true, false), ["up"]);
    }

    #[test]
    fn repeated_press_is_ignored() {
        assert!(button_edges(false, true, true).is_empty());
    }

    #[test]
    fn lost_press_still_pairs_edges() {
        assert_eq!(button_edges(false, false, false), ["down", "up"]);
    }

    #[test]
    fn ring_off_only_sets_state() {
        let off = ring_command(7, Ring::Off);
        assert!(off.has_state && !off.state);
        assert!(!off.has_rgb && !off.has_effect);
    }

    #[test]
    fn ring_pulses_only_while_processing() {
        assert_eq!(ring_command(7, Ring::Processing).effect, RING_PULSE);
        assert_eq!(ring_command(7, Ring::Recording).effect, "None");
        assert_eq!(ring_command(7, Ring::Ready).effect, "None");
    }

    #[test]
    fn key_must_be_32_bytes() {
        assert!(validate_key("AAECAwQFBgcICRAREhMUFRYXGBkgISIjJCUmJygpMDE=").is_ok());
        assert!(validate_key("short").is_err());
    }
}
