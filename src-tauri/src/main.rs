// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    exit_with_dev_runner();
    harness_lib::run();
}

/// The macOS dev runner (src-tauri/scripts/macos-dev-runner.py) spawns the app detached
/// for TCC, so a SIGKILL from `tauri dev` would orphan it; quit once the runner is gone.
fn exit_with_dev_runner() {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    if let Some(runner) = std::env::var("HARNESS_DEV_RUNNER_PID")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
    {
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            if std::os::unix::process::parent_id() != runner {
                std::process::exit(0);
            }
        });
    }
}
