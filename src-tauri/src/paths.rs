use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::env_util::{user_data_dir, HARNESS_DEV_DATA_DIR_NAME, HARNESS_PROD_DATA_DIR_NAME};
use crate::storage::{read_json_array_file, read_json_object_file};

const LOCAL_DATA_DIR: &str = "local-data";
const APP_STATE_DIR: &str = "app-state";
const SETTINGS_DIR: &str = "settings";
const SYNC_DIR: &str = "sync";
const LEGACY_MEMORY_DIR: &str = "memory";
const LEGACY_SETTINGS_FILE: &str = "settings.json";
const MIGRATION_MARKER_FILE: &str = ".migration-v1.json";

pub fn get_user_data_dir() -> PathBuf {
    user_data_dir()
}

pub fn get_legacy_memory_dir() -> PathBuf {
    get_user_data_dir().join(LEGACY_MEMORY_DIR)
}

pub fn get_local_data_dir() -> PathBuf {
    let path = get_user_data_dir().join(LOCAL_DATA_DIR);
    std::fs::create_dir_all(&path).ok();
    path
}

pub fn get_app_state_dir() -> PathBuf {
    ensure_local_data_migration();
    let path = get_local_data_dir().join(APP_STATE_DIR);
    std::fs::create_dir_all(&path).ok();
    path
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
    get_user_data_dir().join("layout.json")
}

pub fn get_credentials_path() -> PathBuf {
    get_user_data_dir().join("credentials.json")
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
    let legacy = shared_root.join("recordings");
    let next = shared_root.join("audio-recordings");
    if legacy.exists() && !next.exists() {
        let _ = std::fs::rename(&legacy, &next);
    }
    std::fs::create_dir_all(&next).ok();
    migrate_dev_recordings_into_shared(&next);
    next
}

/// Application Support root that owns `audio-recordings/` (installed Harness,
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

/// Move files from `from` into `into` when the destination name is missing.
fn merge_recordings_dir(from: &Path, into: &Path) {
    if !from.exists() || from == into {
        return;
    }
    let Ok(entries) = std::fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let src = entry.path();
        let name = entry.file_name();
        let dest = into.join(&name);
        if dest.exists() {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            let _ = copy_dir_recursive(&src, &dest);
            let _ = std::fs::remove_dir_all(&src);
        } else if std::fs::rename(&src, &dest).is_err() {
            if std::fs::copy(&src, &dest).is_ok() {
                let _ = std::fs::remove_file(&src);
            }
        }
    }
    // Drop empty leftover folder (ignore errors if anything remains).
    let _ = std::fs::remove_dir(from);
}

fn copy_if_missing(from: &Path, to: &Path) {
    if from.exists() && !to.exists() {
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let _ = std::fs::copy(from, to);
    }
}

fn migrate_legacy_app_state() {
    let legacy_dir = get_legacy_memory_dir();
    let app_state_dir = get_local_data_dir().join(APP_STATE_DIR);
    if !legacy_dir.exists() {
        return;
    }
    std::fs::create_dir_all(&app_state_dir).ok();
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
            || name == "notes"
            || name.starts_with("messages_");
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

fn migrate_legacy_settings_and_themes() {
    let user_data = get_user_data_dir();
    copy_if_missing(
        &user_data.join(LEGACY_SETTINGS_FILE),
        &get_local_data_settings_path(),
    );
    for themes in [
        user_data.join("themes"),
        get_local_data_dir().join("themes"),
    ] {
        if themes.exists() {
            let _ = std::fs::remove_dir_all(&themes);
        }
    }
}

pub fn ensure_local_data_migration() {
    let marker = get_local_data_dir().join(MIGRATION_MARKER_FILE);
    if marker.exists() {
        return;
    }
    migrate_legacy_app_state();
    migrate_legacy_settings_and_themes();
    let marker_content = serde_json::json!({
        "version": 1,
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
