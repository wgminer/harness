//! Size, format, and MIME helpers for stored image files.

use super::*;

pub(super) fn size_from_legacy_aspect(aspect: &str) -> &'static str {
    match aspect {
        "square" => "1024x1024",
        "landscape" => "1536x1024",
        "portrait" => "1024x1536",
        _ => "auto",
    }
}

pub(super) fn normalize_size(raw: &str) -> Result<String, String> {
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

pub(super) fn resolve_stored_size(obj: &serde_json::Map<String, serde_json::Value>) -> String {
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

pub(super) fn background_allowed_for_format(output_format: &str, background: &str) -> &'static str {
    if output_format == "jpeg" && background == "transparent" {
        return "opaque";
    }
    match background {
        "opaque" => "opaque",
        "transparent" => "transparent",
        _ => "auto",
    }
}

pub(super) fn ext_for_format(output_format: &str) -> &'static str {
    match output_format {
        "jpeg" => "jpeg",
        "webp" => "webp",
        _ => "png",
    }
}

pub(super) fn mime_for_file_name(file_name: &str) -> &'static str {
    match output_format_from_file_name(file_name) {
        "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => "image/png",
    }
}

pub(super) fn output_format_from_file_name(file_name: &str) -> &'static str {
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
