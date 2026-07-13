//! Owns global Fn hotkey session + menu bar tray + native capture pipeline.

use std::sync::{Arc, Mutex as StdMutex};

use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, State,
};
use tokio::sync::Mutex;

use serde_json::Value;

use crate::env_util::{app_display_name, is_global_hotkey_disabled, is_harness_e2e};
use crate::fn_monitor::{resolve_fn_monitor_path, FnMonitorCallbacks, FnMonitorProcess};
use crate::global_recording_capture::NativeCapture;
use crate::global_recording_effects::{
    load_tray_image, run_recording_effects, show_and_focus_main, unregister_escape,
};
use crate::global_recording_session::{
    create_initial_fn_recording_state, reduce_escape, reduce_fn_edge, FnEdge, FnRecordingState,
    SessionMode,
};
use crate::memory::AppState;
use crate::settings::get_settings;
use crate::storage::WriteChains;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FnMonitorHealth {
    Stopped,
    Running,
    AccessibilityDenied,
}

pub struct GlobalRecordingRuntime {
    pub(crate) app_state: AppState,
    fn_state: Mutex<FnRecordingState>,
    hotkey_active: Mutex<bool>,
    frontend_ready: Mutex<bool>,
    monitor_health: Mutex<FnMonitorHealth>,
    fn_monitor: Mutex<Option<Arc<FnMonitorProcess>>>,
    pub(crate) tray_id: Mutex<Option<String>>,
    session_lock: Mutex<()>,
    pub(crate) escape_registered: StdMutex<bool>,
    pub(crate) transcribing: Mutex<bool>,
    pub(crate) capture: StdMutex<Option<NativeCapture>>,
}

impl GlobalRecordingRuntime {
    pub fn new(app_state: AppState) -> Self {
        Self {
            app_state,
            fn_state: Mutex::new(create_initial_fn_recording_state()),
            hotkey_active: Mutex::new(false),
            frontend_ready: Mutex::new(false),
            monitor_health: Mutex::new(FnMonitorHealth::Stopped),
            fn_monitor: Mutex::new(None),
            tray_id: Mutex::new(None),
            session_lock: Mutex::new(()),
            escape_registered: StdMutex::new(false),
            transcribing: Mutex::new(false),
            capture: StdMutex::new(None),
        }
    }

    pub(crate) async fn reset_fn_state(&self) {
        *self.fn_state.lock().await = create_initial_fn_recording_state();
    }

    pub(crate) async fn is_frontend_ready(&self) -> bool {
        *self.frontend_ready.lock().await
    }

    fn session_mode_label(&self) -> &'static str {
        match self.fn_state.try_lock().map(|s| s.session) {
            Ok(SessionMode::Recording) => "recording",
            _ => "idle",
        }
    }
}

pub(crate) async fn dispatch_fn_edge(
    app: &AppHandle,
    runtime: &Arc<GlobalRecordingRuntime>,
    phase: &str,
    ms: i64,
) {
    let _guard = runtime.session_lock.lock().await;

    if *runtime.transcribing.lock().await {
        eprintln!("[Harness:recording] Fn tap ignored — transcription in progress");
        return;
    }

    let edge = if phase == "down" { FnEdge::Down } else { FnEdge::Up };
    let state = *runtime.fn_state.lock().await;
    let (next, effects) = reduce_fn_edge(state, edge, ms);
    *runtime.fn_state.lock().await = next;
    eprintln!(
        "[Harness:recording] fn {:?} -> session {:?}",
        edge,
        next.session
    );
    run_recording_effects(app, runtime, effects).await;
}

pub(crate) async fn cancel_active_recording(
    app: &AppHandle,
    runtime: &Arc<GlobalRecordingRuntime>,
) {
    let _guard = runtime.session_lock.lock().await;

    let state = *runtime.fn_state.lock().await;
    if state.session == SessionMode::None {
        return;
    }
    let (next, effects) = reduce_escape(state);
    *runtime.fn_state.lock().await = next;
    run_recording_effects(app, runtime, effects).await;
}

async fn start_fn_monitor(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !cfg!(target_os = "macos") || is_harness_e2e() || is_global_hotkey_disabled() {
        return;
    }

    let mut guard = runtime.fn_monitor.lock().await;
    if guard.is_some() {
        return;
    }

    let Some(path) = resolve_fn_monitor_path() else {
        *runtime.monitor_health.lock().await = FnMonitorHealth::Stopped;
        return;
    };

    *runtime.monitor_health.lock().await = FnMonitorHealth::Running;

    let app_edge = app.clone();
    let runtime_edge = runtime.clone();
    let callbacks = FnMonitorCallbacks {
        on_edge: Arc::new(move |phase, ms| {
            let phase = phase.to_string();
            let app = app_edge.clone();
            let runtime = runtime_edge.clone();
            tauri::async_runtime::spawn(async move {
                dispatch_fn_edge(&app, &runtime, &phase, ms).await;
            });
        }),
        on_exit: Arc::new({
            let runtime_exit = runtime.clone();
            move |accessibility_denied| {
                let runtime = runtime_exit.clone();
                tauri::async_runtime::spawn(async move {
                    *runtime.monitor_health.lock().await = if accessibility_denied {
                        FnMonitorHealth::AccessibilityDenied
                    } else {
                        FnMonitorHealth::Stopped
                    };
                });
            }
        }),
    };
    let monitor = Arc::new(FnMonitorProcess::new(path, callbacks));
    monitor.clone().start().await;
    *guard = Some(monitor);
}

async fn start_fn_monitor_if_ready(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !*runtime.frontend_ready.lock().await {
        return;
    }
    if !*runtime.hotkey_active.lock().await {
        return;
    }
    start_fn_monitor(app, runtime).await;
}

async fn stop_fn_monitor(runtime: &GlobalRecordingRuntime) {
    if let Some(monitor) = runtime.fn_monitor.lock().await.take() {
        monitor.dispose().await;
    }
    *runtime.monitor_health.lock().await = FnMonitorHealth::Stopped;
}

async fn destroy_tray(app: &AppHandle, runtime: &Arc<GlobalRecordingRuntime>) {
    stop_fn_monitor(runtime).await;
    cancel_active_recording(app, runtime).await;
    unregister_escape(app, runtime);
    if let Some(id) = runtime.tray_id.lock().await.take() {
        if let Some(tray) = app.tray_by_id(&id) {
            let _ = tray.set_visible(false);
        }
    }
}

async fn start_tray_and_monitor(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if !cfg!(target_os = "macos") || is_harness_e2e() {
        return;
    }

    {
        let mut hotkey_active = runtime.hotkey_active.lock().await;
        if *hotkey_active {
            return;
        }
        *hotkey_active = true;
    }

    let tray_icon = load_tray_image("icon-tray.png").unwrap_or_else(|| {
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
                show_and_focus_main(&app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus_main(tray.app_handle());
            }
        })
        .build(&app)
        .expect("tray icon");

    *runtime.tray_id.lock().await = Some(tray_id);
}

pub fn global_fn_hotkey_enabled_from_recording(recording: &Value) -> bool {
    recording
        .get("globalFnHotkey")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

pub fn global_fn_hotkey_enabled(settings: &Value) -> bool {
    settings
        .get("recording")
        .map(global_fn_hotkey_enabled_from_recording)
        .unwrap_or(true)
}

pub async fn apply_global_fn_hotkey_setting(
    app: AppHandle,
    runtime: Arc<GlobalRecordingRuntime>,
    user_enabled: bool,
) {
    let should_enable = user_enabled && !is_global_hotkey_disabled();

    if should_enable {
        if !*runtime.hotkey_active.lock().await {
            start_tray_and_monitor(app.clone(), runtime.clone()).await;
        }
        start_fn_monitor_if_ready(app, runtime).await;
        return;
    }

    if *runtime.hotkey_active.lock().await {
        destroy_tray(&app, &runtime).await;
        *runtime.hotkey_active.lock().await = false;
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalRecordingStatus {
    pub monitor_health: String,
    pub frontend_ready: bool,
    pub hotkey_active: bool,
    pub session_mode: String,
    pub capture_backend: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn recording_get_global_status(
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
) -> Result<GlobalRecordingStatus, String> {
    let health = *runtime.monitor_health.lock().await;
    let monitor_health = match health {
        FnMonitorHealth::Stopped => "stopped",
        FnMonitorHealth::Running => "running",
        FnMonitorHealth::AccessibilityDenied => "accessibility_denied",
    }
    .to_string();
    let session_mode = if *runtime.transcribing.lock().await {
        "transcribing".to_string()
    } else {
        runtime.session_mode_label().to_string()
    };
    Ok(GlobalRecordingStatus {
        monitor_health,
        frontend_ready: *runtime.frontend_ready.lock().await,
        hotkey_active: *runtime.hotkey_active.lock().await,
        session_mode,
        capture_backend: "cpal".to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn recording_signal_frontend_ready(
    app: AppHandle,
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
) -> Result<(), String> {
    *runtime.frontend_ready.lock().await = true;
    start_fn_monitor_if_ready(app, runtime.inner().clone()).await;
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
    dispatch_fn_edge(&app, &runtime, &phase, timestamp).await;
    Ok(())
}

pub async fn register_global_recording(
    app: AppHandle,
    runtime: Arc<GlobalRecordingRuntime>,
    chains: &WriteChains,
) {
    if !cfg!(target_os = "macos") && !is_harness_e2e() {
        eprintln!("Harness: global Fn recording is only available on macOS.");
        return;
    }

    let settings = get_settings(chains).await;
    let enabled = global_fn_hotkey_enabled(&settings);
    apply_global_fn_hotkey_setting(app, runtime, enabled).await;
}

pub fn init_global_recording_runtime(app_state: AppState) -> Arc<GlobalRecordingRuntime> {
    Arc::new(GlobalRecordingRuntime::new(app_state))
}
