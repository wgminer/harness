use std::collections::HashMap;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

use crate::settings::strip_settings_secrets;

pub const BUNDLE_FORMAT_VERSION: i32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    pub path: String,
    pub contents: String,
    pub size: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleDocument {
    pub version: i32,
    pub entries: Vec<BundleEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncScopeKind {
    File,
    Dir,
}

#[derive(Debug, Clone)]
pub struct SyncScope {
    pub rel_path: &'static str,
    pub kind: SyncScopeKind,
}

pub const DEFAULT_SYNC_SCOPES: &[SyncScope] = &[
    SyncScope {
        rel_path: "app-state",
        kind: SyncScopeKind::Dir,
    },
    SyncScope {
        rel_path: "settings/settings.json",
        kind: SyncScopeKind::File,
    },
];

pub const USER_CONTENT_SYNC_SCOPES: &[SyncScope] = &[SyncScope {
    rel_path: "app-state",
    kind: SyncScopeKind::Dir,
}];

fn to_posix(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

async fn walk_files(root: &Path, base_abs: &Path) -> std::io::Result<Vec<String>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let mut entries = tokio::fs::read_dir(&dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with('.') {
                continue;
            }
            let abs = entry.path();
            let meta = entry.metadata().await?;
            if meta.is_dir() {
                stack.push(abs);
            } else if meta.is_file() {
                let rel = abs.strip_prefix(base_abs).unwrap_or(&abs);
                out.push(to_posix(rel));
            }
        }
    }
    out.sort();
    Ok(out)
}

pub async fn list_scoped_files(
    local_data_dir: &Path,
    scopes: &[SyncScope],
) -> std::io::Result<Vec<String>> {
    let mut all = Vec::new();
    for scope in scopes {
        let abs = local_data_dir.join(scope.rel_path);
        match scope.kind {
            SyncScopeKind::File => {
                if abs.exists() {
                    all.push(scope.rel_path.to_string());
                }
            }
            SyncScopeKind::Dir => {
                let found = walk_files(&abs, local_data_dir).await?;
                all.extend(found);
            }
        }
    }
    all.sort();
    Ok(all)
}

pub async fn compute_revision(local_data_dir: &Path, scopes: &[SyncScope]) -> std::io::Result<String> {
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut hasher = Sha256::new();
    for rel in files {
        let abs = local_data_dir.join(&rel);
        let data = tokio::fs::read(&abs).await?;
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        hasher.update(&data);
        hasher.update([0u8]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub async fn compute_local_max_mtime(
    local_data_dir: &Path,
    scopes: &[SyncScope],
) -> std::io::Result<i64> {
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut max = 0i64;
    for rel in files {
        let abs = local_data_dir.join(&rel);
        if let Ok(meta) = tokio::fs::metadata(&abs).await {
            if let Ok(modified) = meta.modified() {
                let ms = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                if ms > max {
                    max = ms;
                }
            }
        }
    }
    Ok(max)
}

pub fn compute_content_revision_from_bundle(doc: &BundleDocument) -> String {
    let mut entries: Vec<&BundleEntry> = doc
        .entries
        .iter()
        .filter(|entry| is_in_scope(&entry.path, USER_CONTENT_SYNC_SCOPES))
        .collect();
    entries.sort_by(|a, b| a.path.cmp(&b.path));

    let mut hasher = Sha256::new();
    for entry in entries {
        hasher.update(entry.path.as_bytes());
        hasher.update([0u8]);
        if let Ok(bytes) = BASE64.decode(&entry.contents) {
            hasher.update(&bytes);
        }
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())
}

fn redact_settings_json_bytes(bytes: &[u8]) -> Vec<u8> {
    let Ok(mut parsed) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return bytes.to_vec();
    };
    strip_settings_secrets(&mut parsed);
    serde_json::to_vec_pretty(&parsed).unwrap_or_else(|_| bytes.to_vec())
}

pub struct BuiltBundle {
    pub bytes: Vec<u8>,
    pub bundle_hash: String,
    pub entries: Vec<BundleEntry>,
}

pub async fn build_bundle(local_data_dir: &Path, scopes: &[SyncScope]) -> std::io::Result<BuiltBundle> {
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut entries = Vec::new();
    for rel in files {
        let abs = local_data_dir.join(&rel);
        let mut data = tokio::fs::read(&abs).await?;
        if rel == "settings/settings.json" {
            data = redact_settings_json_bytes(&data);
        }
        entries.push(BundleEntry {
            path: rel,
            contents: BASE64.encode(&data),
            size: data.len(),
        });
    }
    let doc = BundleDocument {
        version: BUNDLE_FORMAT_VERSION,
        entries,
    };
    let json = serde_json::to_vec(&doc)?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&json)?;
    let bytes = encoder.finish()?;
    let bundle_hash = hash_bundle_bytes(&bytes);
    let entries = doc.entries;
    Ok(BuiltBundle {
        bytes,
        bundle_hash,
        entries,
    })
}

pub fn parse_bundle(bytes: &[u8]) -> Result<BundleDocument, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    let parsed: BundleDocument = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if parsed.version != BUNDLE_FORMAT_VERSION {
        return Err(format!("Unsupported bundle version: {}", parsed.version));
    }
    if parsed.entries.is_empty() {
        return Err("Bundle is malformed (missing entries)".into());
    }
    Ok(parsed)
}

pub fn hash_bundle_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub async fn backup_scoped_files(
    local_data_dir: &Path,
    backup_dir: &Path,
    scopes: &[SyncScope],
) -> std::io::Result<usize> {
    tokio::fs::create_dir_all(backup_dir).await?;
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut count = 0usize;
    for rel in files {
        let src = local_data_dir.join(&rel);
        let dst = backup_dir.join(&rel);
        if let Some(parent) = dst.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::copy(&src, &dst).await?;
        count += 1;
    }
    Ok(count)
}

pub async fn extract_bundle(
    local_data_dir: &Path,
    doc: &BundleDocument,
    scopes: &[SyncScope],
) -> std::io::Result<usize> {
    for scope in scopes {
        let abs = local_data_dir.join(scope.rel_path);
        if !abs.exists() {
            continue;
        }
        match scope.kind {
            SyncScopeKind::File => {
                let _ = tokio::fs::remove_file(&abs).await;
            }
            SyncScopeKind::Dir => {
                let _ = tokio::fs::remove_dir_all(&abs).await;
            }
        }
    }

    let mut count = 0usize;
    for entry in &doc.entries {
        if !is_in_scope(&entry.path, scopes) {
            continue;
        }
        let abs = local_data_dir.join(&entry.path);
        if let Some(parent) = abs.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let data = BASE64
            .decode(&entry.contents)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        if data.len() != entry.size {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Bundle entry size mismatch for {}", entry.path),
            ));
        }
        tokio::fs::write(&abs, &data).await?;
        count += 1;
    }
    Ok(count)
}

fn is_in_scope(rel_path: &str, scopes: &[SyncScope]) -> bool {
    for scope in scopes {
        match scope.kind {
            SyncScopeKind::File => {
                if rel_path == scope.rel_path {
                    return true;
                }
            }
            SyncScopeKind::Dir => {
                if rel_path == scope.rel_path || rel_path.starts_with(&format!("{}/", scope.rel_path))
                {
                    return true;
                }
            }
        }
    }
    false
}

pub async fn apply_merged_files(
    local_data_dir: &Path,
    merged_files: &HashMap<String, Vec<u8>>,
    scopes: &[SyncScope],
) -> std::io::Result<(usize, usize)> {
    let existing = list_scoped_files(local_data_dir, scopes).await?;
    let mut files_written = 0usize;
    for (rel, data) in merged_files {
        if !is_in_scope(rel, scopes) {
            continue;
        }
        let abs = local_data_dir.join(rel);
        if let Some(parent) = abs.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&abs, data).await?;
        files_written += 1;
    }
    let mut files_removed = 0usize;
    for rel in existing {
        if merged_files.contains_key(&rel) {
            continue;
        }
        let _ = tokio::fs::remove_file(local_data_dir.join(&rel)).await;
        files_removed += 1;
    }
    Ok((files_written, files_removed))
}

pub async fn atomic_write_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = format!("{}.tmp", path.display());
    tokio::fs::write(&tmp, data).await?;
    tokio::fs::rename(&tmp, path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    async fn make_local_data(seed: HashMap<&str, &str>) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let local_data = temp.path().join("local-data");
        tokio::fs::create_dir_all(local_data.join("app-state"))
            .await
            .unwrap();
        tokio::fs::create_dir_all(local_data.join("settings"))
            .await
            .unwrap();
        for (rel, contents) in seed {
            let abs = local_data.join(rel);
            if let Some(parent) = abs.parent() {
                tokio::fs::create_dir_all(parent).await.unwrap();
            }
            tokio::fs::write(abs, contents).await.unwrap();
        }
        (temp, local_data)
    }

    #[tokio::test]
    async fn revision_is_deterministic() {
        let (_a_dir, a) = make_local_data(HashMap::from([
            ("app-state/conversations.json", r#"{"a":1}"#),
            ("settings/settings.json", r#"{"version":1}"#),
        ]))
        .await;
        let (_b_dir, b) = make_local_data(HashMap::from([
            ("app-state/conversations.json", r#"{"a":1}"#),
            ("settings/settings.json", r#"{"version":1}"#),
        ]))
        .await;
        let ra = compute_revision(&a, DEFAULT_SYNC_SCOPES).await.unwrap();
        let rb = compute_revision(&b, DEFAULT_SYNC_SCOPES).await.unwrap();
        assert_eq!(ra, rb);
        assert_eq!(
            ra,
            "871a3ac43c56aec72a9a93a9ab2122e31bcb3e431e34d6339a7bf4db72425387"
        );
    }

    #[tokio::test]
    async fn revision_changes_with_content() {
        let (_dir, local_data) = make_local_data(HashMap::from([(
            "app-state/conversations.json",
            r#"{"a":1}"#,
        )]))
        .await;
        let before = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap();
        tokio::fs::write(
            local_data.join("app-state/conversations.json"),
            r#"{"a":2}"#,
        )
        .await
        .unwrap();
        let after = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap();
        assert_ne!(before, after);
    }

    #[tokio::test]
    async fn bundle_round_trip() {
        let (_src_dir, src) = make_local_data(HashMap::from([
            ("app-state/conversations.json", r#"{"keep":"me"}"#),
            ("settings/settings.json", r#"{"version":1}"#),
        ]))
        .await;
        let built = build_bundle(&src, DEFAULT_SYNC_SCOPES).await.unwrap();
        assert_eq!(hash_bundle_bytes(&built.bytes), built.bundle_hash);

        let (_dst_dir, dst) = make_local_data(HashMap::from([(
            "app-state/conversations.json",
            r#"{"original":true}"#,
        )]))
        .await;
        let doc = parse_bundle(&built.bytes).unwrap();
        let written = extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap();
        assert_eq!(written, 2);
        let conv = tokio::fs::read_to_string(dst.join("app-state/conversations.json"))
            .await
            .unwrap();
        assert_eq!(conv, r#"{"keep":"me"}"#);
    }
}
