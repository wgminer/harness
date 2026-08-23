//! In-process macOS Fn / Globe key monitor via NSEvent.
//!
//! `CGEventTap` needs Input Monitoring and can go silent in signed / hardened
//! runtime builds. `NSEvent` FlagsChanged monitors are gated only on
//! Accessibility, and a local monitor still works while Harness is focused.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
use tauri::AppHandle;

/// kVK_Function — labeled Fn / Globe on Apple keyboards.
const KVK_FUNCTION: u16 = 63;

static FN_PRESSED: AtomicBool = AtomicBool::new(false);

pub struct FnTapCallbacks {
    pub on_edge: Arc<dyn Fn(&str, i64) + Send + Sync>,
}

/// NSEvent monitor tokens are main-thread objects; we only touch them there.
struct MonitorHandles {
    global: Option<Retained<AnyObject>>,
    local: Option<Retained<AnyObject>>,
}

unsafe impl Send for MonitorHandles {}

pub struct FnTapMonitor {
    app: AppHandle,
    handles: Mutex<Option<MonitorHandles>>,
}

impl FnTapMonitor {
    pub fn start(app: &AppHandle, callbacks: FnTapCallbacks) -> Arc<Self> {
        FN_PRESSED.store(false, Ordering::SeqCst);

        let monitor = Arc::new(Self {
            app: app.clone(),
            handles: Mutex::new(None),
        });
        let callbacks = Arc::new(callbacks);
        run_on_main(&monitor.app, {
            let monitor = monitor.clone();
            move || install_monitors(&monitor, callbacks)
        });
        monitor
    }

    pub fn dispose(&self) {
        FN_PRESSED.store(false, Ordering::SeqCst);
        let handles = self
            .handles
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        if handles.is_none() {
            return;
        }
        run_on_main(&self.app, move || {
            if let Some(handles) = handles {
                remove_monitors(handles);
            }
        });
    }
}

impl Drop for FnTapMonitor {
    fn drop(&mut self) {
        self.dispose();
    }
}

fn run_on_main(app: &AppHandle, f: impl FnOnce() + Send + 'static) {
    if MainThreadMarker::new().is_some() {
        f();
        return;
    }
    let (tx, rx) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            f();
            let _ = tx.send(());
        })
        .is_err()
    {
        eprintln!("[HarnessFnTap] could not run on the AppKit main thread");
        return;
    }
    let _ = rx.recv();
}

fn install_monitors(monitor: &FnTapMonitor, callbacks: Arc<FnTapCallbacks>) {
    let global_callbacks = callbacks.clone();
    let global_block = RcBlock::new(move |event: NonNull<NSEvent>| {
        handle_fn_event(unsafe { event.as_ref() }, &global_callbacks);
    });
    let global = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(
        NSEventMask::FlagsChanged,
        &global_block,
    );

    let local_block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        handle_fn_event(unsafe { event.as_ref() }, &callbacks);
        event.as_ptr()
    });
    let local = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::FlagsChanged,
            &local_block,
        )
    };

    eprintln!(
        "[HarnessFnTap] NSEvent Fn monitors installed (global={}, local={})",
        global.is_some(),
        local.is_some()
    );

    *monitor.handles.lock().unwrap_or_else(|e| e.into_inner()) =
        Some(MonitorHandles { global, local });
}

fn remove_monitors(handles: MonitorHandles) {
    unsafe {
        if let Some(global) = handles.global {
            NSEvent::removeMonitor(&global);
        }
        if let Some(local) = handles.local {
            NSEvent::removeMonitor(&local);
        }
    }
    eprintln!("[HarnessFnTap] NSEvent Fn monitors removed");
}

fn handle_fn_event(event: &NSEvent, callbacks: &FnTapCallbacks) {
    if event.keyCode() != KVK_FUNCTION {
        return;
    }

    let fn_down = event
        .modifierFlags()
        .contains(NSEventModifierFlags::Function);
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let was_pressed = FN_PRESSED.load(Ordering::SeqCst);
    if fn_down && !was_pressed {
        FN_PRESSED.store(true, Ordering::SeqCst);
        (callbacks.on_edge)("down", ms);
    } else if !fn_down && was_pressed {
        FN_PRESSED.store(false, Ordering::SeqCst);
        (callbacks.on_edge)("up", ms);
    }
}
