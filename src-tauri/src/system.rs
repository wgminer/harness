use std::path::{Path, PathBuf};

use tauri::{command, AppHandle};
use tauri_plugin_opener::OpenerExt;

use crate::memory::show_item_in_folder;

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
mod ax {
    use std::ffi::c_void;

    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::CFString;

    type CFStringRef = *const c_void;
    type CFDictionaryRef = *const c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    pub fn is_trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    pub fn prompt_and_check() -> bool {
        unsafe {
            let key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt as *const _);
            let value = CFBoolean::true_value();
            let options = CFDictionary::from_CFType_pairs(&[(key, value)]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef() as CFDictionaryRef)
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_accessibility_trusted(prompt: bool) -> bool {
    if prompt {
        ax::prompt_and_check()
    } else {
        ax::is_trusted()
    }
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

pub fn macos_accessibility_is_trusted() -> bool {
    macos_accessibility_trusted(false)
}

#[command(rename_all = "camelCase")]
pub fn system_macos_accessibility_trusted() -> bool {
    macos_accessibility_is_trusted()
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

fn expand_user_path(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

/// Reveal a local file or folder in the system file manager (Finder on macOS).
#[command(rename_all = "camelCase")]
pub async fn system_show_in_folder(path: String) -> Result<(), String> {
    let expanded = expand_user_path(&path);
    if !Path::new(&expanded).exists() {
        return Err(format!("Path not found: {}", expanded.display()));
    }
    show_item_in_folder(&expanded).map_err(|e| e.to_string())
}
