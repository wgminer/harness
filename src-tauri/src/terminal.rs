//! Per-conversation terminals: one PTY per conversation, started lazily and kept
//! alive across conversation switches. Local to this desktop; nothing here syncs.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::coding::shell::SCRUBBED_ENV_KEYS;

/// Output kept per session so a reopened panel can replay what it missed.
const SCROLLBACK_CAP: usize = 512 * 1024;

#[derive(Default)]
struct Output {
    buf: Vec<u8>,
    /// Total bytes ever produced; lets the renderer drop chunks the replay already covers.
    end_offset: u64,
}

impl Output {
    fn push(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
        self.end_offset += chunk.len() as u64;
        if self.buf.len() > SCROLLBACK_CAP {
            let cut = self.buf.len() - SCROLLBACK_CAP;
            // Start the kept tail on a line boundary so replay does not open mid-sequence.
            let cut = self.buf[cut..]
                .iter()
                .position(|b| *b == b'\n')
                .map_or(cut, |i| cut + i + 1);
            self.buf.drain(..cut);
        }
    }
}

struct Session {
    generation: u64,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    output: Arc<Mutex<Output>>,
    cwd: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSnapshot {
    /// Base64 of the raw scrollback bytes.
    pub scrollback: String,
    pub end_offset: u64,
    pub cwd: String,
}

#[derive(Default)]
struct Inner {
    sessions: Mutex<HashMap<String, Session>>,
    next_generation: AtomicU64,
}

#[derive(Clone, Default)]
pub struct TerminalRuntime {
    inner: Arc<Inner>,
}

fn encode(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn shell_command(cwd: &Path) -> CommandBuilder {
    #[cfg(windows)]
    let mut cmd = CommandBuilder::new("powershell.exe");
    #[cfg(not(windows))]
    let mut cmd = {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        cmd
    };
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    for key in SCRUBBED_ENV_KEYS {
        cmd.env_remove(key);
    }
    cmd
}

impl TerminalRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach to the conversation's terminal, spawning its shell in `cwd` on first use.
    pub fn open(
        &self,
        app: &AppHandle,
        conversation_id: &str,
        cwd: &Path,
        cols: u16,
        rows: u16,
    ) -> Result<TerminalSnapshot, String> {
        let mut sessions = self.inner.sessions.lock().unwrap();
        if let Some(session) = sessions.get(conversation_id) {
            let _ = session.master.resize(pty_size(cols, rows));
            return Ok(snapshot(session));
        }

        let pair = native_pty_system()
            .openpty(pty_size(cols, rows))
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
        let child = pair
            .slave
            .spawn_command(shell_command(cwd))
            .map_err(|e| format!("Could not start the shell: {e}"))?;
        drop(pair.slave);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Could not read from the terminal: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Could not write to the terminal: {e}"))?;

        let generation = self.inner.next_generation.fetch_add(1, Ordering::Relaxed);
        let output = Arc::new(Mutex::new(Output::default()));
        let session = Session {
            generation,
            master: pair.master,
            writer,
            child,
            output: output.clone(),
            cwd: cwd.to_path_buf(),
        };
        let result = snapshot(&session);
        sessions.insert(conversation_id.to_string(), session);
        drop(sessions);

        let runtime = self.clone();
        let app = app.clone();
        let conversation_id = conversation_id.to_string();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                let n = match reader.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                let offset = {
                    let mut out = output.lock().unwrap();
                    let offset = out.end_offset;
                    out.push(&chunk[..n]);
                    offset
                };
                let _ = app.emit(
                    "terminal-data",
                    json!({
                        "conversationId": conversation_id,
                        "offset": offset,
                        "data": encode(&chunk[..n]),
                    }),
                );
            }
            // Only a shell that ended on its own is still in the map; `close` already took it.
            if let Some(mut session) = runtime.take_if_generation(&conversation_id, generation) {
                let _ = session.child.wait();
                let _ = app.emit(
                    "terminal-exit",
                    json!({ "conversationId": conversation_id }),
                );
            }
        });

        Ok(result)
    }

    pub fn write(&self, conversation_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.inner.sessions.lock().unwrap();
        let session = sessions
            .get_mut(conversation_id)
            .ok_or_else(|| "This terminal is not running.".to_string())?;
        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|e| format!("Could not write to the terminal: {e}"))
    }

    pub fn resize(&self, conversation_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.inner.sessions.lock().unwrap();
        let Some(session) = sessions.get(conversation_id) else {
            return Ok(());
        };
        session
            .master
            .resize(pty_size(cols, rows))
            .map_err(|e| format!("Could not resize the terminal: {e}"))
    }

    /// End the conversation's shell, if it has one.
    pub fn close(&self, conversation_id: &str) {
        let session = self.inner.sessions.lock().unwrap().remove(conversation_id);
        if let Some(mut session) = session {
            // Reap off-thread: kill can wait briefly for the shell to hang up.
            std::thread::spawn(move || {
                let _ = session.child.kill();
                let _ = session.child.wait();
            });
        }
    }

    pub fn kill_all(&self) {
        let sessions: Vec<Session> = self
            .inner
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, s)| s)
            .collect();
        for mut session in sessions {
            let _ = session.child.kill();
        }
    }

    fn take_if_generation(&self, conversation_id: &str, generation: u64) -> Option<Session> {
        let mut sessions = self.inner.sessions.lock().unwrap();
        if sessions.get(conversation_id)?.generation != generation {
            return None;
        }
        sessions.remove(conversation_id)
    }
}

fn snapshot(session: &Session) -> TerminalSnapshot {
    let out = session.output.lock().unwrap();
    TerminalSnapshot {
        scrollback: encode(&out.buf),
        end_offset: out.end_offset,
        cwd: session.cwd.display().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn output_keeps_counting_after_trimming_scrollback() {
        let mut out = Output::default();
        let line = b"0123456789abcde\n";
        let lines = SCROLLBACK_CAP / line.len() + 10;
        for _ in 0..lines {
            out.push(line);
        }
        assert_eq!(out.end_offset, (lines * line.len()) as u64);
        assert!(out.buf.len() <= SCROLLBACK_CAP);
        assert!(out.buf.starts_with(b"0123"));
    }

    /// Runs the user's login shell, so it is opt-in: `cargo test terminal -- --ignored`.
    #[test]
    #[ignore]
    fn shell_runs_in_the_given_folder() {
        let dir = tempfile::tempdir().unwrap();
        let pair = native_pty_system().openpty(pty_size(80, 24)).unwrap();
        let mut child = pair.slave.spawn_command(shell_command(dir.path())).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        writer.write_all(b"echo marker-$(basename \"$PWD\"); exit\n").unwrap();
        let mut seen = Vec::new();
        let mut chunk = [0u8; 4096];
        while let Ok(n) = reader.read(&mut chunk) {
            if n == 0 {
                break;
            }
            seen.extend_from_slice(&chunk[..n]);
        }
        let _ = child.wait();
        let name = dir.path().file_name().unwrap().to_string_lossy().to_string();
        assert!(String::from_utf8_lossy(&seen).contains(&format!("marker-{name}")));
    }
}
