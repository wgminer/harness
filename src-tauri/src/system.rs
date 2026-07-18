use tauri::{command, AppHandle};
use tauri_plugin_opener::OpenerExt;

const PRIVACY_ACCESSIBILITY: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const PRIVACY_MICROPHONE: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const PRIVACY_SPEECH_RECOGNITION: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition";

#[command(rename_all = "camelCase")]
pub fn system_get_platform() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(target_os = "macos")]
fn macos_accessibility_trusted(prompt: bool) -> bool {
    if prompt {
        let _ = std::process::Command::new("open")
            .arg(PRIVACY_ACCESSIBILITY)
            .spawn();
    }
    std::process::Command::new("osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to return UI elements enabled")
        .output()
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false)
}

#[cfg(not(target_os = "macos"))]
fn macos_accessibility_trusted(_prompt: bool) -> bool {
    false
}

async fn open_privacy_pane(app: &AppHandle, url: &str) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Ok(());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[command(rename_all = "camelCase")]
pub fn system_macos_accessibility_trusted() -> bool {
    macos_accessibility_trusted(false)
}

#[command(rename_all = "camelCase")]
pub fn system_request_accessibility_prompt() -> bool {
    macos_accessibility_trusted(true)
}

#[command(rename_all = "camelCase")]
pub async fn system_open_accessibility_settings(app: AppHandle) -> Result<(), String> {
    open_privacy_pane(&app, PRIVACY_ACCESSIBILITY).await
}

#[command(rename_all = "camelCase")]
pub async fn system_open_microphone_settings(app: AppHandle) -> Result<(), String> {
    open_privacy_pane(&app, PRIVACY_MICROPHONE).await
}

#[command(rename_all = "camelCase")]
pub async fn system_open_speech_recognition_settings(app: AppHandle) -> Result<(), String> {
    open_privacy_pane(&app, PRIVACY_SPEECH_RECOGNITION).await
}
