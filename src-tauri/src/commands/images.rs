//! Image library and generation.

use serde_json::Value;
use tauri::{command, State};

use crate::chat::assistant_tools::lookup_image;
use crate::images::{
    cancel_image_generation, copy_image_to_clipboard, create_image, delete_image,
    delete_image_version, generate_image, list_images, read_image, reveal_image_in_finder,
    set_active_image_version, ImageCreateInput, ImageGenerateInput, ImageGenerationRuntime,
};
use crate::state::AppState;

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn search_lookup_image(query: String) -> Result<Value, String> {
    let payload = lookup_image(&query).await;
    serde_json::to_value(payload).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_list(state: State<'_, AppState>) -> Result<Value, String> {
    let images = list_images(&state).await.map_err(map_err)?;
    serde_json::to_value(images).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_create(state: State<'_, AppState>, input: Value) -> Result<Value, String> {
    let parsed: ImageCreateInput = serde_json::from_value(input).map_err(map_err)?;
    let image = create_image(&state, parsed).await.map_err(map_err)?;
    serde_json::to_value(image).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_read(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let image = read_image(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(image).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let list = delete_image(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(list).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_generate(
    state: State<'_, AppState>,
    runtime: State<'_, ImageGenerationRuntime>,
    input: Value,
) -> Result<Value, String> {
    let parsed: ImageGenerateInput = serde_json::from_value(input).map_err(map_err)?;
    let result = generate_image(&state, &runtime, parsed)
        .await
        .map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_cancel(
    runtime: State<'_, ImageGenerationRuntime>,
    id: String,
) -> Result<(), String> {
    cancel_image_generation(&runtime, &id)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_delete_version(
    state: State<'_, AppState>,
    id: String,
    version_id: String,
) -> Result<Value, String> {
    let result = delete_image_version(&state, &id, &version_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_copy_to_clipboard(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    copy_image_to_clipboard(&state, &id).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_reveal_in_finder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    reveal_image_in_finder(&state, &id).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn images_set_active_version(
    state: State<'_, AppState>,
    id: String,
    version_id: String,
) -> Result<Value, String> {
    let result = set_active_image_version(&state, &id, &version_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}
