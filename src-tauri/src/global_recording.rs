//! Owns global Fn hotkey session + menu bar tray.
//! Does not capture audio or transcribe — the frontend + `recording.rs` handle that after IPC events.

use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

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
use crate::global_recording_effects::{
    is_main_window_focused, run_recording_effects, set_tray_state, show_and_focus_main,
    unregister_escape, TrayIconState,
};
use crate::global_recording_session::{
    create_initial_fn_recording_state, reduce_escape, reduce_fn_edge, reduce_start_failed,
    FnEdge, FnRecordingState, SessionMode,
};
use crate::paths::resolve_bundled_resource;
use crate::settings::get_settings;
use crate::storage::WriteChains;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FnMonitorHealth {
    Stopped,
    Running,
    AccessibilityDenied,
}

pub struct GlobalRecordingRuntime {
    fn_state: Mutex<FnRecordingState>,
    global_recording_enabled: Mutex<bool>,
    hotkey_active: Mutex<bool>,
    frontend_ready: Mutex<bool>,
    monitor_health: Mutex<FnMonitorHealth>,
    fn_monitor: Mutex<Option<Arc<FnMonitorProcess>>>,
    pub(crate) tray_id: Mutex<Option<String>>,
    session_lock: Mutex<()>,
    pub(crate) escape_registered: StdMutex<bool>,
    processing_started_at: Mutex<Option<Instant>>,
    processing_timeout_handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

impl GlobalRecordingRuntime {
    pub fn new() -> Self {
        Self {
            fn_state: Mutex::new(create_initial_fn_recording_state()),
            global_recording_enabled: Mutex::new(true),
            hotkey_active: Mutex::new(false),
            frontend_ready: Mutex::new(false),
            monitor_health: Mutex::new(FnMonitorHealth::Stopped),
            fn_monitor: Mutex::new(None),
            tray_id: Mutex::new(None),
            session_lock: Mutex::new(()),
            escape_registered: StdMutex::new(false),
            processing_started_at: Mutex::new(None),
            processing_timeout_handle: Mutex::new(None),
        }
    }

    pub(crate) async fn reset_fn_state(&self) {
        *self.fn_state.lock().await = create_initial_fn_recording_state();
    }

    pub(crate) async fn is_frontend_ready(&self) -> bool {
        *self.frontend_ready.lock().await
    }
}

fn load_tray_image(file_name: &str) -> Option<Image<'static>> {
    let path = resolve_bundled_resource(file_name)?;
    Image::from_path(&path).ok()
}

pub(crate) async fn dispatch_fn_edge(
    app: &AppHandle,
    runtime: &Arc<GlobalRecordingRuntime>,
    phase: &str,
    ms: i64,
) {
    let _guard = runtime.session_lock.lock().await;

    if is_main_window_focused(app) && !*runtime.global_recording_enabled.lock().await {
        return;
    }

    let edge = if phase == "down" { FnEdge::Down } else { FnEdge::Up };
    let state = *runtime.fn_state.lock().await;
    let (next, effects) = reduce_fn_edge(state, edge, ms);
    *runtime.fn_state.lock().await = next;
    if next.session == SessionMode::Processing {
        schedule_processing_timeout(app.clone(), runtime.clone()).await;
    }
    run_recording_effects(app, runtime, effects).await;
}

const PROCESSING_TIMEOUT_SECS: u64 = 90;

async fn schedule_processing_timeout(app: AppHandle, runtime: Arc<GlobalRecordingRuntime>) {
    if let Some(handle) = runtime.processing_timeout_handle.lock().await.take() {
        handle.abort();
    }
    *runtime.processing_started_at.lock().await = Some(Instant::now());
    let runtime_for_task = runtime.clone();
    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(PROCESSING_TIMEOUT_SECS)).await;
        let _guard = runtime_for_task.session_lock.lock().await;
        let state = *runtime_for_task.fn_state.lock().await;
        if state.session != SessionMode::Processing {
            return;
        }
        eprintln!(
            "[Harness] global recording processing timed out after {PROCESSING_TIMEOUT_SECS}s — resetting session"
        );
        *runtime_for_task.fn_state.lock().await = create_initial_fn_recording_state();
        set_tray_state(&app, &runtime_for_task, TrayIconState::Ready).await;
        unregister_escape(&app, &runtime_for_task);
        *runtime_for_task.processing_started_at.lock().await = None;
    });
    *runtime.processing_timeout_handle.lock().await = Some(handle);
}

pub(crate) async fn clear_processing_timeout(runtime: &GlobalRecordingRuntime) {
    if let Some(handle) = runtime.processing_timeout_handle.lock().await.take() {
        handle.abort();
    }
    *runtime.processing_started_at.lock().await = None;
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
    // Fn monitor starts after the webview signals frontend ready (see recording_signal_frontend_ready).
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
pub async fn recording_done(
    app: AppHandle,
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
) -> Result<(), String> {
    let _guard = runtime.session_lock.lock().await;
    clear_processing_timeout(&runtime).await;
    *runtime.fn_state.lock().await = create_initial_fn_recording_state();
    set_tray_state(&app, &runtime, TrayIconState::Ready).await;
    unregister_escape(&app, &runtime);
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn recording_start_failed(
    app: AppHandle,
    runtime: State<'_, Arc<GlobalRecordingRuntime>>,
    reason: String,
) -> Result<(), String> {
    let _guard = runtime.session_lock.lock().await;
    let state = *runtime.fn_state.lock().await;
    *runtime.fn_state.lock().await = reduce_start_failed(state);
    clear_processing_timeout(&runtime).await;
    set_tray_state(&app, &runtime, TrayIconState::Ready).await;
    unregister_escape(&app, &runtime);
    eprintln!("[Harness] global recording start failed: {reason}");
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalRecordingStatus {
    pub monitor_health: String,
    pub frontend_ready: bool,
    pub hotkey_active: bool,
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
    Ok(GlobalRecordingStatus {
        monitor_health,
        frontend_ready: *runtime.frontend_ready.lock().await,
        hotkey_active: *runtime.hotkey_active.lock().await,
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

pub fn init_global_recording_runtime() -> Arc<GlobalRecordingRuntime> {
    Arc::new(GlobalRecordingRuntime::new())
}
