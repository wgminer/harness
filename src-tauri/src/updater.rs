use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

use crate::env_util::{is_harness_dev, is_harness_e2e};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateStatus {
    #[serde(rename = "idle")]
    Idle,
    Checking,
    #[serde(rename = "available")]
    Available { version: String },
    #[serde(rename = "not-available")]
    NotAvailable,
    Downloading { percent: u32 },
    Ready,
    Error { message: String },
}

pub struct UpdaterRuntime {
    current_status: std::sync::Mutex<UpdateStatus>,
}

impl UpdaterRuntime {
    pub fn new() -> Self {
        Self {
            current_status: std::sync::Mutex::new(UpdateStatus::Idle),
        }
    }

    fn broadcast_status(&self, app: &AppHandle, status: UpdateStatus) {
        *self.current_status.lock().unwrap() = status.clone();
        let _ = app.emit("updater-status", &status);
    }
}

fn is_updater_enabled() -> bool {
    !is_harness_dev() && !is_harness_e2e()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn updater_check(app: AppHandle) -> Result<(), String> {
    if !is_updater_enabled() {
        return Ok(());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn updater_get_status(runtime: State<'_, Arc<UpdaterRuntime>>) -> UpdateStatus {
    runtime.current_status.lock().unwrap().clone()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn updater_download_and_install(app: AppHandle) -> Result<(), String> {
    if !is_updater_enabled() {
        return Ok(());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;
    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn register_updater(app: &AppHandle, runtime: Arc<UpdaterRuntime>) {
    if !is_updater_enabled() {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let updater = match app_handle.updater() {
            Ok(u) => u,
            Err(err) => {
                runtime.broadcast_status(
                    &app_handle,
                    UpdateStatus::Error {
                        message: err.to_string(),
                    },
                );
                return;
            }
        };

        runtime.broadcast_status(&app_handle, UpdateStatus::Checking);
        match updater.check().await {
            Ok(Some(update)) => {
                runtime.broadcast_status(
                    &app_handle,
                    UpdateStatus::Available {
                        version: update.version,
                    },
                );
            }
            Ok(None) => {
                runtime.broadcast_status(&app_handle, UpdateStatus::NotAvailable);
            }
            Err(err) => {
                runtime.broadcast_status(
                    &app_handle,
                    UpdateStatus::Error {
                        message: err.to_string(),
                    },
                );
            }
        }
    });
}

pub fn start_update_check(app: &AppHandle, runtime: Arc<UpdaterRuntime>) {
    register_updater(app, runtime);
}

pub fn init_updater_runtime() -> Arc<UpdaterRuntime> {
    Arc::new(UpdaterRuntime::new())
}
