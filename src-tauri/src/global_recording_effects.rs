//! Side effects from the global Fn recording state machine.
//! IPC events are always emitted before tray updates.

use tauri::{image::Image, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::env_util::is_harness_e2e;
use crate::global_recording_session::GlobalRecordingEffect;
use crate::paths::resolve_bundled_resource;

use crate::global_recording::{cancel_active_recording, GlobalRecordingRuntime};

#[derive(Clone, Copy)]
pub enum TrayIconState {
    Ready,
    Recording,
    Processing,
}

fn tray_icon_file(state: TrayIconState) -> &'static str {
    match state {
        TrayIconState::Ready => "icon-tray.png",
        TrayIconState::Recording => "icon-tray-recording.png",
        TrayIconState::Processing => "icon-tray-processing.png",
    }
}

fn tray_title(state: TrayIconState) -> Option<&'static str> {
    match state {
        TrayIconState::Ready => None,
        TrayIconState::Recording => Some("REC"),
        TrayIconState::Processing => None,
    }
}

fn load_tray_image(file_name: &str) -> Option<Image<'static>> {
    let path = resolve_bundled_resource(file_name)?;
    Image::from_path(&path).ok()
}

fn apply_tray_state(tray: &tauri::tray::TrayIcon, state: TrayIconState) {
    let file_name = tray_icon_file(state);
    if let Some(icon) = load_tray_image(file_name) {
        let _ = tray.set_icon(Some(icon));
    }
    // macOS may not clear the status title when passed None — use empty string.
    let title = tray_title(state).map(str::to_string).or_else(|| Some(String::new()));
    let _ = tray.set_title(title);
}

pub async fn set_tray_state(
    app: &AppHandle,
    runtime: &GlobalRecordingRuntime,
    state: TrayIconState,
) {
    let Some(tray_id) = runtime.tray_id.lock().await.clone() else {
        return;
    };
    let Some(tray) = app.tray_by_id(&tray_id) else {
        return;
    };
    apply_tray_state(&tray, state);
}

pub fn is_main_window_focused(app: &AppHandle) -> bool {
    if is_harness_e2e() {
        return true;
    }
    app.get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(false))
        .unwrap_or(false)
}

pub fn show_and_focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub async fn run_recording_effects(
    app: &AppHandle,
    runtime: &GlobalRecordingRuntime,
    effects: Vec<GlobalRecordingEffect>,
) {
    for effect in effects {
        match effect {
            GlobalRecordingEffect::StartRecording => {
                if !runtime.is_frontend_ready().await {
                    eprintln!(
                        "[Harness] global recording start skipped — frontend not ready yet"
                    );
                    runtime.reset_fn_state().await;
                    continue;
                }
                register_escape_cancel(app, runtime);
                let _ = app.emit("recording-start-silent", ());
                set_tray_state(app, runtime, TrayIconState::Recording).await;
            }
            GlobalRecordingEffect::StopRecording => {
                unregister_escape(app, runtime);
                let was_focused = is_main_window_focused(app);
                let _ = app.emit(
                    "recording-stop-and-paste",
                    serde_json::json!({ "wasFocused": was_focused }),
                );
                if was_focused {
                    show_and_focus_main(app);
                }
                set_tray_state(app, runtime, TrayIconState::Processing).await;
            }
            GlobalRecordingEffect::CancelRecording => {
                unregister_escape(app, runtime);
                let _ = app.emit("recording-cancel", ());
                set_tray_state(app, runtime, TrayIconState::Ready).await;
            }
        }
    }
}

pub fn register_escape_cancel(app: &AppHandle, runtime: &GlobalRecordingRuntime) {
    if *runtime.escape_registered.lock().unwrap() {
        return;
    }
    *runtime.escape_registered.lock().unwrap() = true;
    let app_for_handler = app.clone();
    let _ = app.global_shortcut().on_shortcut(
        tauri_plugin_global_shortcut::Shortcut::new(None, tauri_plugin_global_shortcut::Code::Escape),
        move |_app, _shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let app = app_for_handler.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<std::sync::Arc<GlobalRecordingRuntime>>() {
                        cancel_active_recording(&app, &state).await;
                    }
                });
            }
        },
    );
}

pub fn unregister_escape(app: &AppHandle, runtime: &GlobalRecordingRuntime) {
    if !*runtime.escape_registered.lock().unwrap() {
        return;
    }
    *runtime.escape_registered.lock().unwrap() = false;
    let _ = app.global_shortcut().unregister(tauri_plugin_global_shortcut::Shortcut::new(
        None,
        tauri_plugin_global_shortcut::Code::Escape,
    ));
}
