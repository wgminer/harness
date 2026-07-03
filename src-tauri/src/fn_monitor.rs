use std::path::PathBuf;
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

pub fn resolve_fn_monitor_path() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }

    let mut candidates = Vec::new();
    if let Ok(resource_dir) = std::env::var("RESOURCE_DIR") {
        candidates.push(PathBuf::from(resource_dir).join("HarnessFnMonitor"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("../Resources/HarnessFnMonitor"));
            candidates.push(parent.join("HarnessFnMonitor"));
        }
    }
    candidates.push(PathBuf::from("resources/HarnessFnMonitor"));
    candidates.push(PathBuf::from("../resources/HarnessFnMonitor"));

    let tried: Vec<String> = candidates.iter().map(|p| p.display().to_string()).collect();
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    eprintln!(
        "HarnessFnMonitor: binary not found. Tried: {}",
        tried.join(", ")
    );
    None
}

pub struct FnMonitorCallbacks {
    pub on_edge: Arc<dyn Fn(&str, i64) + Send + Sync>,
    pub on_exit: Arc<dyn Fn(Option<i32>) + Send + Sync>,
}

const RESTART_BACKOFF_MS: [u64; 3] = [1_000, 3_000, 10_000];

pub struct FnMonitorProcess {
    binary_path: PathBuf,
    callbacks: FnMonitorCallbacks,
    child: Mutex<Option<Child>>,
    disposed: Mutex<bool>,
    restart_attempt: Mutex<usize>,
}

impl FnMonitorProcess {
    pub fn new(binary_path: PathBuf, callbacks: FnMonitorCallbacks) -> Self {
        Self {
            binary_path,
            callbacks,
            child: Mutex::new(None),
            disposed: Mutex::new(false),
            restart_attempt: Mutex::new(0),
        }
    }

    pub fn start(self: Arc<Self>) {
        *self.disposed.blocking_lock() = false;
        let monitor = self.clone();
        tauri::async_runtime::spawn(async move {
            monitor.run_loop().await;
        });
    }

    pub async fn dispose(&self) {
        *self.disposed.lock().await = true;
        self.kill_child().await;
    }

    async fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn run_loop(self: Arc<Self>) {
        while !*self.disposed.lock().await {
            let exit_code = self.clone().run_once().await;
            (self.callbacks.on_exit)(exit_code);
            if *self.disposed.lock().await {
                break;
            }
            let delay = {
                let mut guard = self.restart_attempt.lock().await;
                let idx = (*guard).min(RESTART_BACKOFF_MS.len() - 1);
                let delay = RESTART_BACKOFF_MS[idx];
                *guard += 1;
                delay
            };
            sleep(Duration::from_millis(delay)).await;
        }
    }

    async fn run_once(self: Arc<Self>) -> Option<i32> {
        self.kill_child().await;

        let mut child = match Command::new(&self.binary_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
        {
            Ok(child) => child,
            Err(err) => {
                eprintln!("[HarnessFnMonitor] spawn failed: {err}");
                return None;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        *self.child.lock().await = Some(child);

        if let Some(stderr) = stderr {
            tauri::async_runtime::spawn(async move {
                let mut reader = BufReader::new(stderr);
                let mut line = String::new();
                while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                    eprintln!("[HarnessFnMonitor] {}", line.trim_end());
                    line.clear();
                }
            });
        }

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

        let exit_code = {
            let mut guard = self.child.lock().await;
            if let Some(child) = guard.as_mut() {
                child.wait().await.ok().and_then(|s| s.code())
            } else {
                None
            }
        };
        *self.child.lock().await = None;
        exit_code
    }
}
