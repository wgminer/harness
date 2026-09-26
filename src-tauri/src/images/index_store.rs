//! On-disk `images.json` index and blob files: load, heal, save.

use super::*;

pub(super) fn images_index_path(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(IMAGES_INDEX_FILE)
}

pub(super) fn images_dir_path(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(IMAGES_DIR)
}

pub(super) fn image_file_path(app_state_dir: &Path, file_name: &str) -> PathBuf {
    images_dir_path(app_state_dir).join(file_name)
}

pub(super) fn sort_by_updated_at_desc(entries: &mut [ImagesIndexEntry]) {
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}


/// Find an on-disk image blob for `id` when the index `fileName` is missing or stale.
pub(super) fn discover_image_file_name(app_state_dir: &Path, id: &str) -> Option<String> {
    let dir = images_dir_path(app_state_dir);
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let prefix = format!("{id}-");
            let mut versioned: Vec<String> = entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !name.starts_with(&prefix) {
                        return None;
                    }
                    let ext = Path::new(&name)
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.to_ascii_lowercase())?;
                    if matches!(ext.as_str(), "png" | "jpeg" | "jpg" | "webp") {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect();
            versioned.sort();
            if let Some(name) = versioned.pop() {
                return Some(name);
            }
        }
    }
    for ext in ["png", "jpeg", "jpg", "webp"] {
        let name = format!("{id}.{ext}");
        if image_file_path(app_state_dir, &name).exists() {
            return Some(name);
        }
    }
    None
}


/// Restore `fileName` / versions from disk, migrate legacy entries, drop empty shells.
pub(super) fn heal_images_index_in_memory(app_state_dir: &Path, index: &mut ImagesIndex) -> bool {
    let mut changed = false;
    let mut kept = Vec::with_capacity(index.images.len());

    for mut entry in index.images.drain(..) {
        if ensure_root_from_file_name(&mut entry) {
            changed = true;
        }
        if migrate_versions_to_tree(&mut entry, None) {
            changed = true;
        }

        if entry.versions.is_empty() {
            if let Some(found) = discover_image_file_name(app_state_dir, &entry.id) {
                let format = output_format_from_file_name(&found).to_string();
                let vid = ensure_version_id("", &found);
                entry.versions.push(ImageVersion {
                    id: vid.clone(),
                    parent_id: None,
                    branch: "A".into(),
                    index_in_branch: 1,
                    file_name: found.clone(),
                    prompt: entry.prompt.clone(),
                    kind: "generate".into(),
                    size: entry.size.clone(),
                    quality: entry.quality.clone(),
                    background: entry.background.clone(),
                    output_format: format.clone(),
                    created_at: entry.updated_at.max(entry.created_at),
                });
                entry.output_format = format;
                entry.file_name = Some(found);
                entry.active_version_id = vid;
                changed = true;
            }
        } else {
            // Never remap a version onto another run's blob, and never drop history
            // when a blob is temporarily missing (sync race). Keep nodes as-is.
            apply_active_version_mirror(&mut entry);
        }

        let has_file = entry
            .file_name
            .as_ref()
            .map(|name| image_file_path(app_state_dir, name).exists())
            .unwrap_or(false);
        if !has_file && entry.prompt.trim().is_empty() && entry.versions.is_empty() {
            changed = true;
            continue;
        }

        kept.push(entry);
    }

    index.images = kept;
    changed
}

pub(super) async fn ensure_images_dir(app_state_dir: &Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(images_dir_path(app_state_dir)).await
}

/// Load index from disk. Second value is true when tree migration / root synthesis mutated entries
/// and the caller should persist.
pub(super) async fn load_images_index(app_state_dir: &Path) -> Result<(ImagesIndex, bool), std::io::Error> {
    let path = images_index_path(app_state_dir);
    if !file_exists(&path).await {
        return Ok((ImagesIndex::default(), false));
    }
    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let source = parsed
        .get("images")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut images = Vec::new();
    let mut dirty = false;
    for item in source {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let created_at = obj.get("createdAt").and_then(|v| v.as_i64());
        let updated_at = obj.get("updatedAt").and_then(|v| v.as_i64());
        if id.is_empty() || created_at.is_none() || updated_at.is_none() {
            continue;
        }
        let title = obj
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(UNTITLED_IMAGE_TITLE);
        let prompt = obj.get("prompt").and_then(|v| v.as_str()).unwrap_or("");
        let file_name = obj
            .get("fileName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .filter(|s| !s.is_empty());
        let mut versions = Vec::new();
        let mut versions_need_ids = false;
        if let Some(arr) = obj.get("versions").and_then(|v| v.as_array()) {
            for row in arr {
                if let Some(vobj) = row.as_object() {
                    let had_id = vobj
                        .get("id")
                        .and_then(|v| v.as_str())
                        .map(|s| !s.is_empty())
                        .unwrap_or(false);
                    if let Some(version) = parse_version_obj(vobj) {
                        if !had_id {
                            versions_need_ids = true;
                        }
                        versions.push(version);
                    }
                }
            }
        }
        let legacy_active_index = obj
            .get("activeVersion")
            .and_then(|v| v.as_u64())
            .map(|n| n as usize);
        let active_version_id = obj
            .get("activeVersionId")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let deleted_version_ids = obj
            .get("deletedVersionIds")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let mut entry = ImagesIndexEntry {
            id: id.to_string(),
            title: title.to_string(),
            prompt: prompt.to_string(),
            created_at: created_at.unwrap(),
            updated_at: updated_at.unwrap(),
            size: resolve_stored_size(obj),
            quality: obj
                .get("quality")
                .and_then(|v| v.as_str())
                .unwrap_or("auto")
                .to_string(),
            background: obj
                .get("background")
                .and_then(|v| v.as_str())
                .unwrap_or("auto")
                .to_string(),
            output_format: obj
                .get("outputFormat")
                .and_then(|v| v.as_str())
                .unwrap_or("png")
                .to_string(),
            file_name,
            versions,
            active_version_id,
            deleted_version_ids,
        };
        if versions_need_ids {
            dirty = true;
        }
        if ensure_root_from_file_name(&mut entry) {
            dirty = true;
        }
        if migrate_versions_to_tree(&mut entry, legacy_active_index) {
            dirty = true;
        }
        apply_active_version_mirror(&mut entry);
        images.push(entry);
    }
    sort_by_updated_at_desc(&mut images);
    Ok((ImagesIndex { images }, dirty))
}

pub(super) fn serialize_images_index(index: &ImagesIndex) -> String {
    let mut images = index.images.clone();
    sort_by_updated_at_desc(&mut images);
    let payload = serde_json::json!({ "images": images });
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{\"images\":[]}".into())
}

pub(super) async fn save_images_index(
    state: &AppState,
    app_state_dir: &Path,
    index: &ImagesIndex,
) -> Result<(), std::io::Error> {
    atomic_write_utf8(
        &state.write_chains,
        &images_index_path(app_state_dir),
        &serialize_images_index(index),
    )
    .await
}

/// Persist while the caller already holds the images.json path lock.
pub(super) async fn save_images_index_unlocked(
    app_state_dir: &Path,
    index: &ImagesIndex,
) -> Result<(), std::io::Error> {
    atomic_write_utf8_unlocked(
        &images_index_path(app_state_dir),
        &serialize_images_index(index),
    )
    .await
}

pub(super) async fn prepare_images_index(app_state_dir: &Path) -> Result<(ImagesIndex, bool), std::io::Error> {
    let (mut index, load_dirty) = load_images_index(app_state_dir).await?;
    let heal_dirty = heal_images_index_in_memory(app_state_dir, &mut index);
    Ok((index, load_dirty || heal_dirty))
}

pub(super) async fn load_healed_images_index(
    state: &AppState,
    app_state_dir: &Path,
) -> Result<ImagesIndex, std::io::Error> {
    let index_path = images_index_path(app_state_dir);
    with_path_lock(&state.write_chains, &index_path, async {
        let (index, dirty) = prepare_images_index(app_state_dir).await?;
        if dirty {
            save_images_index_unlocked(app_state_dir, &index).await?;
        }
        Ok(index)
    })
    .await
}

pub(super) async fn remove_image_blob(app_state_dir: &Path, file_name: &str) {
    let path = image_file_path(app_state_dir, file_name);
    if file_exists(&path).await {
        let _ = tokio::fs::remove_file(path).await;
    }
}

pub(super) async fn remove_all_image_blobs(app_state_dir: &Path, entry: &ImagesIndexEntry) {
    let mut names: Vec<String> = entry
        .versions
        .iter()
        .map(|v| v.file_name.clone())
        .collect();
    if let Some(name) = entry.file_name.clone() {
        names.push(name);
    }
    let dir = images_dir_path(app_state_dir);
    if dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let prefix = format!("{}-", entry.id);
            let legacy_prefix = format!("{}.", entry.id);
            for entry_fs in entries.flatten() {
                let name = entry_fs.file_name().to_string_lossy().to_string();
                if name.starts_with(&prefix) || name.starts_with(&legacy_prefix) {
                    names.push(name);
                }
            }
        }
    }
    names.sort();
    names.dedup();
    for name in names {
        remove_image_blob(app_state_dir, &name).await;
    }
}

pub(super) async fn atomic_write_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = format!(
        "{}.tmp.{}.{}",
        path.display(),
        std::process::id(),
        Uuid::new_v4()
    );
    let mut file = tokio::fs::File::create(&tmp).await?;
    file.write_all(data).await?;
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(&tmp, path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })
}
