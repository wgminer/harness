//! App version and environment flags.

use tauri::command;

use crate::env_util::{is_harness_dev, is_harness_e2e, is_stub_images};

#[command(rename_all = "camelCase")]
pub fn app_get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[command(rename_all = "camelCase")]
pub fn env_is_harness_dev() -> bool {
    is_harness_dev()
}

#[command(rename_all = "camelCase")]
pub fn env_is_harness_e2e() -> bool {
    is_harness_e2e()
}

#[command(rename_all = "camelCase")]
pub fn env_is_stub_images() -> bool {
    is_stub_images()
}
