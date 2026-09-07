use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::env_util::is_stub_images;
use crate::memory::AppState;
use crate::paths::get_app_state_dir;
use crate::storage::{
    atomic_write_utf8, atomic_write_utf8_unlocked, file_exists, with_path_lock,
};

const IMAGES_INDEX_FILE: &str = "images.json";
const IMAGES_DIR: &str = "images";
const UNTITLED_IMAGE_TITLE: &str = "Untitled image";

/// Per-image cancellation while `generate_image` is in flight.
#[derive(Clone, Default)]
pub struct ImageGenerationRuntime {
    cancels: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

pub fn init_image_generation_runtime() -> ImageGenerationRuntime {
    ImageGenerationRuntime::default()
}

fn normalize_version_kind(kind: &str) -> String {
    match kind {
        "edit" => "edit".into(),
        "finalize" => "finalize".into(),
        _ => "generate".into(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageVersion {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Letter branch label: `"A"`, `"B"`, …
    pub branch: String,
    /// 1-based index along that letter (`A1`, `A2`, `B1`).
    pub index_in_branch: u32,
    pub file_name: String,
    pub prompt: String,
    /// `"generate"`, `"edit"`, or `"finalize"`.
    pub kind: String,
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub absolute_path: Option<String>,
    pub has_file: bool,
    pub versions: Vec<ImageVersion>,
    pub active_version_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deleted_version_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImagesIndexEntry {
    id: String,
    title: String,
    prompt: String,
    created_at: i64,
    updated_at: i64,
    size: String,
    quality: String,
    background: String,
    output_format: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(default)]
    versions: Vec<ImageVersion>,
    #[serde(default)]
    active_version_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    deleted_version_ids: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct ImagesIndex {
    images: Vec<ImagesIndexEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCreateInput {
    pub prompt: String,
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerateInput {
    /// Absent / empty → create a new library entry on first successful generate.
    #[serde(default)]
    pub image_id: Option<String>,
    /// `"new"` (text-to-image), `"adjust"` (edit), or `"finalize"` (high-quality export).
    #[serde(default)]
    pub operation: Option<String>,
    pub prompt: String,
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
    /// Extra reference/annotation images as data URLs (`data:image/...;base64,...`).
    #[serde(default)]
    pub extra_image_data_urls: Vec<String>,
}

fn images_index_path(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(IMAGES_INDEX_FILE)
}

fn images_dir_path(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(IMAGES_DIR)
}

fn image_file_path(app_state_dir: &Path, file_name: &str) -> PathBuf {
    images_dir_path(app_state_dir).join(file_name)
}

fn sort_by_updated_at_desc(entries: &mut [ImagesIndexEntry]) {
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}

fn title_from_prompt(prompt: &str) -> String {
    let trimmed = prompt.trim().split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        return UNTITLED_IMAGE_TITLE.to_string();
    }
    if trimmed.chars().count() <= 60 {
        return trimmed;
    }
    let truncated: String = trimmed.chars().take(60).collect();
    format!("{}…", truncated.trim_end())
}

fn size_from_legacy_aspect(aspect: &str) -> &'static str {
    match aspect {
        "square" => "1024x1024",
        "landscape" => "1536x1024",
        "portrait" => "1024x1536",
        _ => "auto",
    }
}

fn normalize_size(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Size is required.".into());
    }
    if trimmed.eq_ignore_ascii_case("auto") {
        return Ok("auto".into());
    }
    for preset in ["1024x1024", "1536x1024", "1024x1536"] {
        if trimmed.eq_ignore_ascii_case(preset) {
            return Ok(preset.to_string());
        }
    }
    let Some((w_str, h_str)) = trimmed.split_once('x').or_else(|| trimmed.split_once('X')) else {
        return Err("Size must be auto or WIDTHxHEIGHT (e.g. 1280x720).".into());
    };
    let width: u32 = w_str
        .trim()
        .parse()
        .map_err(|_| "Size width must be a positive integer.".to_string())?;
    let height: u32 = h_str
        .trim()
        .parse()
        .map_err(|_| "Size height must be a positive integer.".to_string())?;
    if width == 0 || height == 0 {
        return Err("Width and height must be greater than zero.".into());
    }
    if width % 16 != 0 || height % 16 != 0 {
        return Err("Width and height must be multiples of 16.".into());
    }
    if width > 3840 || height > 3840 {
        return Err("Each edge must be at most 3840px.".into());
    }
    let long = width.max(height);
    let short = width.min(height);
    if short == 0 || long / short > 3 {
        return Err("Aspect ratio must be at most 3:1.".into());
    }
    let pixels = (width as u64) * (height as u64);
    if pixels < 655_360 {
        return Err("Total pixels must be at least 655,360 (e.g. 1024×640).".into());
    }
    if pixels > 8_294_400 {
        return Err("Total pixels must be at most 8,294,400.".into());
    }
    Ok(format!("{width}x{height}"))
}

fn resolve_stored_size(obj: &serde_json::Map<String, serde_json::Value>) -> String {
    if let Some(size) = obj.get("size").and_then(|v| v.as_str()) {
        if let Ok(normalized) = normalize_size(size) {
            return normalized;
        }
        let trimmed = size.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    let aspect = obj.get("aspect").and_then(|v| v.as_str()).unwrap_or("auto");
    size_from_legacy_aspect(aspect).to_string()
}

fn background_allowed_for_format(output_format: &str, background: &str) -> &'static str {
    if output_format == "jpeg" && background == "transparent" {
        return "opaque";
    }
    match background {
        "opaque" => "opaque",
        "transparent" => "transparent",
        _ => "auto",
    }
}

fn ext_for_format(output_format: &str) -> &'static str {
    match output_format {
        "jpeg" => "jpeg",
        "webp" => "webp",
        _ => "png",
    }
}

fn mime_for_file_name(file_name: &str) -> &'static str {
    match output_format_from_file_name(file_name) {
        "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

fn output_format_from_file_name(file_name: &str) -> &'static str {
    match Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpeg") | Some("jpg") => "jpeg",
        Some("webp") => "webp",
        _ => "png",
    }
}

#[cfg(test)]
fn version_label(version: &ImageVersion) -> String {
    format!("{}{}", version.branch, version.index_in_branch)
}

fn crc32_ieee(data: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = if crc & 1 != 0 { 0xffff_ffff } else { 0 };
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

fn png_chunk(tag: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(12 + data.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(tag);
    out.extend_from_slice(data);
    let mut crc_data = Vec::with_capacity(4 + data.len());
    crc_data.extend_from_slice(tag);
    crc_data.extend_from_slice(data);
    out.extend_from_slice(&crc32_ieee(&crc_data).to_be_bytes());
    out
}

/// Deterministic stub PNG (solid color from prompt) for branch-logic testing without OpenAI.
pub fn stub_image_png(prompt: &str, kind: &str) -> Vec<u8> {
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::hash::{Hash, Hasher};
    use std::io::Write;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    prompt.hash(&mut hasher);
    kind.hash(&mut hasher);
    let h = hasher.finish();
    let r = ((h >> 16) & 0xff) as u8;
    let g = ((h >> 8) & 0xff) as u8;
    let b = (h & 0xff) as u8;
    // Keep channels away from pure black so the stage isn't empty-looking.
    let (r, g, b) = (r.max(40), g.max(40), b.max(40));

    const W: u32 = 64;
    const H: u32 = 64;
    let mut raw = Vec::with_capacity(((W * 3 + 1) * H) as usize);
    for row in 0..H {
        raw.push(0); // filter None
        for col in 0..W {
            // Light band so successive stubs are visually distinct even if hues collide.
            let band = if row < 8 { 40u8.wrapping_mul((col % 7) as u8) } else { 0 };
            raw.push(r.wrapping_add(band));
            raw.push(g.wrapping_add(band / 2));
            raw.push(b.wrapping_add((kind.len() as u8).wrapping_mul(3)));
        }
    }
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(&raw).expect("stub png zlib write");
    let compressed = encoder.finish().expect("stub png zlib finish");

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&W.to_be_bytes());
    ihdr.extend_from_slice(&H.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]); // 8-bit RGB

    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend(png_chunk(b"IHDR", &ihdr));
    png.extend(png_chunk(b"IDAT", &compressed));
    png.extend(png_chunk(b"IEND", &[]));
    png
}

/// Deterministic id when legacy rows omit `id`, so UI clicks survive reloads before heal persists.
fn stable_version_id(file_name: &str) -> String {
    format!("fn:{file_name}")
}

fn ensure_version_id(id: &str, file_name: &str) -> String {
    let trimmed = id.trim();
    if !trimmed.is_empty() {
        trimmed.to_string()
    } else {
        stable_version_id(file_name)
    }
}

fn find_version<'a>(entry: &'a ImagesIndexEntry, id: &str) -> Option<&'a ImageVersion> {
    entry.versions.iter().find(|v| v.id == id)
}

fn node_has_child(entry: &ImagesIndexEntry, parent_id: &str) -> bool {
    entry
        .versions
        .iter()
        .any(|v| v.parent_id.as_deref() == Some(parent_id))
}

fn next_branch_letter(entry: &ImagesIndexEntry) -> String {
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

fn next_index_in_branch(entry: &ImagesIndexEntry, branch: &str) -> u32 {
    entry
        .versions
        .iter()
        .filter(|v| v.branch == branch)
        .map(|v| v.index_in_branch)
        .max()
        .unwrap_or(0)
        + 1
}

fn apply_active_version_mirror(entry: &mut ImagesIndexEntry) {
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

fn to_generated_image(app_state_dir: &Path, entry: &ImagesIndexEntry) -> GeneratedImage {
    let absolute_path = entry.file_name.as_ref().map(|name| {
        image_file_path(app_state_dir, name).display().to_string()
    });
    let has_file = absolute_path
        .as_ref()
        .map(|p| Path::new(p).exists())
        .unwrap_or(false);
    GeneratedImage {
        id: entry.id.clone(),
        title: entry.title.clone(),
        prompt: entry.prompt.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        size: entry.size.clone(),
        quality: entry.quality.clone(),
        background: entry.background.clone(),
        output_format: entry.output_format.clone(),
        file_name: entry.file_name.clone(),
        absolute_path: if has_file { absolute_path } else { None },
        has_file,
        versions: entry.versions.clone(),
        active_version_id: entry.active_version_id.clone(),
        deleted_version_ids: entry.deleted_version_ids.clone(),
    }
}

/// Find an on-disk image blob for `id` when the index `fileName` is missing or stale.
fn discover_image_file_name(app_state_dir: &Path, id: &str) -> Option<String> {
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

fn parse_version_obj(obj: &serde_json::Map<String, serde_json::Value>) -> Option<ImageVersion> {
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
fn migrate_versions_to_tree(entry: &mut ImagesIndexEntry, legacy_active_index: Option<usize>) -> bool {
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

fn ensure_root_from_file_name(entry: &mut ImagesIndexEntry) -> bool {
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
fn append_branched_version(
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

/// Restore `fileName` / versions from disk, migrate legacy entries, drop empty shells.
fn heal_images_index_in_memory(app_state_dir: &Path, index: &mut ImagesIndex) -> bool {
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

async fn ensure_images_dir(app_state_dir: &Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(images_dir_path(app_state_dir)).await
}

/// Load index from disk. Second value is true when tree migration / root synthesis mutated entries
/// and the caller should persist.
async fn load_images_index(app_state_dir: &Path) -> Result<(ImagesIndex, bool), std::io::Error> {
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

fn serialize_images_index(index: &ImagesIndex) -> String {
    let mut images = index.images.clone();
    sort_by_updated_at_desc(&mut images);
    let payload = serde_json::json!({ "images": images });
    serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{\"images\":[]}".into())
}

async fn save_images_index(
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
async fn save_images_index_unlocked(
    app_state_dir: &Path,
    index: &ImagesIndex,
) -> Result<(), std::io::Error> {
    atomic_write_utf8_unlocked(
        &images_index_path(app_state_dir),
        &serialize_images_index(index),
    )
    .await
}

async fn prepare_images_index(app_state_dir: &Path) -> Result<(ImagesIndex, bool), std::io::Error> {
    let (mut index, load_dirty) = load_images_index(app_state_dir).await?;
    let heal_dirty = heal_images_index_in_memory(app_state_dir, &mut index);
    Ok((index, load_dirty || heal_dirty))
}

async fn load_healed_images_index(
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

async fn remove_image_blob(app_state_dir: &Path, file_name: &str) {
    let path = image_file_path(app_state_dir, file_name);
    if file_exists(&path).await {
        let _ = tokio::fs::remove_file(path).await;
    }
}

async fn remove_all_image_blobs(app_state_dir: &Path, entry: &ImagesIndexEntry) {
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

async fn atomic_write_bytes(path: &Path, data: &[u8]) -> std::io::Result<()> {
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

pub async fn list_images(state: &AppState) -> Result<Vec<GeneratedImage>, std::io::Error> {
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir).await?;
    let index = load_healed_images_index(state, &app_state_dir).await?;
    Ok(index
        .images
        .iter()
        .map(|entry| to_generated_image(&app_state_dir, entry))
        .collect())
}

/// Persist a library row as soon as the user submits a prompt (before OpenAI returns).
pub async fn create_image(
    state: &AppState,
    input: ImageCreateInput,
) -> Result<GeneratedImage, String> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required.".into());
    }
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir)
        .await
        .map_err(|e| e.to_string())?;

    let size = normalize_size(&input.size)?;
    let background = background_allowed_for_format(&input.output_format, &input.background);
    let now = chrono::Utc::now().timestamp_millis();
    let entry = ImagesIndexEntry {
        id: Uuid::new_v4().to_string(),
        title: title_from_prompt(prompt),
        prompt: prompt.to_string(),
        created_at: now,
        updated_at: now,
        size,
        quality: input.quality.clone(),
        background: background.to_string(),
        output_format: input.output_format.clone(),
        file_name: None,
        versions: vec![],
        active_version_id: String::new(),
        deleted_version_ids: vec![],
    };

    let index_path = images_index_path(&app_state_dir);
    with_path_lock(&state.write_chains, &index_path, async {
        let (mut index, _) = prepare_images_index(&app_state_dir)
            .await
            .map_err(|e| e.to_string())?;
        index.images.insert(0, entry.clone());
        save_images_index_unlocked(&app_state_dir, &index)
            .await
            .map_err(|e| e.to_string())?;
        Ok(to_generated_image(&app_state_dir, &entry))
    })
    .await
}

pub async fn read_image(
    state: &AppState,
    id: &str,
) -> Result<Option<GeneratedImage>, std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Ok(None);
    }
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir).await?;
    let index = load_healed_images_index(state, &app_state_dir).await?;
    let Some(entry) = index.images.iter().find(|item| item.id == clean_id) else {
        return Ok(None);
    };
    Ok(Some(to_generated_image(&app_state_dir, entry)))
}

pub async fn delete_image(
    state: &AppState,
    id: &str,
) -> Result<Vec<GeneratedImage>, std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return list_images(state).await;
    }
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir).await?;
    let index = load_healed_images_index(state, &app_state_dir).await?;
    let before_len = index.images.len();
    let removed = index.images.iter().find(|item| item.id == clean_id).cloned();
    let next: Vec<ImagesIndexEntry> = index
        .images
        .into_iter()
        .filter(|item| item.id != clean_id)
        .collect();
    if next.len() == before_len {
        return Ok(next
            .iter()
            .map(|entry| to_generated_image(&app_state_dir, entry))
            .collect());
    }
    if let Some(entry) = removed {
        remove_all_image_blobs(&app_state_dir, &entry).await;
    }
    save_images_index(state, &app_state_dir, &ImagesIndex { images: next.clone() }).await?;
    Ok(next
        .iter()
        .map(|entry| to_generated_image(&app_state_dir, entry))
        .collect())
}

pub async fn set_active_image_version(
    state: &AppState,
    id: &str,
    version_id: &str,
) -> Result<GeneratedImage, String> {
    let clean_id = id.trim();
    let version_id = version_id.trim();
    if clean_id.is_empty() {
        return Err("Image id is required.".into());
    }
    if version_id.is_empty() {
        return Err("Version id is required.".into());
    }
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir)
        .await
        .map_err(|e| e.to_string())?;
    let index_path = images_index_path(&app_state_dir);
    with_path_lock(&state.write_chains, &index_path, async {
        let (mut index, dirty) = prepare_images_index(&app_state_dir)
            .await
            .map_err(|e| e.to_string())?;
        let Some(entry) = index.images.iter_mut().find(|item| item.id == clean_id) else {
            return Err("Image not found.".into());
        };
        if find_version(entry, version_id).is_none() {
            return Err("Version not found.".into());
        }
        entry.active_version_id = version_id.to_string();
        apply_active_version_mirror(entry);
        entry.updated_at = chrono::Utc::now().timestamp_millis();
        let result = to_generated_image(&app_state_dir, entry);
        // Always persist after an explicit active-version change (and any heal).
        let _ = dirty;
        save_images_index_unlocked(&app_state_dir, &index)
            .await
            .map_err(|e| e.to_string())?;
        Ok(result)
    })
    .await
}

fn decode_data_url_image(data_url: &str, index: usize) -> Result<crate::openai::ImageEditPart, String> {
    use base64::Engine;
    let trimmed = data_url.trim();
    if trimmed.is_empty() {
        return Err("Extra image data URL is empty.".into());
    }
    let (mime_hint, payload) = if let Some((header, data)) = trimmed.split_once(',') {
        let mime = header
            .strip_prefix("data:")
            .and_then(|h| h.split(';').next())
            .unwrap_or("image/png");
        (mime, data)
    } else {
        ("image/png", trimmed)
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Invalid extra image base64: {e}"))?;
    if bytes.is_empty() {
        return Err("Extra image data is empty.".into());
    }
    let ext = match mime_hint {
        "image/jpeg" => "jpeg",
        "image/webp" => "webp",
        _ => "png",
    };
    let file_name = format!("extra-{index}.{ext}");
    Ok(crate::openai::ImageEditPart {
        bytes,
        file_name,
        mime_type: mime_hint.to_string(),
    })
}

fn map_openai_image_error(err: crate::openai::OpenAIError) -> String {
    if matches!(err, crate::openai::OpenAIError::Cancelled) {
        "Image generation cancelled.".into()
    } else {
        err.to_string()
    }
}

async fn register_image_cancel(
    runtime: &ImageGenerationRuntime,
    image_id: &str,
) -> CancellationToken {
    let token = CancellationToken::new();
    let mut map = runtime.cancels.lock().await;
    if let Some(old) = map.remove(image_id) {
        old.cancel();
    }
    map.insert(image_id.to_string(), token.clone());
    token
}

async fn clear_image_cancel(runtime: &ImageGenerationRuntime, image_id: &str) {
    runtime.cancels.lock().await.remove(image_id);
}

pub async fn cancel_image_generation(runtime: &ImageGenerationRuntime, id: &str) -> Result<(), String> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Err("Image id is required.".into());
    }
    if let Some(token) = runtime.cancels.lock().await.get(clean_id) {
        token.cancel();
    }
    Ok(())
}

pub async fn generate_image(
    state: &AppState,
    runtime: &ImageGenerationRuntime,
    input: ImageGenerateInput,
) -> Result<GeneratedImage, String> {
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required.".into());
    }
    let image_id = input
        .image_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let is_finalize = input
        .operation
        .as_deref()
        .map(|op| op.eq_ignore_ascii_case("finalize"))
        .unwrap_or(false);
    let quality = if is_finalize {
        "high".to_string()
    } else {
        input.quality.clone()
    };

    let entry_id = image_id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let cancel_token = register_image_cancel(runtime, &entry_id).await;

    let result = async {
        if cancel_token.is_cancelled() {
            return Err("Image generation cancelled.".into());
        }

        let stub = is_stub_images();
        let api_key = if stub {
            String::new()
        } else {
            let key = crate::credentials::resolve_openai_api_key()
                .await
                .trim()
                .to_string();
            if key.is_empty() {
                return Err("OpenAI API key required.".into());
            }
            key
        };

        let app_state_dir = get_app_state_dir();
        ensure_images_dir(&app_state_dir)
            .await
            .map_err(|e| e.to_string())?;

        let size = normalize_size(&input.size)?;
        let background = background_allowed_for_format(&input.output_format, &input.background);
        let options = crate::openai::ImageGenerateOptions {
            size: size.clone(),
            quality: quality.clone(),
            background: background.to_string(),
            output_format: input.output_format.clone(),
        };

        // Resolve operation: existing row with a file → adjust; draft id / no id → text-to-image.
        let mut source_bytes: Option<(Vec<u8>, String)> = None;
        let mut draft_entry_id: Option<String> = None;
        if let Some(id) = image_id.as_deref() {
            let index = load_healed_images_index(state, &app_state_dir)
                .await
                .map_err(|e| e.to_string())?;
            let Some(existing) = index.images.iter().find(|item| item.id == id) else {
                return Err("Image not found.".into());
            };
            if let Some(file_name) = existing.file_name.clone() {
                let path = image_file_path(&app_state_dir, &file_name);
                if path.exists() {
                    let bytes = tokio::fs::read(&path)
                        .await
                        .map_err(|e| format!("Failed to read image for edit: {e}"))?;
                    source_bytes = Some((bytes, file_name));
                } else {
                    draft_entry_id = Some(id.to_string());
                }
            } else {
                draft_entry_id = Some(id.to_string());
            }
        } else {
            let op = input
                .operation
                .as_deref()
                .unwrap_or("new")
                .trim()
                .to_ascii_lowercase();
            if op != "new" && op != "adjust" && op != "finalize" {
                return Err("Operation must be \"new\", \"adjust\", or \"finalize\".".into());
            }
            if op == "adjust" || op == "finalize" {
                return Err("Image id is required to adjust or finalize.".into());
            }
        }

        let mut edit_parts: Vec<crate::openai::ImageEditPart> = Vec::new();
        if let Some((source, file_name)) = source_bytes {
            edit_parts.push(crate::openai::ImageEditPart {
                bytes: source,
                file_name: file_name.clone(),
                mime_type: mime_for_file_name(&file_name).to_string(),
            });
        }
        for (i, data_url) in input.extra_image_data_urls.iter().enumerate() {
            edit_parts.push(decode_data_url_image(data_url, i)?);
        }

        let use_edits = !edit_parts.is_empty();
        let operation = if use_edits { "adjust" } else { "new" };

        let bytes = if stub {
            eprintln!(
                "[harness] stub images: {} ({}) — no OpenAI call",
                operation, prompt
            );
            if cancel_token.is_cancelled() {
                return Err("Image generation cancelled.".into());
            }
            stub_image_png(prompt, operation)
        } else if use_edits {
            crate::openai::edit_image(
                &api_key,
                prompt,
                &edit_parts,
                &options,
                Some(&cancel_token),
            )
            .await
            .map_err(map_openai_image_error)?
        } else {
            crate::openai::generate_image(&api_key, prompt, &options, Some(&cancel_token))
                .await
                .map_err(map_openai_image_error)?
        };

        if cancel_token.is_cancelled() {
            return Err("Image generation cancelled.".into());
        }

        let now = chrono::Utc::now().timestamp_millis();
        let kind = if is_finalize {
            "finalize"
        } else if operation == "adjust" {
            "edit"
        } else {
            "generate"
        };
        let output_format = if stub {
            "png".to_string()
        } else {
            input.output_format.clone()
        };
        let ext = ext_for_format(&output_format);

        // Write the blob *after* appending the version inside the index lock.
        // Writing first lets heal_images_index discover the orphan file on a draft
        // (empty versions) and synthesize v1, then append_branched_version adds v2
        // with the same file — the "initial output saved twice" bug.
        let file_name = format!("{entry_id}-{now}-{}.{ext}", &Uuid::new_v4().to_string()[..8]);
        let absolute_path = image_file_path(&app_state_dir, &file_name);

        let version = ImageVersion {
            id: Uuid::new_v4().to_string(),
            parent_id: None,
            branch: "A".into(),
            index_in_branch: 1,
            file_name: file_name.clone(),
            prompt: prompt.to_string(),
            kind: kind.into(),
            size: size.clone(),
            quality: quality.clone(),
            background: background.to_string(),
            output_format: output_format.clone(),
            created_at: now,
        };

        let index_path = images_index_path(&app_state_dir);
        with_path_lock(&state.write_chains, &index_path, async {
            let (mut index, _) = prepare_images_index(&app_state_dir)
                .await
                .map_err(|e| e.to_string())?;

            if let Some(existing) = index.images.iter_mut().find(|item| item.id == entry_id) {
                if draft_entry_id.is_some() {
                    existing.title = title_from_prompt(prompt);
                    existing.prompt = prompt.to_string();
                    existing.size = size.clone();
                    existing.quality = quality.clone();
                    existing.background = background.to_string();
                    existing.output_format = output_format.clone();
                }
                append_branched_version(existing, version)?;
                existing.updated_at = now;
            } else {
                let mut entry = ImagesIndexEntry {
                    id: entry_id.clone(),
                    title: title_from_prompt(prompt),
                    prompt: prompt.to_string(),
                    created_at: now,
                    updated_at: now,
                    size: size.clone(),
                    quality: quality.clone(),
                    background: background.to_string(),
                    output_format: output_format.clone(),
                    file_name: Some(file_name.clone()),
                    versions: vec![],
                    active_version_id: String::new(),
                    deleted_version_ids: vec![],
                };
                append_branched_version(&mut entry, version)?;
                index.images.insert(0, entry);
            }

            atomic_write_bytes(&absolute_path, &bytes)
                .await
                .map_err(|e| e.to_string())?;

            save_images_index_unlocked(&app_state_dir, &index)
                .await
                .map_err(|e| e.to_string())?;

            let entry = index
                .images
                .iter()
                .find(|item| item.id == entry_id)
                .cloned()
                .ok_or_else(|| "Image not found after save.".to_string())?;
            Ok(to_generated_image(&app_state_dir, &entry))
        })
        .await
    }
    .await;

    clear_image_cancel(runtime, &entry_id).await;
    result
}

pub async fn delete_image_version(
    state: &AppState,
    image_id: &str,
    version_id: &str,
) -> Result<GeneratedImage, String> {
    let clean_id = image_id.trim();
    let version_id = version_id.trim();
    if clean_id.is_empty() {
        return Err("Image id is required.".into());
    }
    if version_id.is_empty() {
        return Err("Version id is required.".into());
    }

    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir)
        .await
        .map_err(|e| e.to_string())?;
    let index_path = images_index_path(&app_state_dir);
    with_path_lock(&state.write_chains, &index_path, async {
        let (mut index, _) = prepare_images_index(&app_state_dir)
            .await
            .map_err(|e| e.to_string())?;
        let Some(entry) = index.images.iter_mut().find(|item| item.id == clean_id) else {
            return Err("Image not found.".into());
        };
        if find_version(entry, version_id).is_none() {
            return Err("Version not found.".into());
        }
        if node_has_child(entry, version_id) {
            return Err("Cannot delete a version that has child versions.".into());
        }
        let version = find_version(entry, version_id).cloned().unwrap();
        let parent_id = version.parent_id.clone();
        entry.versions.retain(|v| v.id != version_id);
        if !entry.deleted_version_ids.contains(&version_id.to_string()) {
            entry.deleted_version_ids.push(version_id.to_string());
        }
        remove_image_blob(&app_state_dir, &version.file_name).await;
        if entry.active_version_id == version_id {
            entry.active_version_id = parent_id
                .filter(|pid| find_version(entry, pid).is_some())
                .or_else(|| entry.versions.last().map(|v| v.id.clone()))
                .unwrap_or_default();
        }
        apply_active_version_mirror(entry);
        entry.updated_at = chrono::Utc::now().timestamp_millis();
        let result = to_generated_image(&app_state_dir, entry);
        save_images_index_unlocked(&app_state_dir, &index)
            .await
            .map_err(|e| e.to_string())?;
        Ok(result)
    })
    .await
}

fn copy_image_bytes_to_clipboard(bytes: &[u8], file_name: &str) -> Result<(), String> {
    let format = image::guess_format(bytes)
        .map_err(|e| format!("Unsupported image format: {e}"))?;
    let img = image::load_from_memory_with_format(bytes, format)
        .map_err(|e| format!("Failed to decode image: {e}"))?;
    let rgba = img.to_rgba8();
    let width = rgba.width() as usize;
    let height = rgba.height() as usize;
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_image(arboard::ImageData {
            width,
            height,
            bytes: rgba.into_raw().into(),
        })
        .map_err(|e| format!("Failed to copy image to clipboard: {e}"))?;
    eprintln!("[harness] copied image to clipboard ({})", file_name);
    Ok(())
}

pub async fn copy_image_to_clipboard(state: &AppState, id: &str) -> Result<(), String> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Err("Image id is required.".into());
    }
    let image = read_image(state, clean_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Image not found.".to_string())?;
    if !image.has_file {
        return Err("Image has no file.".into());
    }
    let file_name = image
        .file_name
        .clone()
        .ok_or_else(|| "Image has no file.".to_string())?;
    let path = image_file_path(&get_app_state_dir(), &file_name);
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read image file: {e}"))?;
    copy_image_bytes_to_clipboard(&bytes, &file_name)
}

pub async fn reveal_image_in_finder(state: &AppState, id: &str) -> Result<(), String> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Err("Image id is required.".into());
    }
    let image = read_image(state, clean_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Image not found.".to_string())?;
    let path = image
        .absolute_path
        .ok_or_else(|| "Image has no file.".to_string())?;
    crate::memory::show_item_in_folder(std::path::Path::new(&path))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry(id: &str) -> ImagesIndexEntry {
        ImagesIndexEntry {
            id: id.to_string(),
            title: "Untitled image".into(),
            prompt: String::new(),
            created_at: 1,
            updated_at: 1,
            size: "1024x1024".into(),
            quality: "low".into(),
            background: "opaque".into(),
            output_format: "png".into(),
            file_name: None,
            versions: vec![],
            active_version_id: String::new(),
            deleted_version_ids: vec![],
        }
    }

    fn ver(
        id: &str,
        parent: Option<&str>,
        branch: &str,
        index: u32,
        file: &str,
    ) -> ImageVersion {
        ImageVersion {
            id: id.to_string(),
            parent_id: parent.map(|s| s.to_string()),
            branch: branch.into(),
            index_in_branch: index,
            file_name: file.into(),
            prompt: format!("p-{id}"),
            kind: "generate".into(),
            size: "1024x1024".into(),
            quality: "low".into(),
            background: "opaque".into(),
            output_format: "png".into(),
            created_at: index as i64,
        }
    }

    #[test]
    fn title_from_prompt_truncates() {
        assert_eq!(title_from_prompt(""), UNTITLED_IMAGE_TITLE);
        assert_eq!(title_from_prompt("  a cat  "), "a cat");
    }

    #[test]
    fn version_label_formats() {
        let v = ver("1", None, "B", 2, "x.png");
        assert_eq!(version_label(&v), "B2");
    }

    #[test]
    fn migrate_linear_versions_to_branch_a() {
        let mut entry = sample_entry("img");
        // Simulate legacy linear versions (empty id / no parent chain).
        entry.versions = vec![
            ImageVersion {
                id: String::new(),
                parent_id: None,
                branch: String::new(),
                index_in_branch: 0,
                file_name: "a.png".into(),
                prompt: "one".into(),
                kind: "generate".into(),
                size: "1024x1024".into(),
                quality: "low".into(),
                background: "opaque".into(),
                output_format: "png".into(),
                created_at: 1,
            },
            ImageVersion {
                id: String::new(),
                parent_id: None,
                branch: String::new(),
                index_in_branch: 0,
                file_name: "b.png".into(),
                prompt: "two".into(),
                kind: "edit".into(),
                size: "1024x1024".into(),
                quality: "high".into(),
                background: "opaque".into(),
                output_format: "png".into(),
                created_at: 2,
            },
        ];
        assert!(migrate_versions_to_tree(&mut entry, Some(0)));
        assert_eq!(entry.versions.len(), 2);
        assert_eq!(entry.versions[0].branch, "A");
        assert_eq!(entry.versions[0].index_in_branch, 1);
        assert!(entry.versions[0].parent_id.is_none());
        assert_eq!(entry.versions[1].branch, "A");
        assert_eq!(entry.versions[1].index_in_branch, 2);
        assert_eq!(
            entry.versions[1].parent_id.as_deref(),
            Some(entry.versions[0].id.as_str())
        );
        assert_eq!(entry.active_version_id, entry.versions[0].id);
        assert_eq!(entry.prompt, "one");
        assert_eq!(entry.versions[0].id, stable_version_id("a.png"));
        assert_eq!(entry.versions[1].id, stable_version_id("b.png"));
    }

    #[test]
    fn missing_version_ids_are_stable_across_parses() {
        let row = serde_json::json!({
            "fileName": "x-1.png",
            "prompt": "hi",
            "kind": "generate",
            "size": "auto",
            "quality": "low",
            "background": "opaque",
            "outputFormat": "png",
            "createdAt": 1
        });
        let a = parse_version_obj(row.as_object().unwrap()).unwrap();
        let b = parse_version_obj(row.as_object().unwrap()).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(a.id, "fn:x-1.png");
    }

    #[test]
    fn tip_continue_same_letter() {
        let mut entry = sample_entry("img");
        let a1 = ver("a1", None, "A", 1, "a1.png");
        entry.versions.push(a1.clone());
        entry.active_version_id = a1.id.clone();
        let child = ver("a2", None, "X", 9, "a2.png");
        append_branched_version(&mut entry, child).unwrap();
        assert_eq!(entry.versions.len(), 2);
        assert_eq!(entry.versions[1].branch, "A");
        assert_eq!(entry.versions[1].index_in_branch, 2);
        assert_eq!(entry.versions[1].parent_id.as_deref(), Some("a1"));
        assert_eq!(entry.active_version_id, entry.versions[1].id);
    }

    #[test]
    fn fork_allocates_next_letter() {
        let mut entry = sample_entry("img");
        entry.versions.push(ver("a1", None, "A", 1, "a1.png"));
        entry.versions.push(ver("a2", Some("a1"), "A", 2, "a2.png"));
        // Active is a1 which already has child a2 → fork B.
        entry.active_version_id = "a1".into();
        append_branched_version(&mut entry, ver("b1", None, "Z", 9, "b1.png")).unwrap();
        let b1 = entry.versions.iter().find(|v| v.file_name == "b1.png").unwrap();
        assert_eq!(b1.branch, "B");
        assert_eq!(b1.index_in_branch, 1);
        assert_eq!(b1.parent_id.as_deref(), Some("a1"));
        assert_eq!(entry.active_version_id, b1.id);
    }

    /// Full branch scenario without OpenAI: create → tip continue → select root → fork → tip continue on B.
    #[test]
    fn stub_branch_scenario_continue_then_fork() {
        let mut entry = sample_entry("img");
        // A1 root
        append_branched_version(&mut entry, ver("a1", None, "?", 0, "a1.png")).unwrap();
        assert_eq!(version_label(&entry.versions[0]), "A1");
        let a1 = entry.versions[0].id.clone();

        // Tip continue → A2
        append_branched_version(&mut entry, ver("a2", None, "?", 0, "a2.png")).unwrap();
        assert_eq!(entry.versions.len(), 2);
        assert_eq!(version_label(&entry.versions[1]), "A2");
        assert_eq!(entry.versions[1].parent_id.as_deref(), Some(a1.as_str()));

        // Tip continue → A3
        append_branched_version(&mut entry, ver("a3", None, "?", 0, "a3.png")).unwrap();
        assert_eq!(entry.versions.len(), 3);
        assert_eq!(version_label(&entry.versions[2]), "A3");

        // Select A1 (has children) → fork B1
        entry.active_version_id = a1.clone();
        append_branched_version(&mut entry, ver("b1", None, "?", 0, "b1.png")).unwrap();
        assert_eq!(entry.versions.len(), 4);
        let b1 = entry.versions.iter().find(|v| v.file_name == "b1.png").unwrap();
        assert_eq!(version_label(b1), "B1");
        assert_eq!(b1.parent_id.as_deref(), Some(a1.as_str()));

        // Tip continue on B → B2
        append_branched_version(&mut entry, ver("b2", None, "?", 0, "b2.png")).unwrap();
        assert_eq!(entry.versions.len(), 5);
        let b2 = entry.versions.iter().find(|v| v.file_name == "b2.png").unwrap();
        assert_eq!(version_label(b2), "B2");
        assert_eq!(b2.parent_id.as_deref(), Some("b1"));

        // Prior runs untouched
        assert_eq!(entry.versions[0].file_name, "a1.png");
        assert_eq!(entry.versions[1].file_name, "a2.png");
        assert_eq!(entry.versions[2].file_name, "a3.png");
        assert_eq!(
            entry
                .versions
                .iter()
                .map(|v| v.file_name.as_str())
                .collect::<Vec<_>>(),
            vec!["a1.png", "a2.png", "a3.png", "b1.png", "b2.png"]
        );
    }

    #[test]
    fn stub_image_png_is_valid_and_prompt_sensitive() {
        let a = stub_image_png("cat", "new");
        let b = stub_image_png("dog", "new");
        let c = stub_image_png("cat", "adjust");
        assert!(a.starts_with(&[0x89, b'P', b'N', b'G']));
        assert!(a.len() > 64);
        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn heal_drops_empty_shells() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("images")).unwrap();
        let mut index = ImagesIndex {
            images: vec![sample_entry("shell")],
        };
        assert!(heal_images_index_in_memory(tmp.path(), &mut index));
        assert!(index.images.is_empty());
    }

    /// Regression: a draft row + blob already on disk must not be treated as two
    /// versions when generate appends after heal (write-before-index bug).
    #[test]
    fn heal_draft_then_append_would_duplicate_if_blob_preexists() {
        let tmp = tempfile::tempdir().unwrap();
        let images_dir = tmp.path().join("images");
        std::fs::create_dir_all(&images_dir).unwrap();
        let blob = "draft-1-aaaaaaaa.png";
        std::fs::write(images_dir.join(blob), b"png").unwrap();

        let mut entry = sample_entry("draft");
        entry.file_name = None;
        entry.versions.clear();
        entry.active_version_id.clear();
        entry.prompt = "a mug".into();
        let mut index = ImagesIndex {
            images: vec![entry],
        };
        assert!(heal_images_index_in_memory(tmp.path(), &mut index));
        assert_eq!(index.images[0].versions.len(), 1);
        assert_eq!(index.images[0].versions[0].file_name, blob);

        // Same file name appended again → the duplicate-version failure mode.
        let dup = ver("new", None, "A", 1, blob);
        append_branched_version(&mut index.images[0], dup).unwrap();
        assert_eq!(index.images[0].versions.len(), 2);
        assert_eq!(
            index.images[0].versions[0].file_name,
            index.images[0].versions[1].file_name
        );
    }

    #[test]
    fn heal_does_not_remap_or_drop_version_runs() {
        let tmp = tempfile::tempdir().unwrap();
        let images_dir = tmp.path().join("images");
        std::fs::create_dir_all(&images_dir).unwrap();
        // Only the latest blob exists — older run file is missing (sync race).
        std::fs::write(images_dir.join("img-2.png"), b"new").unwrap();

        let mut entry = sample_entry("img");
        entry.file_name = Some("img-2.png".into());
        entry.versions = vec![
            ver("a1", None, "A", 1, "img-1.png"),
            ver("a2", Some("a1"), "A", 2, "img-2.png"),
        ];
        entry.active_version_id = "a2".into();
        let mut index = ImagesIndex {
            images: vec![entry],
        };
        let changed = heal_images_index_in_memory(tmp.path(), &mut index);
        assert!(!changed, "heal must not rewrite version history for missing blobs");
        assert_eq!(index.images[0].versions.len(), 2);
        assert_eq!(index.images[0].versions[0].file_name, "img-1.png");
        assert_eq!(index.images[0].versions[1].file_name, "img-2.png");
    }

    #[test]
    fn next_branch_letter_skips_used() {
        let mut entry = sample_entry("img");
        entry.versions.push(ver("a1", None, "A", 1, "a.png"));
        entry.versions.push(ver("b1", Some("a1"), "B", 1, "b.png"));
        assert_eq!(next_branch_letter(&entry), "C");
    }
}
