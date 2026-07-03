use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tokio::sync::Mutex;

use crate::env_util::user_data_dir;
use crate::storage::{atomic_write_utf8, read_json_array_file, read_json_object_file};

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

pub fn get_recordings_dir() -> PathBuf {
    let user_data = get_user_data_dir();
    let legacy = user_data.join("recordings");
    let next = user_data.join("audio-recordings");
    if legacy.exists() && !next.exists() {
        let _ = std::fs::rename(&legacy, &next);
    }
    std::fs::create_dir_all(&next).ok();
    next
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
            || name == "plans.json"
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
