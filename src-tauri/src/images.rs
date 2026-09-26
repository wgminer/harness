mod format;
mod index_store;
mod stub_png;
mod version_tree;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::env_util::is_stub_images;
use crate::state::AppState;
use crate::paths::get_app_state_dir;
use format::*;
use index_store::*;
pub use stub_png::stub_image_png;
use version_tree::*;

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
