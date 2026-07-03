use std::path::PathBuf;
use std::sync::Arc;

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tokio::sync::Mutex;

use crate::env_util::{app_display_name, is_global_hotkey_disabled, is_harness_dev, is_harness_e2e};
use crate::fn_monitor::{resolve_fn_monitor_path, FnMonitorCallbacks, FnMonitorProcess};
use crate::global_recording_session::{
    create_initial_fn_recording_state, reduce_escape, reduce_fn_edge, FnEdge, FnRecordingState,
    GlobalRecordingEffect, SessionMode,
};

pub use crate::global_recording_session::*;

pub struct GlobalRecordingRuntime {
    fn_state: Mutex<FnRecordingState>,
    global_recording_enabled: Mutex<bool>,
    hotkey_active: Mutex<bool>,
    fn_monitor: Mutex<Option<Arc<FnMonitorProcess>>>,
    tray_id: Mutex<Option<String>>,
}

impl GlobalRecordingRuntime {
    pub fn new() -> Self {
        Self {
            fn_state: Mutex::new(create_initial_fn_recording_state()),
            global_recording_enabled: Mutex::new(true),
            hotkey_active: Mutex::new(false),
            fn_monitor: Mutex::new(None),
            tray_id: Mutex::new(None),
        }
    }
}

fn resource_path(file_name: &str) -> PathBuf {
    let candidates = [
        PathBuf::from("resources").join(file_name),
        PathBuf::from("../resources").join(file_name),
    ];
    for path in candidates {
        if path.exists() {
            return path;
        }
    }
    PathBuf::from("resources").join(file_name)
}

fn load_tray_image(file_name: &str) -> Option<Image<'static>> {
    let path = resource_path(file_name);
    Image::from_path(&path).ok()
}

async fn set_ready_tray(app: &AppHandle) {
    let _ = app.emit_to("main", "global-recording-tray", "ready");
}

async fn set_recording_tray(app: &AppHandle) {
    let _ = app.emit_to("main", "global-recording-tray", "recording");
}

async fn set_processing_tray(app: &AppHandle) {
    let _ = app.emit_to("main", "global-recording-tray", "processing");
}

async fn apply_effects(
    app: &AppHandle,
    runtime: &GlobalRecordingRuntime,
    effects: Vec<GlobalRecordingEffect>,
) {
    for effect in effects {
        match effect {
            GlobalRecordingEffect::StartRecording => {
                set_recording_tray(app).await;
                register_escape_cancel(app);
                let _ = app.emit("recording-start-silent", ());
            }
            GlobalRecordingEffect::StopRecording => {
                set_processing_tray(app).await;
                unregister_escape(app);
                let was_focused = if is_harness_e2e() {
                    true
                } else {
                    app.get_webview_window("main")
                        .map(|w| w.is_focused().unwrap_or(false))
                        .unwrap_or(false)
                };
                let _ = app.emit("recording-stop-and-paste", serde_json::json!({ "wasFocused": was_focused }));
                if was_focused {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
            GlobalRecordingEffect::CancelRecording => {
                set_ready_tray(app).await;
                unregister_escape(app);
                let _ = app.emit("recording-cancel", ());
            }
        }
    }
}

fn register_escape_cancel(app: &AppHandle) {
    let app_for_handler = app.clone();
    let _ = app.global_shortcut().on_shortcut(
        Shortcut::new(None, Code::Escape),
        move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
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

fn unregister_escape(app: &AppHandle) {
    let _ = app
        .global_shortcut()
        .unregister(Shortcut::new(None, Code::Escape));
}

async fn on_fn_edge(app: &AppHandle, runtime: &Arc<GlobalRecordingRuntime>, phase: &str, ms: i64) {
    let focused_in_app = if is_harness_e2e() {
        true
    } else {
        app.get_webview_window("main")
            .map(|w| w.is_focused().unwrap_or(false))
            .unwrap_or(false)
    };
    if focused_in_app && !*runtime.global_recording_enabled.lock().await {
        return;
    }

    let edge = if phase == "down" { FnEdge::Down } else { FnEdge::Up };
    let state = *runtime.fn_state.lock().await;
    let (next, effects) = reduce_fn_edge(state, edge, ms);
    *runtime.fn_state.lock().await = next;
    apply_effects(app, runtime, effects).await;
}

async fn start_fn_monitor(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !cfg!(target_os = "macos") || is_harness_e2e() || is_global_hotkey_disabled() {
        return;
    }
    if runtime.fn_monitor.lock().await.is_some() {
        return;
    }

    let Some(path) = resolve_fn_monitor_path() else {
        return;
    };

    let app_edge = app.clone();
    let runtime_edge = runtime.clone();
    let callbacks = FnMonitorCallbacks {
        on_edge: Arc::new(move |phase, ms| {
            let phase = phase.to_string();
            let app = app_edge.clone();
            let runtime = runtime_edge.clone();
            tauri::async_runtime::spawn(async move {
                on_fn_edge(&app, &runtime, &phase, ms).await;
            });
        }),
        on_exit: Arc::new(|code| {
            eprintln!("HarnessFnMonitor exited with code {code:?}, restarting…");
        }),
    };
    let monitor = Arc::new(FnMonitorProcess::new(path, callbacks));
    monitor.clone().start();
    *runtime.fn_monitor.lock().await = Some(monitor);
}

async fn stop_fn_monitor(runtime: &GlobalRecordingRuntime) {
    if let Some(monitor) = runtime.fn_monitor.lock().await.take() {
        monitor.dispose().await;
    }
}

async fn cancel_active_recording(app: &AppHandle, runtime: &Arc<GlobalRecordingRuntime>) {
    let state = *runtime.fn_state.lock().await;
    if state.session == SessionMode::None {
        return;
    }
    let (next, effects) = reduce_escape(state);
    *runtime.fn_state.lock().await = next;
    apply_effects(app, runtime, effects).await;
}

async fn destroy_tray(app: &AppHandle, runtime: &Arc<GlobalRecordingRuntime>) {
    stop_fn_monitor(runtime).await;
    cancel_active_recording(app, runtime).await;
    unregister_escape(app);
    if let Some(id) = runtime.tray_id.lock().await.take() {
        if let Some(tray) = app.tray_by_id(&id) {
            let _ = tray.set_visible(false);
        }
    }
}

async fn start_tray_and_monitor(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !cfg!(target_os = "macos") || is_harness_e2e() || *runtime.hotkey_active.lock().await {
        return;
    }

    let icon_name = if is_harness_dev() {
        "icon-tray-dev.png"
    } else {
        "icon-tray.png"
    };
    let tray_icon = load_tray_image(icon_name).unwrap_or_else(|| {
        Image::from_bytes(include_bytes!("../icons/icon.png")).expect("default tray icon")
    });

    let show_item = MenuItem::with_id(&app, "show", "Show Harness", true, None::<&str>)
        .expect("show menu item");
    let menu = Menu::with_items(&app, &[&show_item]).expect("tray menu");

    let tray_id = "harness-global-recording".to_string();
    let _tray = TrayIconBuilder::with_id(&tray_id)
        .icon(tray_icon)
        .tooltip(app_display_name())
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id.as_ref() == "show" {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(&app)
        .expect("tray icon");

    *runtime.tray_id.lock().await = Some(tray_id);
    *runtime.hotkey_active.lock().await = true;
    start_fn_monitor(app, runtime).await;
}

pub async fn apply_global_fn_hotkey_setting(
    app: AppHandle,
    runtime: Arc<GlobalRecordingRuntime>,
    user_enabled: bool,
) {
    let should_enable = user_enabled && !is_global_hotkey_disabled();

    if should_enable {
        if !*runtime.hotkey_active.lock().await {
            start_tray_and_monitor(app, runtime).await;
        }
        return;
    }

    if *runtime.hotkey_active.lock().await {
        destroy_tray(&app, &runtime).await;
        *runtime.hotkey_active.lock().await = false;
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn recording_set_global_enabled(
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    *runtime.global_recording_enabled.lock().await = enabled;
    if !enabled {
        cancel_active_recording(&app, &runtime).await;
    }
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn recording_done(app: AppHandle) -> Result<(), String> {
    set_ready_tray(&app).await;
    unregister_escape(&app);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn e2e_inject_fn_event(
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
    app: AppHandle,
    phase: String,
    ms: Option<i64>,
) -> Result<(), String> {
    if !is_harness_e2e() {
        return Ok(());
    }
    let timestamp = ms.unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    on_fn_edge(&app, &runtime, &phase, timestamp).await;
    Ok(())
}

pub fn register_global_recording(app: &AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !cfg!(target_os = "macos") && !is_harness_e2e() {
        eprintln!("Harness: global Fn recording is only available on macOS.");
    }
    let _ = runtime;
    let _ = app;
}

pub fn init_global_recording_runtime() -> Arc<GlobalRecordingRuntime> {
    Arc::new(GlobalRecordingRuntime::new())
}
