//! In-process macOS Fn / Globe key monitor via CGEventTap.
//!
//! Runs on a dedicated CFRunLoop thread so Tokio / AppKit main stay free.
//! Accessibility TCC applies to the main Harness binary only (no nested helper).

use std::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{SystemTime, UNIX_EPOCH};

/// kVK_Function — labeled Fn / Globe on Apple keyboards.
const KVK_FUNCTION: i64 = 63;
const CG_EVENT_FLAGS_CHANGED: u32 = 12;
const CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
const CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;
const CG_SESSION_EVENT_TAP: u32 = 1;
const CG_HEAD_INSERT_EVENT_TAP: u32 = 0;
const CG_EVENT_TAP_OPTION_DEFAULT: u32 = 0;
const CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;
/// NX_SECONDARYFNMASK / kCGEventFlagMaskSecondaryFn
const CG_EVENT_FLAG_MASK_SECONDARY_FN: u64 = 0x0080_0000;
/// NSEvent.modifierFlags `.function` (device-independent)
const NS_EVENT_MODIFIER_FLAG_FUNCTION: u64 = 1 << 23;

type CGEventTapProxy = *mut std::ffi::c_void;
type CGEventRef = *mut std::ffi::c_void;
type CFMachPortRef = *mut std::ffi::c_void;
type CFRunLoopSourceRef = *mut std::ffi::c_void;
type CFRunLoopRef = *mut std::ffi::c_void;
type CFAllocatorRef = *mut std::ffi::c_void;
type CFStringRef = *const std::ffi::c_void;
type CFRunLoopMode = CFStringRef;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: extern "C" fn(
            CGEventTapProxy,
            u32,
            CGEventRef,
            *mut std::ffi::c_void,
        ) -> CGEventRef,
        user_info: *mut std::ffi::c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    static kCFRunLoopCommonModes: CFRunLoopMode;
    fn CFMachPortCreateRunLoopSource(
        allocator: CFAllocatorRef,
        port: CFMachPortRef,
        order: i64,
    ) -> CFRunLoopSourceRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: CFRunLoopRef);
    fn CFRelease(cf: *const std::ffi::c_void);
}

static EVENT_TAP: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
static RUN_LOOP: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
static CALLBACKS: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
static FN_PRESSED: AtomicBool = AtomicBool::new(false);
static STOP_REQUESTED: AtomicBool = AtomicBool::new(false);

pub struct FnTapCallbacks {
    pub on_edge: Arc<dyn Fn(&str, i64) + Send + Sync>,
    /// Called once if the tap cannot be created (Accessibility denied).
    pub on_accessibility_denied: Arc<dyn Fn() + Send + Sync>,
}

pub struct FnTapMonitor {
    join: std::sync::Mutex<Option<JoinHandle<()>>>,
}

impl FnTapMonitor {
    pub fn start(callbacks: FnTapCallbacks) -> Arc<Self> {
        STOP_REQUESTED.store(false, Ordering::SeqCst);
        FN_PRESSED.store(false, Ordering::SeqCst);

        let monitor = Arc::new(Self {
            join: std::sync::Mutex::new(None),
        });

        let handle = thread::Builder::new()
            .name("harness-fn-tap".into())
            .spawn(move || run_tap_thread(callbacks))
            .expect("spawn harness-fn-tap thread");

        *monitor.join.lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);
        monitor
    }

    pub fn dispose(&self) {
        STOP_REQUESTED.store(true, Ordering::SeqCst);
        let rl = RUN_LOOP.load(Ordering::SeqCst);
        if !rl.is_null() {
            unsafe { CFRunLoopStop(rl) };
        }
        if let Some(handle) = self
            .join
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = handle.join();
        }
    }
}

fn run_tap_thread(callbacks: FnTapCallbacks) {
    let events_of_interest = 1u64 << CG_EVENT_FLAGS_CHANGED;
    let tap = unsafe {
        CGEventTapCreate(
            CG_SESSION_EVENT_TAP,
            CG_HEAD_INSERT_EVENT_TAP,
            CG_EVENT_TAP_OPTION_DEFAULT,
            events_of_interest,
            event_tap_callback,
            std::ptr::null_mut(),
        )
    };

    if tap.is_null() {
        eprintln!(
            "[HarnessFnTap] CGEventTapCreate failed — enable Accessibility for Harness, then restart the app"
        );
        (callbacks.on_accessibility_denied)();
        return;
    }

    if STOP_REQUESTED.load(Ordering::SeqCst) {
        unsafe { CFRelease(tap) };
        return;
    }

    let source = unsafe { CFMachPortCreateRunLoopSource(std::ptr::null_mut(), tap, 0) };
    if source.is_null() {
        eprintln!("[HarnessFnTap] CFMachPortCreateRunLoopSource failed");
        unsafe { CFRelease(tap) };
        (callbacks.on_accessibility_denied)();
        return;
    }

    let rl = unsafe { CFRunLoopGetCurrent() };
    EVENT_TAP.store(tap, Ordering::SeqCst);
    RUN_LOOP.store(rl, Ordering::SeqCst);
    CALLBACKS.store(
        Box::into_raw(Box::new(callbacks)) as *mut std::ffi::c_void,
        Ordering::SeqCst,
    );

    unsafe {
        CFRunLoopAddSource(rl, source, kCFRunLoopCommonModes);
        CGEventTapEnable(tap, true);
    }

    if STOP_REQUESTED.load(Ordering::SeqCst) {
        unsafe { CFRunLoopStop(rl) };
    } else {
        eprintln!("[HarnessFnTap] event tap running");
        unsafe { CFRunLoopRun() };
    }

    unsafe {
        CGEventTapEnable(tap, false);
        CFRelease(source);
        CFRelease(tap);
    }
    EVENT_TAP.store(std::ptr::null_mut(), Ordering::SeqCst);
    RUN_LOOP.store(std::ptr::null_mut(), Ordering::SeqCst);
    FN_PRESSED.store(false, Ordering::SeqCst);

    let cbs = CALLBACKS.swap(std::ptr::null_mut(), Ordering::SeqCst);
    if !cbs.is_null() {
        unsafe {
            drop(Box::from_raw(cbs as *mut FnTapCallbacks));
        }
    }
    eprintln!("[HarnessFnTap] event tap stopped");
}

extern "C" fn event_tap_callback(
    _proxy: CGEventTapProxy,
    type_: u32,
    event: CGEventRef,
    _user_info: *mut std::ffi::c_void,
) -> CGEventRef {
    if type_ == CG_EVENT_TAP_DISABLED_BY_TIMEOUT || type_ == CG_EVENT_TAP_DISABLED_BY_USER_INPUT {
        let tap = EVENT_TAP.load(Ordering::SeqCst);
        if !tap.is_null() {
            unsafe { CGEventTapEnable(tap, true) };
        }
        return event;
    }

    if type_ != CG_EVENT_FLAGS_CHANGED {
        return event;
    }

    let key_code = unsafe { CGEventGetIntegerValueField(event, CG_KEYBOARD_EVENT_KEYCODE) };
    if key_code != KVK_FUNCTION {
        return event;
    }

    let flags = unsafe { CGEventGetFlags(event) };
    let fn_down = (flags & CG_EVENT_FLAG_MASK_SECONDARY_FN) != 0
        || (flags & NS_EVENT_MODIFIER_FLAG_FUNCTION) != 0;

    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let was_pressed = FN_PRESSED.load(Ordering::SeqCst);
    if fn_down && !was_pressed {
        FN_PRESSED.store(true, Ordering::SeqCst);
        emit_edge("down", ms);
    } else if !fn_down && was_pressed {
        FN_PRESSED.store(false, Ordering::SeqCst);
        emit_edge("up", ms);
    }

    event
}

fn emit_edge(phase: &str, ms: i64) {
    let ptr = CALLBACKS.load(Ordering::SeqCst);
    if ptr.is_null() {
        return;
    }
    let cbs = unsafe { &*(ptr as *const FnTapCallbacks) };
    (cbs.on_edge)(phase, ms);
}
