use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;

use crate::paths::get_user_data_dir;

const MAX_FILE_SIZE: u64 = 1024 * 1024;

pub fn get_allowed_roots() -> Vec<PathBuf> {
    let mut roots = vec![get_user_data_dir()];
    if let Some(home) = dirs::home_dir() {
        roots.push(home);
    }
    if let Some(desktop) = dirs::desktop_dir() {
        roots.push(desktop);
    }
    roots
}

pub fn is_path_allowed(file_path: &Path, allowed_roots: &[PathBuf]) -> bool {
    let resolved = file_path.canonicalize().unwrap_or_else(|_| file_path.to_path_buf());
    allowed_roots.iter().any(|root| {
        let root_resolved = root.canonicalize().unwrap_or_else(|_| root.clone());
        resolved == root_resolved || resolved.starts_with(&root_resolved)
    })
}

fn resolve_input_path(path_arg: &str) -> PathBuf {
    let path = PathBuf::from(path_arg);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    }
}

fn resolved_allowed_path(path_arg: &str) -> PathBuf {
    let resolved = resolve_input_path(path_arg);
    if resolved.exists() {
        resolved.canonicalize().unwrap_or(resolved)
    } else {
        resolved
    }
}

fn is_path_allowed_for_app(file_path: &Path) -> bool {
    is_path_allowed(file_path, &get_allowed_roots())
}

fn list_directory(path_arg: &str) -> String {
    let resolved = resolved_allowed_path(path_arg);
    if !is_path_allowed_for_app(&resolved) {
        return serde_json::to_string(&json!({ "error": "Path not under allowed roots" }))
            .unwrap_or_else(|_| "{\"error\":\"Path not under allowed roots\"}".into());
    }
    if !resolved.exists() {
        return serde_json::to_string(&json!({ "error": "Path does not exist" }))
            .unwrap_or_else(|_| "{\"error\":\"Path does not exist\"}".into());
    }
    let Ok(meta) = fs::metadata(&resolved) else {
        return serde_json::to_string(&json!({ "error": "Failed to read path metadata" }))
            .unwrap_or_else(|_| "{\"error\":\"Failed to read path metadata\"}".into());
    };
    if !meta.is_dir() {
        return serde_json::to_string(&json!({ "error": "Not a directory" }))
            .unwrap_or_else(|_| "{\"error\":\"Not a directory\"}".into());
    }
    match fs::read_dir(&resolved) {
        Ok(entries) => {
            let items: Vec<_> = entries
                .filter_map(|e| e.ok())
                .map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let kind = if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        "dir"
                    } else {
                        "file"
                    };
                    json!({ "name": name, "type": kind })
                })
                .collect();
            serde_json::to_string(&items).unwrap_or_else(|_| "[]".into())
        }
        Err(err) => serde_json::to_string(&json!({ "error": err.to_string() }))
            .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", err)),
    }
}

fn read_file(path_arg: &str) -> String {
    let resolved = resolved_allowed_path(path_arg);
    if !is_path_allowed_for_app(&resolved) {
        return serde_json::to_string(&json!({ "error": "Path not under allowed roots" }))
            .unwrap_or_else(|_| "{\"error\":\"Path not under allowed roots\"}".into());
    }
    if !resolved.exists() {
        return serde_json::to_string(&json!({ "error": "File does not exist" }))
            .unwrap_or_else(|_| "{\"error\":\"File does not exist\"}".into());
    }
    let Ok(meta) = fs::metadata(&resolved) else {
        return serde_json::to_string(&json!({ "error": "Failed to read file metadata" }))
            .unwrap_or_else(|_| "{\"error\":\"Failed to read file metadata\"}".into());
    };
    if meta.is_dir() {
        return serde_json::to_string(&json!({ "error": "Is a directory" }))
            .unwrap_or_else(|_| "{\"error\":\"Is a directory\"}".into());
    }
    if meta.len() > MAX_FILE_SIZE {
        return serde_json::to_string(&json!({ "error": "File too large (max 1MB)" }))
            .unwrap_or_else(|_| "{\"error\":\"File too large (max 1MB)\"}".into());
    }
    match fs::read_to_string(&resolved) {
        Ok(content) => serde_json::to_string(&json!({ "content": content }))
            .unwrap_or_else(|_| "{\"content\":\"\"}".into()),
        Err(err) => serde_json::to_string(&json!({ "error": err.to_string() }))
            .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", err)),
    }
}

fn write_file(path_arg: &str, content: &str) -> String {
    let resolved = resolved_allowed_path(path_arg);
    if !is_path_allowed_for_app(&resolved) {
        return serde_json::to_string(&json!({ "error": "Path not under allowed roots" }))
            .unwrap_or_else(|_| "{\"error\":\"Path not under allowed roots\"}".into());
    }
    match fs::write(&resolved, content) {
        Ok(()) => serde_json::to_string(&json!({ "ok": true })).unwrap_or_else(|_| "{\"ok\":true}".into()),
        Err(err) => serde_json::to_string(&json!({ "error": err.to_string() }))
            .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", err)),
    }
}

fn delete_file(path_arg: &str) -> String {
    let resolved = resolved_allowed_path(path_arg);
    if !is_path_allowed_for_app(&resolved) {
        return serde_json::to_string(&json!({ "error": "Path not under allowed roots" }))
            .unwrap_or_else(|_| "{\"error\":\"Path not under allowed roots\"}".into());
    }
    if !resolved.exists() {
        return serde_json::to_string(&json!({ "error": "Path does not exist" }))
            .unwrap_or_else(|_| "{\"error\":\"Path does not exist\"}".into());
    }
    let Ok(meta) = fs::metadata(&resolved) else {
        return serde_json::to_string(&json!({ "error": "Failed to read path metadata" }))
            .unwrap_or_else(|_| "{\"error\":\"Failed to read path metadata\"}".into());
    };
    if meta.is_dir() {
        return serde_json::to_string(&json!({ "error": "Call delete_directory for directories" }))
            .unwrap_or_else(|_| "{\"error\":\"Call delete_directory for directories\"}".into());
    }
    match fs::remove_file(&resolved) {
        Ok(()) => serde_json::to_string(&json!({ "ok": true })).unwrap_or_else(|_| "{\"ok\":true}".into()),
        Err(err) => serde_json::to_string(&json!({ "error": err.to_string() }))
            .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", err)),
    }
}

fn create_directory(path_arg: &str) -> String {
    let resolved = resolved_allowed_path(path_arg);
    if !is_path_allowed_for_app(&resolved) {
        return serde_json::to_string(&json!({ "error": "Path not under allowed roots" }))
            .unwrap_or_else(|_| "{\"error\":\"Path not under allowed roots\"}".into());
    }
    if resolved.exists() {
        return serde_json::to_string(&json!({ "error": "Already exists" }))
            .unwrap_or_else(|_| "{\"error\":\"Already exists\"}".into());
    }
    match fs::create_dir_all(&resolved) {
        Ok(()) => serde_json::to_string(&json!({ "ok": true })).unwrap_or_else(|_| "{\"ok\":true}".into()),
        Err(err) => serde_json::to_string(&json!({ "error": err.to_string() }))
            .unwrap_or_else(|_| format!("{{\"error\":\"{}\"}}", err)),
    }
}

pub fn execute_file_tool(name: &str, args: &serde_json::Value) -> String {
    match name {
        "list_directory" => list_directory(args.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "read_file" => read_file(args.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "write_file" => write_file(
            args.get("path").and_then(|v| v.as_str()).unwrap_or(""),
            args.get("content").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        "delete_file" => delete_file(args.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        "create_directory" => create_directory(args.get("path").and_then(|v| v.as_str()).unwrap_or("")),
        _ => serde_json::to_string(&json!({ "error": format!("Unknown tool: {name}") }))
            .unwrap_or_else(|_| format!("{{\"error\":\"Unknown tool: {name}\"}}")),
    }
}
