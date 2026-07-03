use std::env;
use std::path::PathBuf;

pub const HARNESS_DEV_APP_NAME: &str = "Harness Dev";
pub const HARNESS_PROD_APP_NAME: &str = "Harness";

pub fn is_harness_dev() -> bool {
    env::var("HARNESS_DEV").ok().as_deref() == Some("1")
}

pub fn is_harness_e2e() -> bool {
    env::var("HARNESS_E2E").ok().as_deref() == Some("1")
}

pub fn is_global_hotkey_disabled() -> bool {
    env::var("HARNESS_DISABLE_GLOBAL_HOTKEY").ok().as_deref() == Some("1")
}

pub fn app_display_name() -> &'static str {
    if is_harness_dev() && !is_harness_e2e() {
        HARNESS_DEV_APP_NAME
    } else {
        HARNESS_PROD_APP_NAME
    }
}

/// Harness userData directory (NOT Tauri app_data_dir).
pub fn user_data_dir() -> PathBuf {
    let base = dirs::data_dir().expect("data_dir");
    let name = if is_harness_dev() && !is_harness_e2e() {
        HARNESS_DEV_APP_NAME
    } else {
        HARNESS_PROD_APP_NAME
    };
    base.join(name)
}

pub fn generate_id(prefix: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let rand: u32 = rand::random();
    format!("{prefix}_{ts}_{rand:08x}")
}

pub fn sanitize_conversation_id(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
