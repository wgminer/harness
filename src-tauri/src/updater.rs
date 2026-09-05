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

    fn is_install_in_progress(&self) -> bool {
        matches!(
            *self.current_status.lock().unwrap(),
            UpdateStatus::Downloading { .. } | UpdateStatus::Ready
        )
    }
}

fn is_updater_enabled() -> bool {
    !is_harness_dev() && !is_harness_e2e()
}

fn download_percent(downloaded: u64, total: Option<u64>) -> Option<u32> {
    let total = total.filter(|t| *t > 0)?;
    Some(((downloaded as f64 / total as f64) * 100.0).min(100.0) as u32)
}

async fn run_update_check(app: &AppHandle, runtime: &UpdaterRuntime) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(_) => {
            runtime.broadcast_status(app, UpdateStatus::Idle);
            return;
        }
    };

    runtime.broadcast_status(app, UpdateStatus::Checking);
    match updater.check().await {
        Ok(Some(update)) => {
            runtime.broadcast_status(
                app,
                UpdateStatus::Available {
                    version: update.version,
                },
            );
        }
        Ok(None) => {
            runtime.broadcast_status(app, UpdateStatus::NotAvailable);
        }
        Err(_) => {
            // Background probe failed — stay quiet so the footer does not alarm.
            runtime.broadcast_status(app, UpdateStatus::Idle);
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn updater_check(
    app: AppHandle,
    runtime: State<'_, Arc<UpdaterRuntime>>,
) -> Result<(), String> {
    if !is_updater_enabled() {
        return Ok(());
    }
    run_update_check(&app, &runtime).await;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub fn updater_get_status(runtime: State<'_, Arc<UpdaterRuntime>>) -> UpdateStatus {
    runtime.current_status.lock().unwrap().clone()
}

#[tauri::command(rename_all = "camelCase")]
pub async fn updater_download_and_install(
    app: AppHandle,
    runtime: State<'_, Arc<UpdaterRuntime>>,
) -> Result<(), String> {
    if !is_updater_enabled() {
        return Ok(());
    }
    if runtime.is_install_in_progress() {
        return Ok(());
    }

    let runtime = runtime.inner().clone();
    let fail = |app: &AppHandle, runtime: &UpdaterRuntime, message: String| {
        runtime.broadcast_status(
            app,
            UpdateStatus::Error {
                message: message.clone(),
            },
        );
        Err(message)
    };

    runtime.broadcast_status(&app, UpdateStatus::Downloading { percent: 0 });

    let updater = match app.updater() {
        Ok(u) => u,
        Err(err) => return fail(&app, &runtime, err.to_string()),
    };
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return fail(&app, &runtime, "No update available".to_string()),
        Err(err) => return fail(&app, &runtime, err.to_string()),
    };

    let mut downloaded: u64 = 0;
    let mut last_percent: u32 = 0;
    let progress_app = app.clone();
    let progress_runtime = runtime.clone();
    if let Err(err) = update
        .download_and_install(
            |chunk, total| {
                downloaded = downloaded.saturating_add(chunk as u64);
                if let Some(percent) = download_percent(downloaded, total) {
                    if percent != last_percent {
                        last_percent = percent;
                        progress_runtime.broadcast_status(
                            &progress_app,
                            UpdateStatus::Downloading { percent },
                        );
                    }
                }
            },
            || {
                progress_runtime.broadcast_status(
                    &progress_app,
                    UpdateStatus::Downloading { percent: 100 },
                );
            },
        )
        .await
    {
        return fail(&app, &runtime, err.to_string());
    }

    runtime.broadcast_status(&app, UpdateStatus::Ready);
    app.restart();
}

pub fn register_updater(app: &AppHandle, runtime: Arc<UpdaterRuntime>) {
    if !is_updater_enabled() {
        return;
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_update_check(&app_handle, &runtime).await;
    });
}

pub fn start_update_check(app: &AppHandle, runtime: Arc<UpdaterRuntime>) {
    register_updater(app, runtime);
}

pub fn init_updater_runtime() -> Arc<UpdaterRuntime> {
    Arc::new(UpdaterRuntime::new())
}

#[cfg(test)]
mod tests {
    use super::download_percent;

    #[test]
    fn download_percent_none_without_total() {
        assert_eq!(download_percent(512, None), None);
        assert_eq!(download_percent(512, Some(0)), None);
    }

    #[test]
    fn download_percent_scales_and_clamps() {
        assert_eq!(download_percent(0, Some(100)), Some(0));
        assert_eq!(download_percent(50, Some(100)), Some(50));
        assert_eq!(download_percent(100, Some(100)), Some(100));
        assert_eq!(download_percent(150, Some(100)), Some(100));
    }
}
