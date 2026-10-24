use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

use crate::settings::strip_settings_secrets;

/// Shared with iOS (`SyncScopes`); see `src/shared/syncBundleContract.test.ts`.
const SYNC_BUNDLE_CONTRACT_JSON: &str =
    include_str!("../../../resources/contracts/syncBundle.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncBundleContract {
    bundle_format_version: i32,
    readable_bundle_format_versions: Vec<i32>,
    blob_path_prefixes: Vec<String>,
    blob_object_prefix: String,
}

fn contract() -> &'static SyncBundleContract {
    static CONTRACT: OnceLock<SyncBundleContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(SYNC_BUNDLE_CONTRACT_JSON)
            .expect("resources/contracts/syncBundle.json must be a valid sync bundle contract")
    })
}

/// Format this client writes. It reads every version in the contract's readable list.
pub fn bundle_format_version() -> i32 {
    contract().bundle_format_version
}

/// Object-name prefix (under the R2 prefix) for content-addressed blobs.
pub fn blob_object_prefix() -> &'static str {
    &contract().blob_object_prefix
}

/// Binary files that travel as separate `blobs/<sha256>` objects instead of inside the bundle.
pub fn is_blob_path(rel_path: &str) -> bool {
    contract()
        .blob_path_prefixes
        .iter()
        .any(|prefix| rel_path.starts_with(prefix.as_str()))
}

pub fn is_blob_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// A bundle entry holds either `contents` (base64) or, for blob paths in format 2, `blob`
/// (the sha256 of the bytes stored at `blobs/<sha256>`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleEntry {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contents: Option<String>,
    pub size: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleDocument {
    pub version: i32,
    pub entries: Vec<BundleEntry>,
}

/// Reference to a blob by content. In the merge file maps a blob path carries this, encoded
/// with [`BlobRef::to_token`], in place of the file's bytes.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BlobRef {
    pub blob: String,
    pub size: usize,
}

impl BlobRef {
    pub fn to_token(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }

    pub fn from_token(bytes: &[u8]) -> Option<Self> {
        let parsed: BlobRef = serde_json::from_slice(bytes).ok()?;
        is_blob_hash(&parsed.blob).then_some(parsed)
    }
}

/// What a path should hold once a pull or merge is applied.
#[derive(Debug, Clone)]
pub enum FileTarget {
    Inline(Vec<u8>),
    Blob(BlobRef),
}

type BlobHashCache = Mutex<HashMap<PathBuf, (u64, SystemTime, String)>>;

/// Hash and size of a local blob file. Blobs are large and effectively immutable, and the
/// revision is recomputed every couple of seconds, so the hash is cached by size and mtime.
pub async fn local_blob_ref(abs: &Path) -> std::io::Result<BlobRef> {
    static CACHE: OnceLock<BlobHashCache> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let meta = tokio::fs::metadata(abs).await?;
    let modified = meta.modified()?;
    if let Some((len, at, hash)) = cache.lock().ok().and_then(|c| c.get(abs).cloned()) {
        if len == meta.len() && at == modified {
            return Ok(BlobRef {
                blob: hash,
                size: len as usize,
            });
        }
    }
    let data = tokio::fs::read(abs).await?;
    let hash = sha256_hex(&data);
    if data.len() as u64 == meta.len() {
        if let Ok(mut c) = cache.lock() {
            c.insert(abs.to_path_buf(), (meta.len(), modified, hash.clone()));
        }
    }
    Ok(BlobRef {
        blob: hash,
        size: data.len(),
    })
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

/// Each file contributes `path \0 bytes \0`, except blob paths, which contribute the hex
/// sha256 of their bytes instead, so a client holding only blob references (the phone)
/// computes the same value.
pub async fn compute_revision(local_data_dir: &Path, scopes: &[SyncScope]) -> std::io::Result<String> {
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut hasher = Sha256::new();
    for rel in files {
        let abs = local_data_dir.join(&rel);
        hasher.update(rel.as_bytes());
        hasher.update([0u8]);
        if is_blob_path(&rel) {
            hasher.update(local_blob_ref(&abs).await?.blob.as_bytes());
        } else {
            hasher.update(tokio::fs::read(&abs).await?);
        }
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
        if let Some(hash) = &entry.blob {
            hasher.update(hash.as_bytes());
        } else if let Ok(bytes) = BASE64.decode(entry.contents.as_deref().unwrap_or_default()) {
            if is_blob_path(&entry.path) {
                // Format 1 embedded blobs; hash them the way format 2 references them.
                hasher.update(sha256_hex(&bytes).as_bytes());
            } else {
                hasher.update(&bytes);
            }
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

/// A blob file the bundle references; uploaded before the bundle if the remote lacks it.
#[derive(Debug, Clone)]
pub struct LocalBlob {
    pub rel_path: String,
    pub blob: BlobRef,
}

pub struct BuiltBundle {
    pub bytes: Vec<u8>,
    pub bundle_hash: String,
    pub entries: Vec<BundleEntry>,
    pub blobs: Vec<LocalBlob>,
}

pub async fn build_bundle(local_data_dir: &Path, scopes: &[SyncScope]) -> std::io::Result<BuiltBundle> {
    let files = list_scoped_files(local_data_dir, scopes).await?;
    let mut entries = Vec::new();
    let mut blobs = Vec::new();
    for rel in files {
        let abs = local_data_dir.join(&rel);
        if is_blob_path(&rel) {
            let blob = local_blob_ref(&abs).await?;
            entries.push(BundleEntry {
                path: rel.clone(),
                contents: None,
                size: blob.size,
                blob: Some(blob.blob.clone()),
            });
            blobs.push(LocalBlob { rel_path: rel, blob });
            continue;
        }
        let mut data = tokio::fs::read(&abs).await?;
        if rel == "settings/settings.json" {
            data = redact_settings_json_bytes(&data);
        }
        entries.push(BundleEntry {
            path: rel,
            contents: Some(BASE64.encode(&data)),
            size: data.len(),
            blob: None,
        });
    }
    let doc = BundleDocument {
        version: bundle_format_version(),
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
        blobs,
    })
}

pub fn parse_bundle(bytes: &[u8]) -> Result<BundleDocument, String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    let parsed: BundleDocument = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    if !contract()
        .readable_bundle_format_versions
        .contains(&parsed.version)
    {
        return Err(format!("Unsupported bundle version: {}", parsed.version));
    }
    if parsed.entries.is_empty() {
        return Err("Bundle is malformed (missing entries)".into());
    }
    for entry in &parsed.entries {
        match (&entry.contents, &entry.blob) {
            (Some(_), None) => {}
            // The hash becomes an object key and a file name, so its shape is checked here.
            (None, Some(hash))
                if parsed.version >= 2 && is_blob_path(&entry.path) && is_blob_hash(hash) => {}
            _ => return Err(format!("Bundle entry is malformed: {}", entry.path)),
        }
    }
    Ok(parsed)
}

pub fn hash_bundle_bytes(bytes: &[u8]) -> String {
    sha256_hex(bytes)
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

/// Where a downloaded (or set-aside) blob waits until a pull or merge is applied.
pub fn staged_blob_path(staging_dir: &Path, hash: &str) -> PathBuf {
    staging_dir.join(hash)
}

pub fn bundle_blob_refs(doc: &BundleDocument) -> Vec<BlobRef> {
    doc.entries
        .iter()
        .filter_map(|entry| {
            entry.blob.as_ref().map(|hash| BlobRef {
                blob: hash.clone(),
                size: entry.size,
            })
        })
        .collect()
}

/// Blob references carried by a merge file map (see [`BlobRef::to_token`]).
pub fn file_map_blob_refs(files: &HashMap<String, Vec<u8>>) -> Vec<BlobRef> {
    files
        .iter()
        .filter(|(path, _)| is_blob_path(path))
        .filter_map(|(_, bytes)| BlobRef::from_token(bytes))
        .collect()
}

async fn local_blob_hashes(
    local_data_dir: &Path,
    scopes: &[SyncScope],
) -> std::io::Result<HashMap<String, String>> {
    let mut by_path = HashMap::new();
    for rel in list_scoped_files(local_data_dir, scopes).await? {
        if is_blob_path(&rel) {
            let blob = local_blob_ref(&local_data_dir.join(&rel)).await?;
            by_path.insert(rel, blob.blob);
        }
    }
    Ok(by_path)
}

/// The subset of `refs` held neither in local data nor in the staging directory: the blobs
/// that have to be downloaded before `refs` can be applied.
pub async fn missing_blobs(
    local_data_dir: &Path,
    scopes: &[SyncScope],
    staging_dir: &Path,
    refs: &[BlobRef],
) -> std::io::Result<Vec<BlobRef>> {
    let local: HashSet<String> = local_blob_hashes(local_data_dir, scopes)
        .await?
        .into_values()
        .collect();
    let mut seen = HashSet::new();
    let mut missing = Vec::new();
    for blob in refs {
        if local.contains(&blob.blob) || !seen.insert(blob.blob.clone()) {
            continue;
        }
        if tokio::fs::try_exists(staged_blob_path(staging_dir, &blob.blob))
            .await
            .unwrap_or(false)
        {
            continue;
        }
        missing.push(blob.clone());
    }
    Ok(missing)
}

/// Make the scoped files exactly `targets`. Every blob is located (in place, elsewhere in
/// local data, or staged) before anything is removed or written, so a blob that cannot be
/// found fails the call with local data untouched.
async fn materialize(
    local_data_dir: &Path,
    targets: &HashMap<String, FileTarget>,
    scopes: &[SyncScope],
    staging_dir: &Path,
) -> std::io::Result<usize> {
    let existing = list_scoped_files(local_data_dir, scopes).await?;
    let local_hashes = local_blob_hashes(local_data_dir, scopes).await?;
    let mut path_by_hash: HashMap<&str, &str> = HashMap::new();
    for (path, hash) in &local_hashes {
        path_by_hash.insert(hash.as_str(), path.as_str());
    }

    for (rel, target) in targets {
        let FileTarget::Blob(blob) = target else {
            continue;
        };
        if local_hashes.get(rel) == Some(&blob.blob) {
            continue;
        }
        let staged = staged_blob_path(staging_dir, &blob.blob);
        if tokio::fs::try_exists(&staged).await.unwrap_or(false) {
            continue;
        }
        // Same bytes under another path, which the removal pass below may delete.
        let Some(source) = path_by_hash.get(blob.blob.as_str()) else {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Blob for {rel} is not available"),
            ));
        };
        tokio::fs::create_dir_all(staging_dir).await?;
        tokio::fs::copy(local_data_dir.join(source), &staged).await?;
    }

    let mut files_removed = 0usize;
    for rel in existing {
        if targets.contains_key(&rel) {
            continue;
        }
        let _ = tokio::fs::remove_file(local_data_dir.join(&rel)).await;
        files_removed += 1;
    }

    for (rel, target) in targets {
        let abs = local_data_dir.join(rel);
        if let Some(parent) = abs.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        match target {
            FileTarget::Inline(data) => tokio::fs::write(&abs, data).await?,
            FileTarget::Blob(blob) => {
                if local_hashes.get(rel) != Some(&blob.blob) {
                    tokio::fs::copy(staged_blob_path(staging_dir, &blob.blob), &abs).await?;
                }
            }
        }
    }
    Ok(files_removed)
}

/// Replace the scoped local files with the bundle's. Blobs the bundle references must already
/// be local or in `staging_dir` (see [`missing_blobs`]).
pub async fn extract_bundle(
    local_data_dir: &Path,
    doc: &BundleDocument,
    scopes: &[SyncScope],
    staging_dir: &Path,
) -> std::io::Result<usize> {
    let mut targets = HashMap::new();
    for entry in &doc.entries {
        if !is_in_scope(&entry.path, scopes) {
            continue;
        }
        let target = if let Some(hash) = &entry.blob {
            FileTarget::Blob(BlobRef {
                blob: hash.clone(),
                size: entry.size,
            })
        } else {
            let data = BASE64
                .decode(entry.contents.as_deref().unwrap_or_default())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            if data.len() != entry.size {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Bundle entry size mismatch for {}", entry.path),
                ));
            }
            FileTarget::Inline(data)
        };
        targets.insert(entry.path.clone(), target);
    }
    materialize(local_data_dir, &targets, scopes, staging_dir).await?;
    Ok(targets.len())
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

/// Write a merged file map to disk. Blob paths must carry a [`BlobRef`] token, never raw
/// bytes, so a reference can't be written out as if it were the file.
pub async fn apply_merged_files(
    local_data_dir: &Path,
    merged_files: &HashMap<String, Vec<u8>>,
    scopes: &[SyncScope],
    staging_dir: &Path,
) -> std::io::Result<(usize, usize)> {
    let mut targets = HashMap::new();
    for (rel, data) in merged_files {
        if !is_in_scope(rel, scopes) {
            continue;
        }
        let target = if is_blob_path(rel) {
            let blob = BlobRef::from_token(data).ok_or_else(|| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Merged entry for {rel} is not a blob reference"),
                )
            })?;
            FileTarget::Blob(blob)
        } else {
            FileTarget::Inline(data.clone())
        };
        targets.insert(rel.clone(), target);
    }
    let files_removed = materialize(local_data_dir, &targets, scopes, staging_dir).await?;
    Ok((targets.len(), files_removed))
}

pub async fn atomic_write_file(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = format!("{}.tmp", path.display());
    tokio::fs::write(&tmp, data).await?;
    tokio::fs::rename(&tmp, path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
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
        let staging = _dst_dir.path().join("staging");
        let written = extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES, &staging)
            .await
            .unwrap();
        assert_eq!(written, 2);
        let conv = tokio::fs::read_to_string(dst.join("app-state/conversations.json"))
            .await
            .unwrap();
        assert_eq!(conv, r#"{"keep":"me"}"#);
    }

    const REVISION_FIXTURE: &str =
        include_str!("../../../src/shared/fixtures/syncBundle/revision.expected.json");

    async fn make_fixture_data() -> (TempDir, PathBuf, serde_json::Value) {
        let fixture: serde_json::Value = serde_json::from_str(REVISION_FIXTURE).unwrap();
        let (dir, local_data) = make_local_data(HashMap::new()).await;
        for file in fixture["files"].as_array().unwrap() {
            let abs = local_data.join(file["path"].as_str().unwrap());
            tokio::fs::create_dir_all(abs.parent().unwrap()).await.unwrap();
            tokio::fs::write(abs, file["text"].as_str().unwrap())
                .await
                .unwrap();
        }
        (dir, local_data, fixture)
    }

    fn gzip_doc(doc: &BundleDocument) -> Vec<u8> {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
        encoder
            .write_all(&serde_json::to_vec(doc).unwrap())
            .unwrap();
        encoder.finish().unwrap()
    }

    /// The same files as a format 1 bundle: every blob embedded.
    async fn build_v1_doc(local_data: &Path) -> BundleDocument {
        let mut entries = Vec::new();
        for rel in list_scoped_files(local_data, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap()
        {
            let data = tokio::fs::read(local_data.join(&rel)).await.unwrap();
            entries.push(BundleEntry {
                path: rel,
                contents: Some(BASE64.encode(&data)),
                size: data.len(),
                blob: None,
            });
        }
        BundleDocument {
            version: 1,
            entries,
        }
    }

    #[tokio::test]
    async fn revisions_match_golden_fixture_with_blobs() {
        let (_dir, local_data, fixture) = make_fixture_data().await;
        assert_eq!(
            compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
                .await
                .unwrap(),
            fixture["revision"].as_str().unwrap()
        );
        assert_eq!(
            compute_revision(&local_data, USER_CONTENT_SYNC_SCOPES)
                .await
                .unwrap(),
            fixture["contentRevision"].as_str().unwrap()
        );
    }

    #[tokio::test]
    async fn bundle_references_blobs_instead_of_embedding_them() {
        let (_dir, local_data, fixture) = make_fixture_data().await;
        let built = build_bundle(&local_data, DEFAULT_SYNC_SCOPES).await.unwrap();
        let doc = parse_bundle(&built.bytes).unwrap();
        assert_eq!(doc.version, 2);
        let hashes = fixture["blobHashes"].as_object().unwrap();
        assert_eq!(built.blobs.len(), hashes.len());
        for entry in &doc.entries {
            match hashes.get(&entry.path) {
                Some(hash) => {
                    assert_eq!(entry.blob.as_deref(), hash.as_str());
                    assert!(entry.contents.is_none());
                }
                None => assert!(entry.blob.is_none() && entry.contents.is_some()),
            }
        }
        assert_eq!(
            compute_content_revision_from_bundle(&doc),
            fixture["contentRevision"].as_str().unwrap()
        );
    }

    #[tokio::test]
    async fn format_1_bundle_still_reads_and_hashes_like_format_2() {
        let (_dir, local_data, fixture) = make_fixture_data().await;
        let v1 = build_v1_doc(&local_data).await;
        let doc = parse_bundle(&gzip_doc(&v1)).unwrap();
        assert_eq!(
            compute_content_revision_from_bundle(&doc),
            fixture["contentRevision"].as_str().unwrap()
        );
        assert!(bundle_blob_refs(&doc).is_empty());

        let (dst_dir, dst) = make_local_data(HashMap::new()).await;
        extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES, &dst_dir.path().join("staging"))
            .await
            .unwrap();
        assert_eq!(
            compute_revision(&dst, DEFAULT_SYNC_SCOPES).await.unwrap(),
            fixture["revision"].as_str().unwrap()
        );
    }

    #[tokio::test]
    async fn extract_with_a_missing_blob_fails_and_leaves_local_data_untouched() {
        let (_src_dir, src) = make_fixture_data().await.into_parts();
        let built = build_bundle(&src, DEFAULT_SYNC_SCOPES).await.unwrap();
        let doc = parse_bundle(&built.bytes).unwrap();

        let (dst_dir, dst) = make_local_data(HashMap::from([
            ("app-state/conversations.json", r#"{"original":true}"#),
            ("app-state/images/mine.png", "mine"),
        ]))
        .await;
        let staging = dst_dir.path().join("staging");
        let before = compute_revision(&dst, DEFAULT_SYNC_SCOPES).await.unwrap();
        let refs = bundle_blob_refs(&doc);
        assert_eq!(
            missing_blobs(&dst, DEFAULT_SYNC_SCOPES, &staging, &refs)
                .await
                .unwrap()
                .len(),
            refs.len()
        );

        let err = extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES, &staging)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::NotFound);
        assert_eq!(
            compute_revision(&dst, DEFAULT_SYNC_SCOPES).await.unwrap(),
            before
        );

        // Once the blobs are staged (as a download would leave them) the pull goes through.
        tokio::fs::create_dir_all(&staging).await.unwrap();
        for local in &built.blobs {
            tokio::fs::copy(
                src.join(&local.rel_path),
                staged_blob_path(&staging, &local.blob.blob),
            )
            .await
            .unwrap();
        }
        assert!(missing_blobs(&dst, DEFAULT_SYNC_SCOPES, &staging, &refs)
            .await
            .unwrap()
            .is_empty());
        extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES, &staging)
            .await
            .unwrap();
        assert_eq!(
            compute_revision(&dst, USER_CONTENT_SYNC_SCOPES).await.unwrap(),
            compute_revision(&src, USER_CONTENT_SYNC_SCOPES).await.unwrap()
        );
        assert!(!dst.join("app-state/images/mine.png").exists());
    }

    #[tokio::test]
    async fn extract_reuses_local_blobs_including_ones_that_moved() {
        let (src_dir, src) = make_fixture_data().await.into_parts();
        let built = build_bundle(&src, DEFAULT_SYNC_SCOPES).await.unwrap();
        let doc = parse_bundle(&built.bytes).unwrap();

        // Same bytes as the bundle's blobs: one in place, one under an old name.
        let (dst_dir, dst) = make_local_data(HashMap::from([
            ("app-state/images/pic.png", "png-bytes"),
            ("app-state/chat-attachments/old/renamed.jpg", "jpg-bytes"),
        ]))
        .await;
        let staging = dst_dir.path().join("staging");
        assert!(
            missing_blobs(&dst, DEFAULT_SYNC_SCOPES, &staging, &bundle_blob_refs(&doc))
                .await
                .unwrap()
                .is_empty()
        );
        extract_bundle(&dst, &doc, DEFAULT_SYNC_SCOPES, &staging)
            .await
            .unwrap();
        assert_eq!(
            compute_revision(&dst, USER_CONTENT_SYNC_SCOPES).await.unwrap(),
            compute_revision(&src, USER_CONTENT_SYNC_SCOPES).await.unwrap()
        );
        assert!(!dst.join("app-state/chat-attachments/old/renamed.jpg").exists());
        drop(src_dir);
    }

    #[test]
    fn parse_rejects_unknown_versions_and_malformed_blob_entries() {
        let entry = |path: &str, contents: Option<&str>, blob: Option<&str>| BundleEntry {
            path: path.into(),
            contents: contents.map(str::to_string),
            size: 1,
            blob: blob.map(str::to_string),
        };
        let hash = "a".repeat(64);
        let parse = |version: i32, entry: BundleEntry| {
            parse_bundle(&gzip_doc(&BundleDocument {
                version,
                entries: vec![entry],
            }))
        };

        assert!(parse(2, entry("app-state/images/a.png", None, Some(&hash))).is_ok());
        assert!(parse(2, entry("app-state/images/a.png", Some("YQ=="), None)).is_ok());
        assert!(parse(3, entry("app-state/a.json", Some("YQ=="), None))
            .unwrap_err()
            .contains("Unsupported bundle version"));
        // A reference in a format 1 bundle, outside the blob paths, or with a bad hash.
        assert!(parse(1, entry("app-state/images/a.png", None, Some(&hash))).is_err());
        assert!(parse(2, entry("app-state/a.json", None, Some(&hash))).is_err());
        assert!(parse(2, entry("app-state/images/a.png", None, Some("../../etc"))).is_err());
        assert!(parse(2, entry("app-state/images/a.png", None, None)).is_err());
        assert!(parse(2, entry("app-state/images/a.png", Some("YQ=="), Some(&hash))).is_err());
    }

    #[tokio::test]
    async fn apply_merged_files_takes_blob_tokens_and_refuses_raw_blob_bytes() {
        let (dir, local_data) = make_local_data(HashMap::from([
            ("app-state/images/keep.png", "keep"),
            ("app-state/images/drop.png", "drop"),
            ("app-state/tasks.json", "{}"),
        ]))
        .await;
        let staging = dir.path().join("staging");
        let keep = local_blob_ref(&local_data.join("app-state/images/keep.png"))
            .await
            .unwrap();
        let before = compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
            .await
            .unwrap();

        let raw = HashMap::from([("app-state/images/keep.png".to_string(), b"keep".to_vec())]);
        let err = apply_merged_files(&local_data, &raw, DEFAULT_SYNC_SCOPES, &staging)
            .await
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidData);
        assert_eq!(
            compute_revision(&local_data, DEFAULT_SYNC_SCOPES)
                .await
                .unwrap(),
            before
        );

        let merged = HashMap::from([
            ("app-state/images/keep.png".to_string(), keep.to_token()),
            ("app-state/tasks.json".to_string(), b"{\"tasks\":[]}".to_vec()),
        ]);
        assert_eq!(file_map_blob_refs(&merged), vec![keep.clone()]);
        let (written, removed) =
            apply_merged_files(&local_data, &merged, DEFAULT_SYNC_SCOPES, &staging)
                .await
                .unwrap();
        assert_eq!((written, removed), (2, 1));
        assert_eq!(
            tokio::fs::read(local_data.join("app-state/images/keep.png"))
                .await
                .unwrap(),
            b"keep"
        );
        assert!(!local_data.join("app-state/images/drop.png").exists());
    }

    trait IntoParts {
        fn into_parts(self) -> (TempDir, PathBuf);
    }

    impl IntoParts for (TempDir, PathBuf, serde_json::Value) {
        fn into_parts(self) -> (TempDir, PathBuf) {
            (self.0, self.1)
        }
    }
}
