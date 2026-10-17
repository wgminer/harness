//! Google (Gemini API) image generation and edits.

use std::io::Cursor;
use std::time::Duration;

use base64::Engine;
use image::imageops::FilterType;
use image::ImageFormat;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use crate::openai::{ImageEditPart, ImageGenerateOptions};

const GOOGLE_INTERACTIONS_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/interactions";
const CANCELLED: &str = "Image generation cancelled.";

/// Aspect ratios the image models accept; a requested size snaps to the nearest.
const ASPECT_RATIOS: [(&str, f64); 10] = [
    ("1:1", 1.0),
    ("3:2", 3.0 / 2.0),
    ("2:3", 2.0 / 3.0),
    ("4:3", 4.0 / 3.0),
    ("3:4", 3.0 / 4.0),
    ("5:4", 5.0 / 4.0),
    ("4:5", 4.0 / 5.0),
    ("16:9", 16.0 / 9.0),
    ("9:16", 9.0 / 16.0),
    ("21:9", 21.0 / 9.0),
];

const PRESET_SIZES: [&str; 3] = ["1024x1024", "1536x1024", "1024x1536"];

pub(super) fn google_image_model() -> String {
    std::env::var("GOOGLE_IMAGE_MODEL").unwrap_or_else(|_| "gemini-nano-banana-2.1".into())
}

fn parse_dims(size: &str) -> Option<(u32, u32)> {
    let (w, h) = size.trim().split_once(['x', 'X'])?;
    let width: u32 = w.trim().parse().ok()?;
    let height: u32 = h.trim().parse().ok()?;
    (width > 0 && height > 0).then_some((width, height))
}

fn nearest_aspect_ratio(width: u32, height: u32) -> &'static str {
    let target = (width as f64 / height as f64).ln();
    ASPECT_RATIOS
        .iter()
        .min_by(|a, b| {
            let da = (a.1.ln() - target).abs();
            let db = (b.1.ln() - target).abs();
            da.total_cmp(&db)
        })
        .map(|(label, _)| *label)
        .unwrap_or("1:1")
}

/// `1K` for drafts; `high` quality or a larger requested size steps up.
fn image_size_tier(dims: Option<(u32, u32)>, quality: &str) -> &'static str {
    let long = dims.map(|(w, h)| w.max(h)).unwrap_or(0);
    if long > 3072 {
        "4K"
    } else if long > 1536 || quality == "high" {
        "2K"
    } else {
        "1K"
    }
}

fn build_request_body(
    model: &str,
    prompt: &str,
    images: &[ImageEditPart],
    options: &ImageGenerateOptions,
) -> Value {
    let dims = parse_dims(&options.size);
    // The API only returns JPEG; `fit_output` converts to the requested format.
    let mut response_format = json!({
        "type": "image",
        "mime_type": "image/jpeg",
        "image_size": image_size_tier(dims, &options.quality),
    });
    if let Some((width, height)) = dims {
        response_format["aspect_ratio"] = json!(nearest_aspect_ratio(width, height));
    }

    let mut input = vec![json!({ "type": "text", "text": prompt })];
    for image in images {
        input.push(json!({
            "type": "image",
            "mime_type": image.mime_type,
            "data": base64::engine::general_purpose::STANDARD.encode(&image.bytes),
        }));
    }

    json!({ "model": model, "input": input, "response_format": response_format })
}

fn decode_image_response(parsed: &Value) -> Result<Vec<u8>, String> {
    let data = parsed
        .get("steps")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter(|step| step.get("type").and_then(|v| v.as_str()) == Some("model_output"))
        .filter_map(|step| step.get("content").and_then(|v| v.as_array()))
        .flatten()
        .find(|block| block.get("type").and_then(|v| v.as_str()) == Some("image"))
        .and_then(|block| block.get("data").and_then(|v| v.as_str()))
        .ok_or_else(|| {
            let status = parsed
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            format!("Google returned no image (status: {status}).")
        })?;

    base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Failed to decode image data: {e}"))
}

fn api_error_message(detail: &str) -> String {
    serde_json::from_str::<Value>(detail)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .and_then(|m| m.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| detail.to_string())
}

/// Convert the returned JPEG to the requested format. Custom sizes are cropped and
/// scaled to the exact pixels; presets keep the model's native resolution.
fn fit_output(jpeg: Vec<u8>, options: &ImageGenerateOptions) -> Result<Vec<u8>, String> {
    let custom = parse_dims(&options.size).filter(|_| !PRESET_SIZES.contains(&options.size.as_str()));
    if custom.is_none() && options.output_format == "jpeg" {
        return Ok(jpeg);
    }

    let mut decoded = image::load_from_memory(&jpeg)
        .map_err(|e| format!("Failed to read generated image: {e}"))?;
    if let Some((width, height)) = custom {
        if (decoded.width(), decoded.height()) != (width, height) {
            decoded = decoded.resize_to_fill(width, height, FilterType::Lanczos3);
        }
    }
    let format = match options.output_format.as_str() {
        "jpeg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        _ => ImageFormat::Png,
    };
    let mut out = Cursor::new(Vec::new());
    decoded
        .write_to(&mut out, format)
        .map_err(|e| format!("Failed to encode generated image: {e}"))?;
    Ok(out.into_inner())
}

/// Text-to-image when `images` is empty, otherwise an instruction edit of those images.
pub(super) async fn generate_image(
    api_key: &str,
    prompt: &str,
    images: &[ImageEditPart],
    options: &ImageGenerateOptions,
    cancel: &CancellationToken,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let body = build_request_body(&google_image_model(), prompt, images, options);
    let request = client
        .post(GOOGLE_INTERACTIONS_URL)
        .header("x-goog-api-key", api_key)
        .json(&body)
        .send();

    let response = tokio::select! {
        res = request => res.map_err(|e| e.to_string())?,
        _ = cancel.cancelled() => return Err(CANCELLED.into()),
    };
    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(api_error_message(&detail));
    }
    let parsed: Value = tokio::select! {
        res = response.json() => res.map_err(|e| e.to_string())?,
        _ = cancel.cancelled() => return Err(CANCELLED.into()),
    };
    fit_output(decode_image_response(&parsed)?, options)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(size: &str, quality: &str, output_format: &str) -> ImageGenerateOptions {
        ImageGenerateOptions {
            size: size.into(),
            quality: quality.into(),
            background: "opaque".into(),
            output_format: output_format.into(),
        }
    }

    #[test]
    fn snaps_sizes_to_the_nearest_supported_aspect_ratio() {
        assert_eq!(nearest_aspect_ratio(1024, 1024), "1:1");
        assert_eq!(nearest_aspect_ratio(1536, 1024), "3:2");
        assert_eq!(nearest_aspect_ratio(1024, 1536), "2:3");
        assert_eq!(nearest_aspect_ratio(1280, 720), "16:9");
        assert_eq!(nearest_aspect_ratio(3840, 1280), "21:9");
    }

    #[test]
    fn builds_request_with_size_tier_and_input_images() {
        let draft = build_request_body("m", "a cat", &[], &options("1536x1024", "low", "png"));
        assert_eq!(draft["response_format"]["aspect_ratio"], "3:2");
        assert_eq!(draft["response_format"]["image_size"], "1K");
        assert_eq!(draft["input"].as_array().map(Vec::len), Some(1));

        let source = ImageEditPart {
            bytes: vec![1, 2, 3],
            file_name: "a.png".into(),
            mime_type: "image/png".into(),
        };
        let edit = build_request_body("m", "hat", &[source], &options("auto", "high", "png"));
        assert!(edit["response_format"].get("aspect_ratio").is_none());
        assert_eq!(edit["response_format"]["image_size"], "2K");
        assert_eq!(edit["input"][1]["type"], "image");
        assert_eq!(edit["input"][1]["data"], "AQID");
    }

    #[test]
    fn decodes_the_image_block_from_model_output() {
        let parsed = json!({
            "status": "completed",
            "steps": [
                { "type": "thought", "signature": "x" },
                { "type": "model_output", "content": [
                    { "type": "image", "mime_type": "image/jpeg", "data": "AQID" }
                ] }
            ]
        });
        assert_eq!(decode_image_response(&parsed).unwrap(), vec![1, 2, 3]);
        assert!(decode_image_response(&json!({ "status": "failed" }))
            .unwrap_err()
            .contains("failed"));
    }

    #[test]
    fn converts_format_and_fits_custom_sizes() {
        let mut jpeg = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(64, 48)
            .write_to(&mut jpeg, ImageFormat::Jpeg)
            .unwrap();
        let jpeg = jpeg.into_inner();

        let passthrough = fit_output(jpeg.clone(), &options("1024x1024", "low", "jpeg")).unwrap();
        assert_eq!(passthrough, jpeg);

        let png = fit_output(jpeg.clone(), &options("1024x1024", "low", "png")).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!(image::guess_format(&png).unwrap(), ImageFormat::Png);
        assert_eq!((decoded.width(), decoded.height()), (64, 48));

        let custom = fit_output(jpeg, &options("32x16", "low", "webp")).unwrap();
        let decoded = image::load_from_memory(&custom).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (32, 16));
    }
}
