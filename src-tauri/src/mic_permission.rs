//! macOS Microphone TCC via AVAudioApplication.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicPermissionStatus {
    Granted,
    Denied,
    Undetermined,
    Unsupported,
}

impl MicPermissionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Undetermined => "undetermined",
            Self::Unsupported => "unsupported",
        }
    }

    pub fn is_granted(self) -> bool {
        matches!(self, Self::Granted)
    }
}

pub const MICROPHONE_PERMISSION_DENIED_MESSAGE: &str =
    "Microphone access is required. Enable Harness in System Settings → Privacy & Security → Microphone, then quit and reopen. If Harness is not listed, install a build that includes the microphone entitlement and try Ask For Microphone again.";

/// Current Microphone TCC status without prompting.
pub fn microphone_permission_status() -> MicPermissionStatus {
    #[cfg(target_os = "macos")]
    {
        macos_permission_status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        MicPermissionStatus::Unsupported
    }
}

/// Prompt (if undetermined) and return whether recording is allowed.
pub async fn request_microphone_access(app: &tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    {
        request_microphone_access_macos(app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        true
    }
}

#[cfg(target_os = "macos")]
fn macos_permission_status() -> MicPermissionStatus {
    use objc2_avf_audio::{AVAudioApplication, AVAudioApplicationRecordPermission};

    let permission = unsafe { AVAudioApplication::sharedInstance().recordPermission() };
    match permission {
        AVAudioApplicationRecordPermission::Granted => MicPermissionStatus::Granted,
        AVAudioApplicationRecordPermission::Denied => MicPermissionStatus::Denied,
        AVAudioApplicationRecordPermission::Undetermined => MicPermissionStatus::Undetermined,
        _ => MicPermissionStatus::Undetermined,
    }
}

/// Start the system mic permission prompt. Completion may run later; the block is leaked until then.
#[cfg(target_os = "macos")]
fn begin_record_permission_request(reply: std::sync::mpsc::Sender<bool>) {
    use std::cell::Cell;

    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_avf_audio::AVAudioApplication;

    let reply = Cell::new(Some(reply));
    let block = RcBlock::new(move |granted: Bool| {
        if let Some(tx) = reply.take() {
            let _ = tx.send(granted.as_bool());
        }
    });
    unsafe {
        AVAudioApplication::requestRecordPermissionWithCompletionHandler(&block);
    }
    std::mem::forget(block);
}

#[cfg(target_os = "macos")]
async fn request_microphone_access_macos(app: &tauri::AppHandle) -> bool {
    match macos_permission_status() {
        MicPermissionStatus::Granted => return true,
        MicPermissionStatus::Denied => return false,
        MicPermissionStatus::Undetermined | MicPermissionStatus::Unsupported => {}
    }

    let (tx, rx) = std::sync::mpsc::channel::<bool>();

    // TCC permission sheets must be initiated from the AppKit main thread.
    if app
        .run_on_main_thread(move || {
            begin_record_permission_request(tx);
        })
        .is_err()
    {
        return false;
    }

    tokio::task::spawn_blocking(move || rx.recv().unwrap_or(false))
        .await
        .unwrap_or_else(|_| macos_permission_status().is_granted())
}
