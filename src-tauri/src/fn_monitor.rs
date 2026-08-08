use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use crate::paths::resolve_bundled_resource;

pub fn resolve_fn_monitor_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    match resolve_bundled_resource("HarnessFnMonitor") {
        Some(path) => Some(path),
        None => {
            eprintln!("HarnessFnMonitor: binary not found in bundled resources");
            None
        }
    }
}

pub struct FnMonitorCallbacks {
    pub on_edge: Arc<dyn Fn(&str, i64) + Send + Sync>,
    pub on_exit: Arc<dyn Fn(bool) + Send + Sync>,
}

#[derive(Debug, Clone, Copy)]
pub enum FnMonitorExit {
    SpawnFailed,
    Exited { code: Option<i32>, signal: Option<i32> },
}

const RESTART_BACKOFF_MS: [u64; 3] = [1_000, 3_000, 10_000];
const MAX_RESTART_ATTEMPTS: usize = 5;

pub struct FnMonitorProcess {
    binary_path: PathBuf,
    callbacks: FnMonitorCallbacks,
    child: Mutex<Option<Child>>,
    disposed: Mutex<bool>,
    started: Mutex<bool>,
    restart_attempt: Mutex<usize>,
}

impl FnMonitorProcess {
    pub fn new(binary_path: PathBuf, callbacks: FnMonitorCallbacks) -> Self {
        Self {
            binary_path,
            callbacks,
            child: Mutex::new(None),
            disposed: Mutex::new(false),
            started: Mutex::new(false),
            restart_attempt: Mutex::new(0),
        }
    }

    pub async fn start(self: Arc<Self>) {
        {
            let mut guard = self.started.lock().await;
            if *guard {
                return;
            }
            *guard = true;
        }
        *self.disposed.lock().await = false;
        let monitor = self.clone();
        tauri::async_runtime::spawn(async move {
            monitor.run_loop().await;
        });
    }

    pub async fn dispose(&self) {
        *self.disposed.lock().await = true;
        *self.started.lock().await = false;
        self.kill_child().await;
    }

    async fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    fn log_exit(exit: FnMonitorExit) {
        match exit {
            FnMonitorExit::SpawnFailed => {
                eprintln!("[HarnessFnMonitor] spawn failed — not restarting");
            }
            FnMonitorExit::Exited {
                code: Some(1),
                signal: None,
            } => {
                eprintln!(
                    "[HarnessFnMonitor] exited with code 1 (Accessibility / event tap) — enable Accessibility for Harness Dev and HarnessFnMonitor, then restart"
                );
            }
            FnMonitorExit::Exited {
                code: Some(code),
                signal: None,
            } => {
                eprintln!("[HarnessFnMonitor] exited with code {code}");
            }
            FnMonitorExit::Exited {
                code: None,
                signal: Some(sig),
            } => {
                eprintln!("[HarnessFnMonitor] terminated by signal {sig}");
            }
            FnMonitorExit::Exited {
                code: None,
                signal: None,
            } => {
                eprintln!("[HarnessFnMonitor] exited without status");
            }
            FnMonitorExit::Exited {
                code: Some(code),
                signal: Some(sig),
            } => {
                eprintln!("[HarnessFnMonitor] exited with code {code} and signal {sig}");
            }
        }
    }

    fn should_restart(exit: FnMonitorExit, attempt: usize) -> bool {
        match exit {
            FnMonitorExit::SpawnFailed => false,
            FnMonitorExit::Exited {
                code: Some(1),
                signal: None,
            } => false,
            _ => attempt < MAX_RESTART_ATTEMPTS,
        }
    }

    async fn run_loop(self: Arc<Self>) {
        while !*self.disposed.lock().await {
            let exit = self.clone().run_once().await;
            Self::log_exit(exit);

            if *self.disposed.lock().await {
                break;
            }

            if let FnMonitorExit::Exited {
                code: Some(1),
                signal: None,
            } = exit
            {
                (self.callbacks.on_exit)(true);
            } else if !Self::should_restart(exit, *self.restart_attempt.lock().await) {
                (self.callbacks.on_exit)(false);
            }

            let attempt = *self.restart_attempt.lock().await;
            if !Self::should_restart(exit, attempt) {
                if attempt >= MAX_RESTART_ATTEMPTS {
                    eprintln!(
                        "[HarnessFnMonitor] gave up after {MAX_RESTART_ATTEMPTS} restart attempts — toggle Global Fn hotkey in Settings or restart the app"
                    );
                }
                break;
            }

            let delay = {
                let mut guard = self.restart_attempt.lock().await;
                let idx = (*guard).min(RESTART_BACKOFF_MS.len() - 1);
                let delay = RESTART_BACKOFF_MS[idx];
                *guard += 1;
                delay
            };
            eprintln!("[HarnessFnMonitor] restarting in {delay}ms…");
            sleep(Duration::from_millis(delay)).await;
        }
    }

    async fn run_once(self: Arc<Self>) -> FnMonitorExit {
        self.kill_child().await;

        eprintln!(
            "[HarnessFnMonitor] starting {}",
            self.binary_path.display()
        );

        let mut child = match Command::new(&self.binary_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                eprintln!("[HarnessFnMonitor] spawn failed: {err}");
                return FnMonitorExit::SpawnFailed;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.child.lock().await = Some(child);

        let stderr_handle = stderr.map(|stderr| {
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    eprintln!("[HarnessFnMonitor] {}", line.trim_end());
                    line.clear();
                }
            })
        });

        if let Some(stdout) = stdout {
            let monitor = self.clone();
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stdout);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    *monitor.restart_attempt.lock().await = 0;
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                        let t = parsed.get("t").and_then(|v| v.as_str());
                        let phase = parsed.get("phase").and_then(|v| v.as_str());
                        let ms = parsed.get("ms").and_then(|v| v.as_i64());
                        if t == Some("fn") {
                            if matches!(phase, Some("down") | Some("up")) {
                                if let Some(ms) = ms {
                                    (monitor.callbacks.on_edge)(phase.unwrap(), ms);
                                }
                            }
                        }
                    }
                    line.clear();
                }
            });
        }

        let status = {
            let mut guard = self.child.lock().await;
            if let Some(child) = guard.as_mut() {
                child.wait().await.ok()
            } else {
                None
            }
        };
        *self.child.lock().await = None;

        if let Some(handle) = stderr_handle {
            let _ = handle.await;
        }

        match status {
            Some(s) if s.success() => FnMonitorExit::Exited {
                code: s.code(),
                signal: None,
            },
            Some(s) => {
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    FnMonitorExit::Exited {
                        code: s.code(),
                        signal: s.signal(),
                    }
                }
                #[cfg(not(unix))]
                {
                    FnMonitorExit::Exited {
                        code: s.code(),
                        signal: None,
                    }
                }
            }
            None => FnMonitorExit::Exited {
                code: None,
                signal: None,
            },
        }
    }
}
