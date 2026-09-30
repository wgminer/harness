//! Reliable paste into another macOS app after unfocused Fn dictation.
//!
//! AppleScript → System Events (`keystroke "v"`) needs a separate Automation
//! grant, ignores errors, and races the pasteboard. Post Cmd+V from this
//! process (Accessibility we already have for Fn) and reactivate the app that
//! was frontmost when recording started.

use std::ffi::c_void;
use std::time::Duration;

use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSRunningApplication, NSWorkspace,
};
use tauri::AppHandle;

const KVK_ANSI_V: u16 = 9;
const KVK_COMMAND: u16 = 0x37;
const COMMAND_FLAG: u64 = 0x0010_0000;
const HID_EVENT_TAP: u32 = 0;
const EVENT_SOURCE_HID_SYSTEM: i32 = 1;

const CLIPBOARD_SETTLE: Duration = Duration::from_millis(40);
const ACTIVATE_SETTLE: Duration = Duration::from_millis(80);

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCreate(state_id: i32) -> *mut c_void;
    fn CGEventCreateKeyboardEvent(
        source: *mut c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> *mut c_void;
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventPost(tap: u32, event: *mut c_void);
    fn CGEventPostToPid(pid: i32, event: *mut c_void);
    fn CFRelease(cf: *const c_void);
}

fn run_on_main<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    if MainThreadMarker::new().is_some() {
        return Ok(f());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| format!("Could not reach the AppKit main thread: {e}"))?;
    rx.recv()
        .map_err(|e| format!("Main-thread paste task failed: {e}"))
}

/// PID of the frontmost app if it is not Harness.
pub fn frontmost_foreign_pid(app: &AppHandle) -> Option<i32> {
    run_on_main(app, || {
        let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
        let current = NSRunningApplication::currentApplication();
        let pid = front.processIdentifier();
        if pid <= 0 || pid == current.processIdentifier() {
            return None;
        }
        let name = front
            .localizedName()
            .map(|s| s.to_string())
            .unwrap_or_else(|| "?".into());
        eprintln!("[Harness:recording] paste target: {name} (pid {pid})");
        Some(pid)
    })
    .ok()
    .flatten()
}

fn activate_pid(pid: i32) -> Result<(), String> {
    let Some(target) =
        NSRunningApplication::runningApplicationWithProcessIdentifier(pid)
    else {
        return Err("The app that was being dictated into is no longer running.".into());
    };
    let current = NSRunningApplication::currentApplication();
    if target.processIdentifier() == current.processIdentifier() {
        return Ok(());
    }

    if let Some(mtm) = MainThreadMarker::new() {
        NSApplication::sharedApplication(mtm).yieldActivationToApplication(&target);
    }
    let sent = target.activateFromApplication_options(
        &current,
        NSApplicationActivationOptions::empty(),
    );
    if !sent {
        eprintln!(
            "[Harness:recording] paste: activateFromApplication failed for pid {pid}"
        );
    }
    Ok(())
}

fn post_key(
    pid: Option<i32>,
    source: *mut c_void,
    key: u16,
    down: bool,
    flags: u64,
) -> Result<(), String> {
    unsafe {
        let event = CGEventCreateKeyboardEvent(source, key, down);
        if event.is_null() {
            return Err("Could not create a keyboard event for paste.".into());
        }
        CGEventSetFlags(event, flags);
        match pid {
            Some(pid) if pid > 0 => CGEventPostToPid(pid, event),
            _ => CGEventPost(HID_EVENT_TAP, event),
        }
        CFRelease(event);
    }
    Ok(())
}

fn post_cmd_v(pid: Option<i32>) -> Result<(), String> {
    unsafe {
        let source = CGEventSourceCreate(EVENT_SOURCE_HID_SYSTEM);
        if source.is_null() {
            return Err("Could not create a keyboard event source for paste.".into());
        }

        // Command down, V down, V up, Command up — flags stay on for the chord.
        let result = (|| {
            post_key(pid, source, KVK_COMMAND, true, COMMAND_FLAG)?;
            post_key(pid, source, KVK_ANSI_V, true, COMMAND_FLAG)?;
            post_key(pid, source, KVK_ANSI_V, false, COMMAND_FLAG)?;
            post_key(pid, source, KVK_COMMAND, false, 0)?;
            Ok(())
        })();

        CFRelease(source);
        result
    }
}

fn set_clipboard(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}

/// Copy `text`, reactivate the dictation target, and synthesize Cmd+V.
pub async fn paste_text(
    app: &AppHandle,
    text: &str,
    target_pid: Option<i32>,
) -> Result<(), String> {
    // Clipboard first so the transcript is still one Cmd+V away if paste is blocked.
    let clipboard_text = text.to_string();
    run_on_main(app, move || set_clipboard(clipboard_text))??;

    if !crate::system::macos_accessibility_is_trusted() {
        return Err(
            "Transcript copied to the clipboard. To paste automatically, turn on Harness in Accessibility settings, then quit and reopen Harness.".into(),
        );
    }

    tokio::time::sleep(CLIPBOARD_SETTLE).await;

    let pid = target_pid.or_else(|| frontmost_foreign_pid(app));
    if let Some(pid) = pid {
        eprintln!("[Harness:recording] paste: activating pid {pid}");
        run_on_main(app, move || activate_pid(pid))??;
        tokio::time::sleep(ACTIVATE_SETTLE).await;
    }

    run_on_main(app, move || {
        eprintln!("[Harness:recording] paste: posting Cmd+V (pid={:?})", pid);
        post_cmd_v(pid)
    })?
}
