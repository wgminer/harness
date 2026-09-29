//! Plain text files opened from outside Harness (`harness <path>`, Finder
//! "Open With"), edited in place in their own window.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::notes::{self, Note};
use crate::state::AppState;
use crate::storage::atomic_write_utf8;

pub const FILE_WINDOW_LABEL_PREFIX: &str = "file-";
/// Error message returned when a save was based on an older version of the file.
pub const FILE_CONFLICT_ERROR: &str = "file_conflict";
const MAX_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
const DEFAULT_WIDTH: f64 = 720.0;
const DEFAULT_HEIGHT: f64 = 760.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub path: String,
    pub name: String,
    pub content: String,
    pub modified_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub path: String,
    /// False when the install folder isn't on the login shell's PATH.
    pub on_path: bool,
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn clean_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("A file path is required.".into());
    }
    let p = PathBuf::from(trimmed);
    if !p.is_absolute() {
        return Err(format!("Expected an absolute path: {trimmed}"));
    }
    // Resolve symlinks so saves replace the real file, not the link.
    Ok(p.canonicalize().unwrap_or(p))
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Untitled")
        .to_string()
}

pub async fn read_text_file(path: &str) -> Result<TextFile, String> {
    let path = clean_path(path)?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("That path is a folder.".into());
    }
    if meta.len() > MAX_TEXT_FILE_BYTES {
        return Err("File is too large to edit here.".into());
    }
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let content = String::from_utf8(bytes).map_err(|_| "Not a UTF-8 text file.".to_string())?;
    Ok(TextFile {
        name: display_name(&path),
        path: path.to_string_lossy().into_owned(),
        content,
        modified_ms: modified_ms(&meta),
    })
}

/// Current modification time, or `None` when the file no longer exists.
pub async fn stat_text_file(path: &str) -> Result<Option<i64>, String> {
    let path = clean_path(path)?;
    match tokio::fs::metadata(&path).await {
        Ok(meta) => Ok(Some(modified_ms(&meta))),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

/// Writes `content` atomically. With `expected_modified_ms`, refuses with
/// `FILE_CONFLICT_ERROR` when the file changed on disk since it was read.
pub async fn save_text_file(
    state: &AppState,
    path: &str,
    content: &str,
    expected_modified_ms: Option<i64>,
) -> Result<i64, String> {
    let path = clean_path(path)?;
    if let Some(expected) = expected_modified_ms {
        if let Ok(meta) = tokio::fs::metadata(&path).await {
            if modified_ms(&meta) != expected {
                return Err(FILE_CONFLICT_ERROR.into());
            }
        }
    }
    atomic_write_utf8(&state.write_chains, &path, content)
        .await
        .map_err(|e| e.to_string())?;
    let meta = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    Ok(modified_ms(&meta))
}

/// Copies a markdown file into the notes library. The title comes from its
/// leading `# H1`, falling back to the file name.
pub async fn import_file_as_note(state: &AppState, path: &str) -> Result<Note, String> {
    let file = read_text_file(path).await?;
    let stem = Path::new(&file.name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported note")
        .to_string();
    let content = notes::ensure_leading_note_h1(&file.content, &stem);
    notes::create_note(state, Some(&stem), &content)
        .await
        .map_err(|e| e.to_string())
}

pub fn file_window_label(path: &Path) -> String {
    let digest = Sha256::digest(path.to_string_lossy().as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{FILE_WINDOW_LABEL_PREFIX}{hex}")
}

pub fn open_file_window(app: &AppHandle, path: &Path) -> Result<(), String> {
    let label = file_window_label(path);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }
    let url = format!(
        "index.html?file={}",
        urlencoding::encode(&path.to_string_lossy())
    );
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(display_name(path))
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Resolves a CLI argument against the invoking shell's working directory.
/// Flags (`-psn_…`, `--foo`) are ignored.
pub fn resolve_cli_path(arg: &str, cwd: &Path) -> Option<PathBuf> {
    let trimmed = arg.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }
    let raw = trimmed.strip_prefix("file://").unwrap_or(trimmed);
    let decoded = urlencoding::decode(raw)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| raw.to_string());
    let expanded = match decoded.strip_prefix("~/") {
        Some(rest) => dirs::home_dir()?.join(rest),
        None => PathBuf::from(&decoded),
    };
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };
    Some(absolute.canonicalize().unwrap_or(absolute))
}

/// Routes a path handed to Harness: Harness notes open as notes, other files
/// open in a file window, and folders just bring Harness forward.
pub fn open_path(app: &AppHandle, path: &Path) {
    if path.is_dir() || !path.exists() {
        focus_main(app);
        return;
    }
    if let Some(note_id) = notes::note_id_for_file(path) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let state = app.state::<AppState>();
            if notes::sticky::open_sticky_window(&app, &state, &note_id, None)
                .await
                .is_err()
            {
                focus_main(&app);
            }
        });
        return;
    }
    if open_file_window(app, path).is_err() {
        focus_main(app);
    }
}

/// Opens every path argument; with none, brings the main window forward.
pub fn open_paths_from_args<I, S>(app: &AppHandle, args: I, cwd: &Path)
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let paths: Vec<PathBuf> = args
        .into_iter()
        .filter_map(|arg| resolve_cli_path(arg.as_ref(), cwd))
        .collect();
    if paths.is_empty() {
        focus_main(app);
        return;
    }
    for path in paths {
        open_path(app, &path);
    }
}

fn cli_script(exe: &Path) -> String {
    format!(
        r#"#!/bin/sh
# harness: open files in Harness. Usage: harness <file>...
# Installed by Harness (Settings > General). Missing files are created empty.
HARNESS_BIN="{exe}"
if [ ! -x "$HARNESS_BIN" ]; then
  echo "harness: app not found at $HARNESS_BIN; reinstall the command from Harness settings." >&2
  exit 1
fi
set -f
count=$#
for p in "$@"; do
  case "$p" in
    -*) continue ;;
    /*) abs="$p" ;;
    *) abs="$PWD/$p" ;;
  esac
  if [ ! -e "$abs" ] && [ -d "$(dirname "$abs")" ]; then
    : > "$abs"
  fi
  set -- "$@" "$abs"
done
# Drop the original arguments, keeping only the resolved absolute paths.
shift "$count"
nohup "$HARNESS_BIN" "$@" >/dev/null 2>&1 &
"#,
        exe = exe.to_string_lossy().replace('"', "\\\"")
    )
}

fn dir_on_path(dir: &Path) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|p| p == dir))
        .unwrap_or(false)
        || dir == Path::new("/usr/local/bin")
}

/// Writes the `harness` shell command into `/usr/local/bin`, or `~/.local/bin`
/// when that isn't writable.
pub fn install_cli() -> Result<CliInstallResult, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let script = cli_script(&exe);
    let mut candidates = vec![PathBuf::from("/usr/local/bin")];
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local/bin"));
    }
    let mut last_err = String::from("No install location available.");
    for dir in candidates {
        if std::fs::create_dir_all(&dir).is_err() {
            continue;
        }
        let target = dir.join("harness");
        match write_executable(&target, &script) {
            Ok(()) => {
                return Ok(CliInstallResult {
                    path: target.to_string_lossy().into_owned(),
                    on_path: dir_on_path(&dir),
                })
            }
            Err(err) => last_err = err,
        }
    }
    Err(last_err)
}

fn write_executable(target: &Path, script: &str) -> Result<(), String> {
    std::fs::write(target, script).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_cli_path_handles_relative_absolute_and_flags() {
        let cwd = Path::new("/tmp/does-not-exist-harness");
        assert_eq!(
            resolve_cli_path("notes/today.md", cwd),
            Some(cwd.join("notes/today.md"))
        );
        assert_eq!(
            resolve_cli_path("/var/empty-harness/x.md", cwd),
            Some(PathBuf::from("/var/empty-harness/x.md"))
        );
        assert_eq!(resolve_cli_path("-psn_0_12345", cwd), None);
        assert_eq!(resolve_cli_path("  ", cwd), None);
        assert_eq!(
            resolve_cli_path("file:///var/empty-harness/a%20b.md", cwd),
            Some(PathBuf::from("/var/empty-harness/a b.md"))
        );
    }

    #[test]
    fn file_window_label_is_stable_and_prefixed() {
        let a = file_window_label(Path::new("/a/b.md"));
        assert_eq!(a, file_window_label(Path::new("/a/b.md")));
        assert!(a.starts_with(FILE_WINDOW_LABEL_PREFIX));
        assert_ne!(a, file_window_label(Path::new("/a/c.md")));
    }
}
