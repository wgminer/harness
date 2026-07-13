use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::memory::AppState;
use crate::paths::get_app_state_dir;
use crate::storage::{atomic_write_utf8, file_exists};

const IMAGES_INDEX_FILE: &str = "images.json";
const IMAGES_DIR: &str = "images";
const UNTITLED_IMAGE_TITLE: &str = "Untitled image";

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
}

#[derive(Debug, Clone, Default)]
struct ImagesIndex {
    images: Vec<ImagesIndexEntry>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerateInput {
    pub image_id: String,
    pub prompt: String,
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
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
    }
}

async fn ensure_images_dir(app_state_dir: &Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(images_dir_path(app_state_dir)).await
}

async fn load_images_index(app_state_dir: &Path) -> Result<ImagesIndex, std::io::Error> {
    let path = images_index_path(app_state_dir);
    if !file_exists(&path).await {
        return Ok(ImagesIndex::default());
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
        images.push(ImagesIndexEntry {
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
        });
    }
    sort_by_updated_at_desc(&mut images);
    Ok(ImagesIndex { images })
}

async fn save_images_index(
    state: &AppState,
    app_state_dir: &Path,
    index: &ImagesIndex,
) -> Result<(), std::io::Error> {
    let mut images = index.images.clone();
    sort_by_updated_at_desc(&mut images);
    let payload = serde_json::json!({ "images": images });
    let pretty =
        serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{\"images\":[]}".into());
    atomic_write_utf8(
        &state.write_chains,
        &images_index_path(app_state_dir),
        &pretty,
    )
    .await
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

pub async fn list_images(_state: &AppState) -> Result<Vec<GeneratedImage>, std::io::Error> {
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir).await?;
    let index = load_images_index(&app_state_dir).await?;
    Ok(index
        .images
        .iter()
        .map(|entry| to_generated_image(&app_state_dir, entry))
        .collect())
}

pub async fn create_image(state: &AppState) -> Result<GeneratedImage, std::io::Error> {
    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir).await?;
    let index = load_images_index(&app_state_dir).await?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let entry = ImagesIndexEntry {
        id: id.clone(),
        title: UNTITLED_IMAGE_TITLE.to_string(),
        prompt: String::new(),
        created_at: now,
        updated_at: now,
        size: "auto".into(),
        quality: "auto".into(),
        background: "auto".into(),
        output_format: "png".into(),
        file_name: None,
    };
    let mut images = index.images;
    images.insert(0, entry.clone());
    save_images_index(state, &app_state_dir, &ImagesIndex { images }).await?;
    Ok(to_generated_image(&app_state_dir, &entry))
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
    let index = load_images_index(&app_state_dir).await?;
    let Some(entry) = index.images.iter().find(|item| item.id == clean_id) else {
        return Ok(None);
    };
    let _ = state;
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
    let index = load_images_index(&app_state_dir).await?;
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
        if let Some(file_name) = entry.file_name.as_deref() {
            let path = image_file_path(&app_state_dir, file_name);
            if file_exists(&path).await {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
    }
    save_images_index(state, &app_state_dir, &ImagesIndex { images: next.clone() }).await?;
    Ok(next
        .iter()
        .map(|entry| to_generated_image(&app_state_dir, entry))
        .collect())
}

pub async fn generate_image(
    state: &AppState,
    input: ImageGenerateInput,
) -> Result<GeneratedImage, String> {
    let image_id = input.image_id.trim();
    if image_id.is_empty() {
        return Err("Image id is required.".into());
    }
    let prompt = input.prompt.trim();
    if prompt.is_empty() {
        return Err("Prompt is required.".into());
    }
    let api_key = crate::credentials::resolve_openai_api_key()
        .await
        .trim()
        .to_string();
    if api_key.is_empty() {
        return Err("OpenAI API key required.".into());
    }

    let app_state_dir = get_app_state_dir();
    ensure_images_dir(&app_state_dir)
        .await
        .map_err(|e| e.to_string())?;
    let index = load_images_index(&app_state_dir)
        .await
        .map_err(|e| e.to_string())?;
    let Some(existing) = index.images.iter().find(|item| item.id == image_id).cloned() else {
        return Err("Image not found.".into());
    };

    let size = normalize_size(&input.size)?;
    let background = background_allowed_for_format(&input.output_format, &input.background);
    let options = crate::openai::ImageGenerateOptions {
        size: size.clone(),
        quality: input.quality.clone(),
        background: background.to_string(),
        output_format: input.output_format.clone(),
    };

    let bytes = crate::openai::generate_image(&api_key, prompt, &options)
        .await
        .map_err(|e| e.to_string())?;

    let ext = ext_for_format(&input.output_format);
    let file_name = format!("{image_id}.{ext}");
    let absolute_path = image_file_path(&app_state_dir, &file_name);

    // Remove previous file if extension changed.
    if let Some(prev) = existing.file_name.as_deref() {
        if prev != file_name {
            let prev_path = image_file_path(&app_state_dir, prev);
            if file_exists(&prev_path).await {
                let _ = tokio::fs::remove_file(prev_path).await;
            }
        }
    }

    atomic_write_bytes(&absolute_path, &bytes)
        .await
        .map_err(|e| e.to_string())?;

    let now = chrono::Utc::now().timestamp_millis();
    let updated = ImagesIndexEntry {
        id: existing.id,
        title: title_from_prompt(prompt),
        prompt: prompt.to_string(),
        created_at: existing.created_at,
        updated_at: now,
        size,
        quality: input.quality,
        background: background.to_string(),
        output_format: input.output_format,
        file_name: Some(file_name),
    };

    let images: Vec<ImagesIndexEntry> = index
        .images
        .into_iter()
        .map(|item| {
            if item.id == image_id {
                updated.clone()
            } else {
                item
            }
        })
        .collect();
    save_images_index(state, &app_state_dir, &ImagesIndex { images: images.clone() })
        .await
        .map_err(|e| e.to_string())?;

    let entry = images
        .iter()
        .find(|item| item.id == image_id)
        .cloned()
        .unwrap_or(updated);
    Ok(to_generated_image(&app_state_dir, &entry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_from_prompt_truncates() {
        assert_eq!(title_from_prompt(""), UNTITLED_IMAGE_TITLE);
        assert_eq!(title_from_prompt("  a cat  "), "a cat");
        let long = "a".repeat(80);
        let title = title_from_prompt(&long);
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= 61);
    }

    #[test]
    fn image_paths_use_images_dir() {
        let base = Path::new("/tmp/app-state");
        assert_eq!(images_dir_path(base), base.join("images"));
        assert_eq!(
            image_file_path(base, "abc.png"),
            base.join("images").join("abc.png")
        );
    }

    #[test]
    fn normalize_size_accepts_presets_and_custom() {
        assert_eq!(normalize_size("auto").unwrap(), "auto");
        assert_eq!(normalize_size("1024x1024").unwrap(), "1024x1024");
        assert_eq!(normalize_size("1280x720").unwrap(), "1280x720");
        assert!(normalize_size("100x100").is_err());
        assert!(normalize_size("1025x1024").is_err());
    }

    #[test]
    fn legacy_aspect_maps_to_size() {
        assert_eq!(size_from_legacy_aspect("square"), "1024x1024");
        assert_eq!(size_from_legacy_aspect("landscape"), "1536x1024");
    }
}
