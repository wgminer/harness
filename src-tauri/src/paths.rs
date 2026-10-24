use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::env_util::{user_data_dir, HARNESS_DEV_DATA_DIR_NAME, HARNESS_PROD_DATA_DIR_NAME};
use crate::storage::{read_json_array_file, read_json_object_file};

// Profile layout (v2). Only what a person would open sits at the top level:
//
//   <profile>/Conversations/<conv id>.json   one file per conversation
//   <profile>/Notes/<note id>.md             one file per note
//   <installed profile>/Recordings/          every take (shared with Harness Dev)
//   <profile>/.harness/                      settings, sync, indexes, everything else
//
// Sync bundles keep the v1 names (`app-state/messages_*.json`, `app-state/notes/*`)
// so iOS and older bundles are unaffected; `sync_rel_to_disk` maps between them.
const STATE_DIR: &str = ".harness";
const LEGACY_LOCAL_DATA_DIR: &str = "local-data";
const APP_STATE_DIR: &str = "app-state";
const SETTINGS_DIR: &str = "settings";
const SYNC_DIR: &str = "sync";
const CONVERSATIONS_DIR: &str = "Conversations";
const NOTES_DIR: &str = "Notes";
const RECORDINGS_DIR: &str = "Recordings";
const LEGACY_RECORDINGS_DIRS: [&str; 2] = ["recordings", "audio-recordings"];
const LEGACY_NOTES_DIR: &str = "notes";
const LEGACY_MESSAGES_PREFIX: &str = "messages_";
const SYNC_MESSAGES_PREFIX: &str = "app-state/messages_";
const SYNC_NOTES_PREFIX: &str = "app-state/notes/";
const LEGACY_MEMORY_DIR: &str = "memory";
const LEGACY_SETTINGS_FILE: &str = "settings.json";
const MIGRATION_MARKER_FILE: &str = ".migration-v1.json";
const LAYOUT_V2_MARKER_FILE: &str = ".layout-v2.json";
const DICTATION_INDEX_FILE: &str = "dictation_recordings.json";
/// Profile-root files that move into `.harness/`.
const ROOT_STATE_ENTRIES: [&str; 3] = ["layout.json", "credentials.json", "import-backups"];
/// Chromium caches left behind by the Electron build; nothing reads them.
const ELECTRON_CACHE_ENTRIES: [&str; 11] = [
    "Cache",
    "Code Cache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GPUCache",
    "Shared Dictionary",
    "blob_storage",
    "Trust Tokens",
    "Trust Tokens-journal",
    "Network Persistent State",
    ".updaterId",
];
/// Electron web storage, kept under `.harness/backups/electron/` rather than deleted.
const ELECTRON_STORAGE_ENTRIES: [&str; 3] = ["Local Storage", "Session Storage", "Preferences"];

static LAYOUT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn get_user_data_dir() -> PathBuf {
    user_data_dir()
}

pub fn get_legacy_memory_dir() -> PathBuf {
    get_user_data_dir().join(LEGACY_MEMORY_DIR)
}

/// Hidden app-owned folder (`<profile>/.harness/`) that sync bundles are rooted at.
pub fn get_local_data_dir() -> PathBuf {
    ensure_data_layout();
    let path = get_user_data_dir().join(STATE_DIR);
    std::fs::create_dir_all(&path).ok();
    path
}

pub fn get_app_state_dir() -> PathBuf {
    let path = get_local_data_dir().join(APP_STATE_DIR);
    std::fs::create_dir_all(&path).ok();
    path
}

/// Profile root when `app_state_dir` is `<root>/.harness/app-state`. Any other
/// directory (tests, ad-hoc imports) keeps the flat v1 layout.
fn profile_root_of_app_state(app_state_dir: &Path) -> Option<&Path> {
    let state_dir = app_state_dir.parent()?;
    if app_state_dir.file_name()? != APP_STATE_DIR || state_dir.file_name()? != STATE_DIR {
        return None;
    }
    state_dir.parent()
}

pub fn conversations_dir_in(app_state_dir: &Path) -> PathBuf {
    match profile_root_of_app_state(app_state_dir) {
        Some(root) => root.join(CONVERSATIONS_DIR),
        None => app_state_dir.to_path_buf(),
    }
}

/// Messages file for an already-sanitized conversation id.
pub fn messages_file_in(app_state_dir: &Path, safe_id: &str) -> PathBuf {
    match profile_root_of_app_state(app_state_dir) {
        Some(root) => root.join(CONVERSATIONS_DIR).join(format!("{safe_id}.json")),
        None => app_state_dir.join(format!("{LEGACY_MESSAGES_PREFIX}{safe_id}.json")),
    }
}

/// True when `name` (a file in `conversations_dir_in`) is a messages file.
pub fn is_messages_file_name_in(app_state_dir: &Path, name: &str) -> bool {
    if !name.ends_with(".json") || name.starts_with('.') {
        return false;
    }
    profile_root_of_app_state(app_state_dir).is_some() || name.starts_with(LEGACY_MESSAGES_PREFIX)
}

pub fn notes_dir_in(app_state_dir: &Path) -> PathBuf {
    match profile_root_of_app_state(app_state_dir) {
        Some(root) => root.join(NOTES_DIR),
        None => app_state_dir.join(LEGACY_NOTES_DIR),
    }
}

/// Disk path for a sync-bundle path rooted at `local_data_dir`.
pub fn sync_rel_to_disk(local_data_dir: &Path, rel: &str) -> PathBuf {
    let app_state_dir = local_data_dir.join(APP_STATE_DIR);
    if let Some(root) = profile_root_of_app_state(&app_state_dir) {
        if let Some(rest) = rel.strip_prefix(SYNC_MESSAGES_PREFIX) {
            return root.join(CONVERSATIONS_DIR).join(rest);
        }
        if let Some(rest) = rel.strip_prefix(SYNC_NOTES_PREFIX) {
            return root.join(NOTES_DIR).join(rest);
        }
    }
    local_data_dir.join(rel)
}

/// Top-level folders that hold part of the `app-state` sync scope, with the
/// bundle-path prefix their files map to. Empty for the flat v1 layout.
pub fn sync_app_state_extra_dirs(local_data_dir: &Path) -> Vec<(PathBuf, &'static str)> {
    let app_state_dir = local_data_dir.join(APP_STATE_DIR);
    match profile_root_of_app_state(&app_state_dir) {
        Some(root) => vec![
            (root.join(CONVERSATIONS_DIR), SYNC_MESSAGES_PREFIX),
            (root.join(NOTES_DIR), SYNC_NOTES_PREFIX),
        ],
        None => Vec::new(),
    }
}

pub fn get_local_data_settings_dir() -> PathBuf {
    let path = get_local_data_dir().join(SETTINGS_DIR);
    std::fs::create_dir_all(&path).ok();
    path
}

pub fn get_local_data_sync_dir() -> PathBuf {
    let path = get_local_data_dir().join(SYNC_DIR);
    std::fs::create_dir_all(&path).ok();
    path
}

pub fn get_local_data_settings_path() -> PathBuf {
    get_local_data_settings_dir().join(LEGACY_SETTINGS_FILE)
}

pub fn get_layout_path() -> PathBuf {
    get_local_data_dir().join("layout.json")
}

pub fn get_credentials_path() -> PathBuf {
    get_local_data_dir().join("credentials.json")
}

/// Resolve a bundled native helper or resource file (HarnessSpeech, tray PNGs).
pub fn resolve_bundled_resource(name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = std::env::var("RESOURCE_DIR") {
        candidates.push(PathBuf::from(&resource_dir).join(name));
        // Tauri 2 maps `../resources/*` in tauri.conf.json to `$RESOURCE/_up_/resources/*`.
        candidates.push(PathBuf::from(&resource_dir).join("_up_/resources").join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let resources = parent.join("../Resources");
            candidates.push(resources.join(name));
            candidates.push(resources.join("_up_/resources").join(name));
            candidates.push(parent.join(name));
        }
    }
    candidates.push(PathBuf::from("resources").join(name));
    candidates.push(PathBuf::from("../resources").join(name));
    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    None
}

/// Shared audio archive for Dev + installed profiles.
///
/// Credentials / sync identity / recordings are not split across `Harness` vs
/// `Harness Dev` — only app-state lives per profile. When `HARNESS_DATA_DIR` is
/// set (tests / alternate profiles), recordings stay under that override.
pub fn get_recordings_dir() -> PathBuf {
    let shared_root = shared_recordings_root();
    let next = shared_root.join(RECORDINGS_DIR);
    // Re-checked every call: an older build writing to `audio-recordings/` gets
    // folded back in instead of splitting the archive.
    for legacy in LEGACY_RECORDINGS_DIRS {
        merge_recordings_dir(&shared_root.join(legacy), &next);
    }
    std::fs::create_dir_all(&next).ok();
    migrate_dev_recordings_into_shared(&next);
    next
}

/// Application Support root that owns `Recordings/` (installed Harness,
/// unless `HARNESS_DATA_DIR` isolates the profile).
fn shared_recordings_root() -> PathBuf {
    if let Ok(path) = std::env::var("HARNESS_DATA_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::data_dir()
        .expect("data_dir")
        .join(HARNESS_PROD_DATA_DIR_NAME)
}

/// Move leftover Dev-profile WAVs into the shared installed archive once.
fn migrate_dev_recordings_into_shared(shared: &Path) {
    // Skip when HARNESS_DATA_DIR isolates tests away from real Application Support.
    if std::env::var("HARNESS_DATA_DIR")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .is_some()
    {
        return;
    }
    let Some(data_dir) = dirs::data_dir() else {
        return;
    };
    let legacy = data_dir
        .join(HARNESS_DEV_DATA_DIR_NAME)
        .join("audio-recordings");
    merge_recordings_dir(&legacy, shared);
}

/// Move files from `from` into `into` when the destination name is missing,
/// unioning the dictation index so no take loses its conversation link.
fn merge_recordings_dir(from: &Path, into: &Path) {
    if !from.is_dir() || is_same_dir(from, into) {
        return;
    }
    merge_dictation_index(from, into);
    move_path(from, into);
}

fn dictation_index_names(value: &Value) -> Vec<String> {
    match value {
        Value::String(name) => vec![name.clone()],
        Value::Array(items) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect(),
        _ => Vec::new(),
    }
}

fn merge_dictation_index(from_dir: &Path, into_dir: &Path) {
    let src = from_dir.join(DICTATION_INDEX_FILE);
    let dest = into_dir.join(DICTATION_INDEX_FILE);
    if !src.is_file() || !dest.is_file() {
        return;
    }
    let read = |path: &Path| {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Map<String, Value>>(&raw).ok())
    };
    let (Some(incoming), Some(mut merged)) = (read(&src), read(&dest)) else {
        return;
    };
    for (conversation_id, value) in incoming {
        let entry = merged
            .entry(conversation_id)
            .or_insert_with(|| Value::Array(Vec::new()));
        let mut names = dictation_index_names(entry);
        for name in dictation_index_names(&value) {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        *entry = Value::Array(names.into_iter().map(Value::String).collect());
    }
    let Ok(pretty) = serde_json::to_string_pretty(&merged) else {
        return;
    };
    if std::fs::write(&dest, pretty).is_ok() {
        let _ = std::fs::remove_file(&src);
    }
}

/// Same directory on disk (catches `recordings` vs `Recordings` on a
/// case-insensitive volume).
#[cfg(unix)]
fn is_same_dir(a: &Path, b: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (std::fs::metadata(a), std::fs::metadata(b)) {
        (Ok(x), Ok(y)) => x.dev() == y.dev() && x.ino() == y.ino(),
        _ => false,
    }
}

#[cfg(not(unix))]
fn is_same_dir(a: &Path, b: &Path) -> bool {
    a == b
}

/// Move `src` to `dest`. When both are folders, merge recursively; a name that
/// already exists at the destination stays behind in `src`.
fn move_path(src: &Path, dest: &Path) {
    if !src.exists() {
        return;
    }
    if dest.exists() {
        if src.is_dir() && dest.is_dir() && !is_same_dir(src, dest) {
            let Ok(entries) = std::fs::read_dir(src) else {
                return;
            };
            for entry in entries.flatten() {
                move_path(&entry.path(), &dest.join(entry.file_name()));
            }
            // Drop the folder once empty (ignore errors if anything remains).
            let _ = std::fs::remove_dir(src);
        }
        return;
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    if std::fs::rename(src, dest).is_ok() {
        return;
    }
    if src.is_dir() {
        if copy_dir_recursive(src, dest).is_ok() {
            let _ = std::fs::remove_dir_all(src);
        }
    } else if std::fs::copy(src, dest).is_ok() {
        let _ = std::fs::remove_file(src);
    }
}

fn copy_if_missing(from: &Path, to: &Path) {
    if from.exists() && !to.exists() {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let _ = std::fs::copy(from, to);
    }
}

fn migrate_legacy_app_state(root: &Path, app_state_dir: &Path) {
    let legacy_dir = root.join(LEGACY_MEMORY_DIR);
    if !legacy_dir.exists() {
        return;
    }
    std::fs::create_dir_all(app_state_dir).ok();
    let Ok(entries) = std::fs::read_dir(&legacy_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        let should_copy = name == "conversations.json"
            || name == "user_memory.json"
            || name == "tasks.json"
            || name == "notes.json"
            || name == "writing.md"
            || name == LEGACY_NOTES_DIR
            || name.starts_with(LEGACY_MESSAGES_PREFIX);
        if !should_copy {
            continue;
        }
        let src = legacy_dir.join(&*name);
        let dst = app_state_dir.join(&*name);
        if dst.exists() {
            continue;
        }
        if src.is_dir() {
            let _ = copy_dir_recursive(&src, &dst);
        } else {
            let _ = std::fs::copy(&src, &dst);
        }
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &dest)?;
        } else {
            std::fs::copy(entry.path(), dest)?;
        }
    }
    Ok(())
}

fn migrate_legacy_settings_and_themes(root: &Path, state_dir: &Path) {
    copy_if_missing(
        &root.join(LEGACY_SETTINGS_FILE),
        &state_dir.join(SETTINGS_DIR).join(LEGACY_SETTINGS_FILE),
    );
    for themes in [root.join("themes"), state_dir.join("themes")] {
        if themes.exists() {
            let _ = std::fs::remove_dir_all(&themes);
        }
    }
}

/// `app-state/messages_<id>.json` → `Conversations/<id>.json`, `app-state/notes/`
/// → `Notes/`. Anything that collides goes to `.harness/backups/layout-v2/` so
/// sync never sees the same bundle path twice.
fn move_conversations_and_notes_out(root: &Path, state_dir: &Path) {
    let app_state_dir = state_dir.join(APP_STATE_DIR);
    let leftovers = state_dir.join("backups").join("layout-v2");
    if let Ok(entries) = std::fs::read_dir(&app_state_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            let Some(rest) = name.strip_prefix(LEGACY_MESSAGES_PREFIX) else {
                continue;
            };
            if !rest.ends_with(".json") || !entry.path().is_file() {
                continue;
            }
            let src = entry.path();
            move_path(&src, &root.join(CONVERSATIONS_DIR).join(rest));
            move_path(&src, &leftovers.join(&*name));
        }
    }
    let legacy_notes = app_state_dir.join(LEGACY_NOTES_DIR);
    move_path(&legacy_notes, &root.join(NOTES_DIR));
    move_path(&legacy_notes, &leftovers.join(LEGACY_NOTES_DIR));
}

fn remove_electron_leftovers(root: &Path, state_dir: &Path) {
    for name in ELECTRON_CACHE_ENTRIES {
        let path = root.join(name);
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        } else if path.exists() {
            let _ = std::fs::remove_file(&path);
        }
    }
    let backup = state_dir.join("backups").join("electron");
    for name in ELECTRON_STORAGE_ENTRIES {
        move_path(&root.join(name), &backup.join(name));
    }
}

fn migrate_to_layout_v2(root: &Path) {
    let state_dir = root.join(STATE_DIR);
    move_path(&root.join(LEGACY_LOCAL_DATA_DIR), &state_dir);
    std::fs::create_dir_all(&state_dir).ok();

    let v1_marker = state_dir.join(MIGRATION_MARKER_FILE);
    if !v1_marker.exists() {
        migrate_legacy_app_state(root, &state_dir.join(APP_STATE_DIR));
        migrate_legacy_settings_and_themes(root, &state_dir);
        let v1_content = serde_json::json!({
            "version": 1,
            "migratedAt": chrono::Utc::now().timestamp_millis()
        });
        let _ = std::fs::write(
            &v1_marker,
            serde_json::to_string_pretty(&v1_content).unwrap_or_default(),
        );
    }

    move_conversations_and_notes_out(root, &state_dir);
    for name in ROOT_STATE_ENTRIES {
        move_path(&root.join(name), &state_dir.join(name));
    }
    remove_electron_leftovers(root, &state_dir);
}

/// Bring the profile up to the v2 layout once; a single stat when already done.
pub fn ensure_data_layout() {
    let root = get_user_data_dir();
    let marker = root.join(STATE_DIR).join(LAYOUT_V2_MARKER_FILE);
    if marker.exists() {
        return;
    }
    let _guard = LAYOUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if marker.exists() {
        return;
    }
    migrate_to_layout_v2(&root);
    let marker_content = serde_json::json!({
        "version": 2,
        "migratedAt": chrono::Utc::now().timestamp_millis()
    });
    let _ = std::fs::write(
        &marker,
        serde_json::to_string_pretty(&marker_content).unwrap_or_default(),
    );
}

pub fn cleanup_legacy_memory_dir() -> bool {
    let legacy = get_legacy_memory_dir();
    if !legacy.exists() {
        return false;
    }
    std::fs::remove_dir_all(&legacy).is_ok()
}

pub async fn read_app_state_object(path: &Path) -> Value {
    read_json_object_file(path).await.value
}

pub async fn read_app_state_array<T: serde::de::DeserializeOwned>(path: &Path) -> Vec<T> {
    read_json_array_file(path).await
}

pub use crate::storage::WriteChains;

#[cfg(test)]
mod bundled_resource_tests {
    use super::resolve_bundled_resource;

    #[test]
    fn resolve_icon_tray_from_resources() {
        assert!(
            resolve_bundled_resource("icon-tray.png").is_some(),
            "icon-tray.png should resolve from resources/"
        );
    }

    #[test]
    fn resolve_icon_tray_from_tauri_up_resources_dir() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let bundled = tmp.path().join("_up_/resources");
        std::fs::create_dir_all(&bundled).expect("create bundled dir");
        let icon = bundled.join("icon-tray.png");
        std::fs::write(&icon, b"tray").expect("write icon");

        let key = "RESOURCE_DIR";
        let prev = std::env::var(key).ok();
        // SAFETY: test runs in isolation; restored before return.
        unsafe { std::env::set_var(key, tmp.path()) };
        let resolved = resolve_bundled_resource("icon-tray.png");
        match prev {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }

        assert_eq!(resolved, Some(icon));
    }
}

#[cfg(test)]
mod recordings_dir_tests {
    use super::{merge_recordings_dir, shared_recordings_root};
    use crate::env_util::HARNESS_PROD_DATA_DIR_NAME;

    #[test]
    fn shared_root_uses_harness_data_dir_override() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let key = "HARNESS_DATA_DIR";
        let prev = std::env::var(key).ok();
        unsafe { std::env::set_var(key, tmp.path()) };
        let root = shared_recordings_root();
        match prev {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => unsafe { std::env::remove_var(key) },
        }
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn shared_root_defaults_to_installed_harness() {
        let key = "HARNESS_DATA_DIR";
        let prev = std::env::var(key).ok();
        unsafe { std::env::remove_var(key) };
        let root = shared_recordings_root();
        match prev {
            Some(v) => unsafe { std::env::set_var(key, v) },
            None => {}
        }
        let expected = dirs::data_dir()
            .expect("data_dir")
            .join(HARNESS_PROD_DATA_DIR_NAME);
        assert_eq!(root, expected);
    }

    #[test]
    fn merge_moves_missing_files_into_shared() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let shared = tmp.path().join("shared");
        let legacy = tmp.path().join("legacy");
        std::fs::create_dir_all(&shared).expect("shared");
        std::fs::create_dir_all(&legacy).expect("legacy");
        std::fs::write(legacy.join("rec_a.wav"), b"a").expect("wav");
        std::fs::write(legacy.join("keep_in_shared.wav"), b"old").expect("wav");
        std::fs::write(shared.join("keep_in_shared.wav"), b"new").expect("wav");
        std::fs::create_dir_all(legacy.join("drop-cache")).expect("cache");
        std::fs::write(legacy.join("drop-cache").join("x.m4a"), b"x").expect("m4a");

        merge_recordings_dir(&legacy, &shared);

        assert_eq!(
            std::fs::read(shared.join("keep_in_shared.wav")).unwrap(),
            b"new"
        );
        assert_eq!(std::fs::read(shared.join("rec_a.wav")).unwrap(), b"a");
        assert!(shared.join("drop-cache").join("x.m4a").is_file());
        assert!(!legacy.join("rec_a.wav").exists());
        // Conflicting name left in legacy; folder may still exist.
        assert_eq!(
            std::fs::read(legacy.join("keep_in_shared.wav")).unwrap(),
            b"old"
        );
    }
}

#[cfg(test)]
mod layout_v2_tests {
    use super::{
        merge_dictation_index, messages_file_in, migrate_to_layout_v2, notes_dir_in,
        sync_rel_to_disk,
    };
    use std::path::Path;

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).expect("parent");
        std::fs::write(path, contents).expect("write");
    }

    fn read(path: &Path) -> String {
        std::fs::read_to_string(path).expect("read")
    }

    #[test]
    fn migrates_v1_profile_into_v2_layout() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        let app_state = root.join("local-data/app-state");
        write(&root.join("local-data/.migration-v1.json"), "{}");
        write(&app_state.join("conversations.json"), "{}");
        write(&app_state.join("messages_conv_1_ab.json"), "[1]");
        write(&app_state.join("notes/n1.md"), "# One");
        write(&app_state.join("notes.json"), r#"{"notes":[]}"#);
        write(&root.join("local-data/settings/settings.json"), r#"{"version":1}"#);
        write(&root.join("layout.json"), "{}");
        write(&root.join("import-backups/claude/conversations.json"), "[]");
        write(&root.join("GPUCache/index"), "x");
        write(&root.join(".updaterId"), "x");
        write(&root.join("Local Storage/leveldb/LOG"), "log");

        migrate_to_layout_v2(root);

        assert_eq!(read(&root.join("Conversations/conv_1_ab.json")), "[1]");
        assert_eq!(read(&root.join("Notes/n1.md")), "# One");
        let state = root.join(".harness");
        assert_eq!(read(&state.join("app-state/conversations.json")), "{}");
        assert!(state.join("app-state/notes.json").is_file());
        assert!(!state.join("app-state/messages_conv_1_ab.json").exists());
        assert!(!state.join("app-state/notes").exists());
        assert!(state.join("settings/settings.json").is_file());
        assert!(state.join("layout.json").is_file());
        assert!(state.join("import-backups/claude/conversations.json").is_file());
        assert!(state.join("backups/electron/Local Storage/leveldb/LOG").is_file());
        for gone in ["local-data", "layout.json", "GPUCache", ".updaterId", "Local Storage"] {
            assert!(!root.join(gone).exists(), "{gone} should be gone");
        }
    }

    #[test]
    fn colliding_files_move_to_backups_not_sync_scope() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write(&root.join("Conversations/conv_1_ab.json"), "[new]");
        write(&root.join("Notes/n1.md"), "# New");
        write(&root.join(".harness/.migration-v1.json"), "{}");
        let app_state = root.join(".harness/app-state");
        write(&app_state.join("messages_conv_1_ab.json"), "[old]");
        write(&app_state.join("notes/n1.md"), "# Old");
        write(&app_state.join("notes/n2.md"), "# Two");

        migrate_to_layout_v2(root);

        assert_eq!(read(&root.join("Conversations/conv_1_ab.json")), "[new]");
        assert_eq!(read(&root.join("Notes/n1.md")), "# New");
        assert_eq!(read(&root.join("Notes/n2.md")), "# Two");
        let leftovers = root.join(".harness/backups/layout-v2");
        assert_eq!(read(&leftovers.join("messages_conv_1_ab.json")), "[old]");
        assert_eq!(read(&leftovers.join("notes/n1.md")), "# Old");
        assert!(!app_state.join("messages_conv_1_ab.json").exists());
        assert!(!app_state.join("notes").exists());
    }

    #[test]
    fn copies_pre_v1_memory_dir_then_lays_it_out() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        write(&root.join("memory/messages_conv_9.json"), "[9]");
        write(&root.join("memory/notes/n9.md"), "# Nine");
        write(&root.join("settings.json"), r#"{"version":1}"#);

        migrate_to_layout_v2(root);

        assert_eq!(read(&root.join("Conversations/conv_9.json")), "[9]");
        assert_eq!(read(&root.join("Notes/n9.md")), "# Nine");
        assert!(root.join(".harness/settings/settings.json").is_file());
        assert!(root.join(".harness/.migration-v1.json").is_file());
    }

    #[test]
    fn helpers_split_v2_profiles_from_flat_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let root = tmp.path();
        let app_state = root.join(".harness/app-state");
        assert_eq!(
            messages_file_in(&app_state, "conv_1"),
            root.join("Conversations/conv_1.json")
        );
        assert_eq!(notes_dir_in(&app_state), root.join("Notes"));
        assert_eq!(
            sync_rel_to_disk(&root.join(".harness"), "app-state/messages_conv_1.json"),
            root.join("Conversations/conv_1.json")
        );
        assert_eq!(
            sync_rel_to_disk(&root.join(".harness"), "app-state/tasks.json"),
            root.join(".harness/app-state/tasks.json")
        );

        let flat = root.join("scratch");
        assert_eq!(
            messages_file_in(&flat, "conv_1"),
            flat.join("messages_conv_1.json")
        );
        assert_eq!(notes_dir_in(&flat), flat.join("notes"));
    }

    #[test]
    fn dictation_index_merge_keeps_links_from_both() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let from = tmp.path().join("audio-recordings");
        let into = tmp.path().join("Recordings");
        write(
            &from.join("dictation_recordings.json"),
            r#"{"conv_a":["rec_2.wav"],"conv_b":"rec_3.wav"}"#,
        );
        write(&into.join("dictation_recordings.json"), r#"{"conv_a":["rec_1.wav"]}"#);

        merge_dictation_index(&from, &into);

        let merged: serde_json::Value =
            serde_json::from_str(&read(&into.join("dictation_recordings.json"))).unwrap();
        assert_eq!(merged["conv_a"], serde_json::json!(["rec_1.wav", "rec_2.wav"]));
        assert_eq!(merged["conv_b"], serde_json::json!(["rec_3.wav"]));
        assert!(!from.join("dictation_recordings.json").exists());
    }
}
