//! Home Assistant Voice PE centre button as a stand-in for the Fn key.
//!
//! Harness holds the ESPHome native API connection itself (encrypted, port
//! 6053) and feeds button edges into the same path as Fn. Host and the enable
//! switch are per profile (`external-button.json`), so Harness and Harness Dev
//! do not both claim the button; the encryption key lives in the credential
//! store. The LED ring follows recording (`ring`), and when the firmware has a
//! "Mic stream" switch the device can be the dictation microphone (`mic`).

mod mic;
mod ring;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use esphome_client::error::ClientError;
use esphome_client::types::{
    DisconnectResponse, EspHomeMessage, ListEntitiesRequest, PingRequest, SubscribeStatesRequest,
    VoiceAssistantResponse,
};
use esphome_client::{EspHomeClient, EspHomeClientWriteStream};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use crate::credentials::{get_credential, set_credential, CredentialKey};
use crate::paths::get_app_state_dir;
use crate::recording::global::{dispatch_fn_edge, GlobalRecordingRuntime};
use crate::recording::global_capture::{CaptureFeed, NativeCapture};
use crate::recording::global_effects::TrayIconState;
use ring::Ring;

const DEFAULT_HOST: &str = "voicepe.local";
const API_PORT: u16 = 6053;
const BUTTON_NAME: &str = "Center button";
const BUTTON_OBJECT_ID: &str = "center_button";
const RING_NAME: &str = "LED ring";
const RING_OBJECT_ID: &str = "led_ring";
const MIC_SWITCH_NAME: &str = "Mic stream";
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
    /// Record dictation from the device's microphone instead of the Mac's.
    #[serde(default)]
    use_mic: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: false,
            host: DEFAULT_HOST.to_string(),
            use_mic: false,
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
    pub use_mic: bool,
    /// Connected to firmware that can stream its microphone.
    pub mic_available: bool,
}

/// The live connection's writer and the keys of the entities Harness drives.
#[derive(Clone)]
struct Link {
    writer: EspHomeClientWriteStream,
    ring_key: Option<u32>,
    mic_key: Option<u32>,
}

struct Inner {
    config: Config,
    state: ConnectionState,
    message: Option<String>,
    cancel: Option<CancellationToken>,
    link: Option<Link>,
    /// Where device audio goes while a take records from it.
    mic_feed: Option<CaptureFeed>,
}

pub struct ExternalButton {
    runtime: Arc<GlobalRecordingRuntime>,
    inner: Mutex<Inner>,
    ring: watch::Sender<Ring>,
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
                link: None,
                mic_feed: None,
            }),
            ring: watch::channel(Ring::Ready).0,
        })
    }

    /// Mirrors a tray icon change on the ring, whether or not a device is connected.
    pub fn show_activity(app: &AppHandle, state: TrayIconState) {
        let Some(button) = app.try_state::<Arc<ExternalButton>>() else {
            return;
        };
        let next = match state {
            TrayIconState::Ready => Ring::Ready,
            TrayIconState::Recording => Ring::Recording { level: 0 },
            TrayIconState::Processing => Ring::Processing,
        };
        button.ring.send_if_modified(|ring| ring::set_phase(ring, next));
    }

    /// Voice level while recording (0..1 peak), shown as red brightness.
    pub fn show_level(app: &AppHandle, peak: f32) {
        if let Some(button) = app.try_state::<Arc<ExternalButton>>() {
            button.ring.send_if_modified(|ring| ring::set_level(ring, peak));
        }
    }

    /// Flashes green for a delivered transcript, then goes back to ready.
    pub fn show_success(app: &AppHandle) {
        let Some(button) = app.try_state::<Arc<ExternalButton>>() else {
            return;
        };
        let button = button.inner().clone();
        button.ring.send_if_modified(|ring| ring::set_phase(ring, Ring::Success));
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(ring::SUCCESS_FLASH).await;
            button.ring.send_if_modified(|ring| {
                if *ring != Ring::Success {
                    return false;
                }
                *ring = Ring::Ready;
                true
            });
        });
    }

    /// A capture fed by the device microphone, when the user chose it and the
    /// device can stream. `None` means record from the Mac as usual.
    pub fn start_mic(app: &AppHandle) -> Option<NativeCapture> {
        let button = app.try_state::<Arc<ExternalButton>>()?.inner().clone();
        let (writer, switch_key) = {
            let inner = button.inner.lock().unwrap();
            if !inner.config.use_mic {
                return None;
            }
            let link = inner.link.as_ref();
            let Some((link, key)) = link.and_then(|l| l.mic_key.map(|k| (l, k))) else {
                eprintln!("[Harness:recording] Voice PE mic not available, using the Mac mic");
                return None;
            };
            (link.writer.clone(), key)
        };
        let stop_writer = writer.clone();
        let stopping = button.clone();
        let (capture, feed) = NativeCapture::external(
            mic::SAMPLE_RATE,
            Box::new(move || {
                stopping.inner.lock().unwrap().mic_feed = None;
                tauri::async_runtime::spawn(async move {
                    let _ = mic::stop(&stop_writer, switch_key).await;
                });
            }),
        );
        button.inner.lock().unwrap().mic_feed = Some(feed);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = mic::start(&writer, switch_key).await {
                eprintln!("[Harness:recording] Voice PE mic did not start: {e}");
            }
        });
        eprintln!("[Harness:recording] recording from the Voice PE mic");
        Some(capture)
    }

    /// Switches the ring off before the app quits so it does not stay lit.
    pub fn shutdown(&self) {
        let Some(link) = self.inner.lock().unwrap().link.take() else {
            return;
        };
        let Some(key) = link.ring_key else {
            return;
        };
        tauri::async_runtime::block_on(async {
            let _ = tokio::time::timeout(
                RING_OFF_TIMEOUT,
                link.writer.try_write(ring::command(key, Ring::Off)),
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
            use_mic: inner.config.use_mic,
            mic_available: inner.link.as_ref().is_some_and(|l| l.mic_key.is_some()),
        }
    }

    /// Saves the settings and reconnects. An empty `key` keeps the stored one.
    pub fn configure(
        self: &Arc<Self>,
        app: &AppHandle,
        enabled: bool,
        host: &str,
        key: Option<&str>,
        use_mic: bool,
    ) -> Result<ExternalButtonStatus, String> {
        if let Some(key) = key.map(str::trim).filter(|k| !k.is_empty()) {
            validate_key(key)?;
            set_credential(CredentialKey::ExternalButtonKey, key).map_err(|e| e.to_string())?;
        }
        let host = host.trim();
        let config = Config {
            enabled,
            host: if host.is_empty() { DEFAULT_HOST.to_string() } else { host.to_string() },
            use_mic,
        };
        save_config(&config)?;
        let reconnect = {
            let mut inner = self.inner.lock().unwrap();
            let reconnect = inner.config.enabled != config.enabled
                || inner.config.host != config.host
                || key.is_some_and(|k| !k.trim().is_empty());
            inner.config = config;
            reconnect
        };
        // The mic choice is read at the start of each take; no need to drop the connection.
        if reconnect {
            self.restart(app);
        } else {
            let _ = app.emit(STATUS_EVENT, self.status());
        }
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

    let entities = match find_entities(&mut client).await {
        Ok(entities) => entities,
        Err(e) => return classify(e),
    };
    let Some(button_key) = entities.button else {
        return Ended::Failed(format!("The device at {host} has no \"{BUTTON_NAME}\"."));
    };
    if let Err(e) = client.try_write(SubscribeStatesRequest {}).await {
        return classify(e);
    }
    let _link = LinkGuard::start(button, &client, &entities, cancel);
    button.set_state(app, ConnectionState::Connected, None);
    eprintln!("[Harness:recording] external button connected to {host}");

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
            // The mic switch went on and the device asks to stream. Port 0
            // means "send the audio over this connection".
            EspHomeMessage::VoiceAssistantRequest(request) if request.start => {
                let recording = button.inner.lock().unwrap().mic_feed.is_some();
                let response = VoiceAssistantResponse {
                    port: 0,
                    error: !recording,
                };
                if client.try_write(response).await.is_err() {
                    return Ended::Dropped;
                }
            }
            EspHomeMessage::VoiceAssistantAudio(audio) => {
                let feed = button.inner.lock().unwrap().mic_feed.clone();
                if let Some(feed) = feed {
                    feed.push(&mic::decode_pcm16(&audio.data));
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

#[derive(Default)]
struct Entities {
    button: Option<u32>,
    ring: Option<u32>,
    mic: Option<u32>,
}

/// Keys of the centre button and, when the firmware has them, the LED ring and
/// mic switch. Matched on name because recent firmware sends empty object ids.
async fn find_entities(client: &mut EspHomeClient) -> Result<Entities, ClientError> {
    client.try_write(ListEntitiesRequest {}).await?;
    let mut found = Entities::default();
    loop {
        match client.try_read().await? {
            EspHomeMessage::ListEntitiesBinarySensorResponse(entity)
                if entity.name == BUTTON_NAME || entity.object_id == BUTTON_OBJECT_ID =>
            {
                found.button = Some(entity.key);
            }
            EspHomeMessage::ListEntitiesLightResponse(entity)
                if entity.name == RING_NAME || entity.object_id == RING_OBJECT_ID =>
            {
                found.ring = Some(entity.key);
            }
            EspHomeMessage::ListEntitiesSwitchResponse(entity) if entity.name == MIC_SWITCH_NAME => {
                found.mic = Some(entity.key);
            }
            EspHomeMessage::ListEntitiesDoneResponse(_) => return Ok(found),
            _ => {}
        }
    }
}

/// Publishes one connection's link and keeps the ring in step with it.
/// Dropping it, when the connection ends, stops the ring updates and ends any
/// take recording from the device mic with the audio it has so far.
struct LinkGuard<'a> {
    button: &'a ExternalButton,
    ended: CancellationToken,
}

impl<'a> LinkGuard<'a> {
    fn start(
        button: &'a ExternalButton,
        client: &EspHomeClient,
        entities: &Entities,
        cancel: &CancellationToken,
    ) -> Self {
        let link = Link {
            writer: client.write_stream(),
            ring_key: entities.ring,
            mic_key: entities.mic,
        };
        let ended = CancellationToken::new();
        if let Some(key) = link.ring_key {
            tauri::async_runtime::spawn(ring::drive(
                link.writer.clone(),
                key,
                button.ring.subscribe(),
                cancel.clone(),
                ended.clone(),
            ));
        }
        button.inner.lock().unwrap().link = Some(link);
        Self { button, ended }
    }
}

impl Drop for LinkGuard<'_> {
    fn drop(&mut self) {
        self.ended.cancel();
        let mut inner = self.button.inner.lock().unwrap();
        inner.link = None;
        inner.mic_feed = None;
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
    fn key_must_be_32_bytes() {
        assert!(validate_key("AAECAwQFBgcICRAREhMUFRYXGBkgISIjJCUmJygpMDE=").is_ok());
        assert!(validate_key("short").is_err());
    }

    #[test]
    fn older_config_files_default_to_the_mac_mic() {
        let config: Config = serde_json::from_str(r#"{"enabled":true,"host":"voicepe.local"}"#).unwrap();
        assert!(!config.use_mic);
    }
}
