//! Branching version tree for an image: ids, labels, legacy migration.

use super::*;

#[cfg(test)]
pub(super) fn version_label(version: &ImageVersion) -> String {
    format!("{}{}", version.branch, version.index_in_branch)
}


/// Deterministic id when legacy rows omit `id`, so UI clicks survive reloads before heal persists.
pub(super) fn stable_version_id(file_name: &str) -> String {
    format!("fn:{file_name}")
}

pub(super) fn ensure_version_id(id: &str, file_name: &str) -> String {
    let trimmed = id.trim();
    if !trimmed.is_empty() {
        trimmed.to_string()
    } else {
        stable_version_id(file_name)
    }
}

pub(super) fn find_version<'a>(entry: &'a ImagesIndexEntry, id: &str) -> Option<&'a ImageVersion> {
    entry.versions.iter().find(|v| v.id == id)
}

pub(super) fn node_has_child(entry: &ImagesIndexEntry, parent_id: &str) -> bool {
    entry
        .versions
        .iter()
        .any(|v| v.parent_id.as_deref() == Some(parent_id))
}

pub(super) fn next_branch_letter(entry: &ImagesIndexEntry) -> String {
    let mut used: HashSet<char> = HashSet::new();
    for v in &entry.versions {
        if let Some(c) = v.branch.chars().next() {
            used.insert(c.to_ascii_uppercase());
        }
    }
    for c in 'A'..='Z' {
        if !used.contains(&c) {
            return c.to_string();
        }
    }
    // Extremely unlikely; fall back to AA, AB, …
    format!("A{}", entry.versions.len())
}

pub(super) fn next_index_in_branch(entry: &ImagesIndexEntry, branch: &str) -> u32 {
    entry
        .versions
        .iter()
        .filter(|v| v.branch == branch)
        .map(|v| v.index_in_branch)
        .max()
        .unwrap_or(0)
        + 1
}

pub(super) fn apply_active_version_mirror(entry: &mut ImagesIndexEntry) {
    if entry.versions.is_empty() {
        entry.active_version_id.clear();
        return;
    }
    if find_version(entry, &entry.active_version_id).is_none() {
        entry.active_version_id = entry.versions.last().map(|v| v.id.clone()).unwrap_or_default();
    }
    let Some(version) = find_version(entry, &entry.active_version_id).cloned() else {
        return;
    };
    entry.prompt = version.prompt;
    entry.size = version.size;
    entry.quality = version.quality;
    entry.background = version.background;
    entry.output_format = version.output_format;
    entry.file_name = Some(version.file_name);
}


pub(super) fn parse_version_obj(obj: &serde_json::Map<String, serde_json::Value>) -> Option<ImageVersion> {
    let file_name = obj.get("fileName").and_then(|v| v.as_str())?.to_string();
    if file_name.is_empty() {
        return None;
    }
    let created_at = obj.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
    let prompt = obj
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let kind = obj
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("generate")
        .to_string();
    let raw_id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let id = ensure_version_id(raw_id, &file_name);
    let parent_id = obj
        .get("parentId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let branch = obj
        .get("branch")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("A")
        .to_string();
    let index_in_branch = obj
        .get("indexInBranch")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32)
        .unwrap_or(1)
        .max(1);
    Some(ImageVersion {
        id,
        parent_id,
        branch,
        index_in_branch,
        file_name,
        prompt,
        kind: normalize_version_kind(&kind),
        size: obj
            .get("size")
            .and_then(|v| v.as_str())
            .unwrap_or("auto")
            .to_string(),
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
        created_at,
    })
}

/// Convert a linear version list (missing tree fields / empty ids) into branch A.
pub(super) fn migrate_versions_to_tree(entry: &mut ImagesIndexEntry, legacy_active_index: Option<usize>) -> bool {
    if entry.versions.is_empty() {
        return false;
    }
    let root_count = entry
        .versions
        .iter()
        .filter(|v| v.parent_id.is_none())
        .count();
    // Linear legacy rows often all parse as A1 with no parentId.
    let needs_migrate = entry.versions.iter().any(|v| {
        v.id.is_empty() || v.branch.is_empty() || v.index_in_branch == 0
    }) || (entry.versions.len() > 1 && root_count > 1);
    if !needs_migrate {
        if entry.active_version_id.is_empty()
            || find_version(entry, &entry.active_version_id).is_none()
        {
            let idx = legacy_active_index
                .unwrap_or(entry.versions.len().saturating_sub(1))
                .min(entry.versions.len().saturating_sub(1));
            entry.active_version_id = entry.versions[idx].id.clone();
            apply_active_version_mirror(entry);
            return true;
        }
        return false;
    }

    let mut prev_id: Option<String> = None;
    for (i, version) in entry.versions.iter_mut().enumerate() {
        version.id = ensure_version_id(&version.id, &version.file_name);
        version.branch = "A".into();
        version.index_in_branch = (i as u32) + 1;
        version.parent_id = prev_id.clone();
        prev_id = Some(version.id.clone());
    }
    let idx = legacy_active_index
        .unwrap_or(entry.versions.len().saturating_sub(1))
        .min(entry.versions.len().saturating_sub(1));
    entry.active_version_id = entry.versions[idx].id.clone();
    apply_active_version_mirror(entry);
    true
}

pub(super) fn ensure_root_from_file_name(entry: &mut ImagesIndexEntry) -> bool {
    if !entry.versions.is_empty() {
        return false;
    }
    let Some(file_name) = entry.file_name.clone() else {
        return false;
    };
    let id = Uuid::new_v4().to_string();
    entry.versions.push(ImageVersion {
        id: id.clone(),
        parent_id: None,
        branch: "A".into(),
        index_in_branch: 1,
        file_name,
        prompt: entry.prompt.clone(),
        kind: "generate".into(),
        size: entry.size.clone(),
        quality: entry.quality.clone(),
        background: entry.background.clone(),
        output_format: entry.output_format.clone(),
        created_at: entry.updated_at.max(entry.created_at),
    });
    entry.active_version_id = id;
    apply_active_version_mirror(entry);
    true
}

/// Append a child of the active node: continue letter on tip, fork next letter if active already has a child.
pub(super) fn append_branched_version(
    entry: &mut ImagesIndexEntry,
    mut version: ImageVersion,
) -> Result<(), String> {
    if entry.versions.is_empty() {
        version.parent_id = None;
        version.branch = "A".into();
        version.index_in_branch = 1;
        if version.id.is_empty() {
            version.id = Uuid::new_v4().to_string();
        }
        entry.active_version_id = version.id.clone();
        entry.versions.push(version);
        apply_active_version_mirror(entry);
        return Ok(());
    }

    let parent_id = if entry.active_version_id.is_empty() {
        entry
            .versions
            .last()
            .map(|v| v.id.clone())
            .ok_or_else(|| "Image has no versions.".to_string())?
    } else {
        entry.active_version_id.clone()
    };
    let parent = find_version(entry, &parent_id)
        .cloned()
        .ok_or_else(|| "Active version not found.".to_string())?;

    let (branch, index_in_branch) = if node_has_child(entry, &parent.id) {
        let letter = next_branch_letter(entry);
        (letter, 1u32)
    } else {
        (
            parent.branch.clone(),
            next_index_in_branch(entry, &parent.branch),
        )
    };

    if version.id.is_empty() {
        version.id = Uuid::new_v4().to_string();
    }
    version.parent_id = Some(parent.id);
    version.branch = branch;
    version.index_in_branch = index_in_branch;
    entry.active_version_id = version.id.clone();
    entry.versions.push(version);
    apply_active_version_mirror(entry);
    Ok(())
}
