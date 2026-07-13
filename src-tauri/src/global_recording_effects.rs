//! Side effects from the global Fn recording state machine.

use std::sync::Arc;

use tauri::{image::Image, AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::conversation_title::finalize_voice_dictation_session;
use crate::dictation_recording_index;
use crate::env_util::is_harness_e2e;
use crate::global_recording_capture::NativeCapture;
use crate::global_recording_session::GlobalRecordingEffect;
use crate::memory::{append_message, create_conversation, AppendMessageMeta};
use crate::paths::{get_recordings_dir, resolve_bundled_resource};
use crate::recording::{paste_text_impl, transcribe_wav_bytes};

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

pub(crate) fn load_tray_image(file_name: &str) -> Option<Image<'static>> {
    let path = resolve_bundled_resource(file_name)?;
    Image::from_path(&path).ok()
}

fn apply_tray_state(tray: &tauri::tray::TrayIcon, state: TrayIconState) {
    let file_name = tray_icon_file(state);
    if let Some(icon) = load_tray_image(file_name) {
        let _ = tray.set_icon(Some(icon));
    }
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

fn emit_recording_error(app: &AppHandle, message: &str) {
    let _ = app.emit(
        "global-recording-error",
        serde_json::json!({ "message": message }),
    );
}

async fn save_wav(wav: &[u8]) -> Option<std::path::PathBuf> {
    let dir = get_recordings_dir();
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return None;
    }
    let path = dir.join(format!("rec_{}.wav", chrono::Utc::now().timestamp_millis()));
    if tokio::fs::write(&path, wav).await.is_err() {
        return None;
    }
    Some(path)
}

async fn deliver_unfocused(
    app: &AppHandle,
    app_state: &crate::memory::AppState,
    text: &str,
    recording_path: Option<&std::path::Path>,
) -> Result<String, String> {
    paste_text_impl(text).await?;
    let conversation_id = create_conversation(app_state)
        .await
        .map_err(|e| e.to_string())?;
    append_message(
        app_state,
        &conversation_id,
        "user",
        text,
        Some(AppendMessageMeta {
            tool_calls: None,
            timestamp: Some(chrono::Utc::now().timestamp_millis()),
            model: None,
        }),
    )
    .await
    .map_err(|e| e.to_string())?;
    finalize_voice_dictation_session(app.clone(), app_state, &conversation_id)
        .await
        .map_err(|e| e.to_string())?;
    if let Some(path) = recording_path {
        let _ = dictation_recording_index::link(&conversation_id, path);
    }
    Ok(conversation_id)
}

async fn run_stop_pipeline(
    app: AppHandle,
    runtime: Arc<GlobalRecordingRuntime>,
    was_focused: bool,
    wav: Vec<u8>,
) {
    *runtime.transcribing.lock().await = true;
    let recording_path = save_wav(&wav).await;

    let app_state = runtime.app_state.clone();
    let result = transcribe_wav_bytes(&app_state, &wav).await;
    let text = match result {
        Ok(t) => t.trim().to_string(),
        Err(err) => {
            emit_recording_error(&app, &err);
            *runtime.transcribing.lock().await = false;
            set_tray_state(&app, &runtime, TrayIconState::Ready).await;
            return;
        }
    };

    if text.is_empty() {
        emit_recording_error(&app, "No speech was detected in the recording.");
        *runtime.transcribing.lock().await = false;
        set_tray_state(&app, &runtime, TrayIconState::Ready).await;
        return;
    }

    if was_focused {
        let _ = app.emit("global-transcript-ready", serde_json::json!({ "text": text }));
    } else {
        match deliver_unfocused(
            &app,
            &app_state,
            &text,
            recording_path.as_deref(),
        )
        .await {
            Ok(conversation_id) => {
                let _ = app.emit(
                    "global-transcript-delivered",
                    serde_json::json!({ "conversationId": conversation_id }),
                );
            }
            Err(err) => {
                emit_recording_error(&app, &err);
                *runtime.transcribing.lock().await = false;
                set_tray_state(&app, &runtime, TrayIconState::Ready).await;
                return;
            }
        }
    }

    *runtime.transcribing.lock().await = false;
    set_tray_state(&app, &runtime, TrayIconState::Ready).await;
}

pub async fn run_recording_effects(
    app: &AppHandle,
    runtime: &Arc<GlobalRecordingRuntime>,
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

                let capture_result = if is_harness_e2e() {
                    Ok(())
                } else {
                    NativeCapture::start().map(|cap| {
                        *runtime.capture.lock().unwrap() = Some(cap);
                    })
                };

                match capture_result {
                    Ok(()) => {
                        register_escape_cancel(app, runtime);
                        let _ = app.emit("global-recording-started", serde_json::json!({}));
                        set_tray_state(app, runtime, TrayIconState::Recording).await;
                    }
                    Err(err) => {
                        runtime.reset_fn_state().await;
                        emit_recording_error(app, &err);
                        set_tray_state(app, runtime, TrayIconState::Ready).await;
                    }
                }
            }
            GlobalRecordingEffect::StopRecording => {
                unregister_escape(app, runtime);
                let was_focused = is_main_window_focused(app);
                let _ = app.emit("global-recording-stopped", serde_json::json!({}));
                set_tray_state(app, runtime, TrayIconState::Processing).await;
                if was_focused {
                    show_and_focus_main(app);
                }

                let wav_result = if is_harness_e2e() {
                    Ok(Vec::new())
                } else {
                    match runtime.capture.lock().unwrap().take() {
                        Some(cap) => cap.stop(),
                        None => Err("Recording was not active.".into()),
                    }
                };

                let runtime_arc = runtime.clone();
                let app_clone = app.clone();
                match wav_result {
                    Ok(wav) => {
                        tauri::async_runtime::spawn(async move {
                            run_stop_pipeline(app_clone, runtime_arc, was_focused, wav).await;
                        });
                    }
                    Err(err) => {
                        emit_recording_error(app, &err);
                        set_tray_state(app, runtime, TrayIconState::Ready).await;
                    }
                }
            }
            GlobalRecordingEffect::CancelRecording => {
                unregister_escape(app, runtime);
                if let Some(cap) = runtime.capture.lock().unwrap().take() {
                    cap.cancel();
                }
                let _ = app.emit("global-recording-cancelled", serde_json::json!({}));
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
                    if let Some(state) = app.try_state::<Arc<GlobalRecordingRuntime>>() {
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
