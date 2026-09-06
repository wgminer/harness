use std::fs;
use std::path::Path;

use regex::Regex;
use serde_json::{json, Value};

use super::scope::CodingScope;

const MAX_FILE_SIZE: u64 = 1024 * 1024;
const MAX_SEARCH_FILE_SIZE: u64 = 256 * 1024;

fn err_json(msg: impl Into<String>) -> String {
    json!({ "error": msg.into() }).to_string()
}

fn ok_json(value: Value) -> String {
    value.to_string()
}

fn arg_str(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn arg_usize(args: &Value, key: &str, default: usize) -> usize {
    args.get(key)
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(default)
}

pub fn execute_coding_fs_tool(scope: &CodingScope, name: &str, args: &Value) -> String {
    match name {
        "ws_list_tree" => list_tree(scope, args),
        "ws_search" => search(scope, args),
        "ws_read" => read(scope, args),
        "ws_edit" => edit(scope, args),
        "ws_write" => write(scope, args),
        "ws_delete" => delete(scope, args),
        _ => err_json(format!("Unknown coding fs tool: {name}")),
    }
}

/// Build a pending preview payload for gated mutating tools (before execution).
pub fn gated_preview_payload(scope: &CodingScope, name: &str, args: &Value) -> Value {
    let path = arg_str(args, "path");
    match name {
        "ws_edit" => {
            let old = arg_str(args, "old_string");
            let new = arg_str(args, "new_string");
            let preview = match read_for_edit_preview(scope, &path, &old, &new) {
                Ok(diff) => diff,
                Err(e) => format!("(preview unavailable: {e})"),
            };
            json!({
                "pending": true,
                "tool": name,
                "args": args,
                "path": path,
                "preview": preview,
                "previewKind": "diff"
            })
        }
        "ws_write" => {
            let content = arg_str(args, "content");
            let preview = if content.len() > 4000 {
                format!("{}\n… (truncated)", &content[..4000])
            } else {
                content
            };
            json!({
                "pending": true,
                "tool": name,
                "args": args,
                "path": path,
                "preview": preview,
                "previewKind": "write"
            })
        }
        "ws_delete" => json!({
            "pending": true,
            "tool": name,
            "args": args,
            "path": path,
            "preview": format!("Delete {path}"),
            "previewKind": "delete"
        }),
        "git_checkout_branch" => {
            let branch = arg_str(args, "branch");
            json!({
                "pending": true,
                "tool": name,
                "args": args,
                "preview": format!("Checkout branch `{branch}`"),
                "previewKind": "command"
            })
        }
        "run_command" => {
            let command = arg_str(args, "command");
            json!({
                "pending": true,
                "tool": name,
                "args": args,
                "preview": command,
                "previewKind": "command"
            })
        }
        _ => json!({
            "pending": true,
            "tool": name,
            "args": args
        }),
    }
}

fn read_for_edit_preview(
    scope: &CodingScope,
    path: &str,
    old: &str,
    new: &str,
) -> Result<String, String> {
    let absolute = scope.resolve_relative(path)?;
    ensure_allowed_file(scope, &absolute)?;
    let content = fs::read_to_string(&absolute).map_err(|e| e.to_string())?;
    let count = content.matches(old).count();
    if count == 0 {
        return Err("old_string not found".into());
    }
    if count > 1 {
        return Err(format!("old_string appears {count} times (must be unique)"));
    }
    Ok(format!(
        "--- a/{path}\n+++ b/{path}\n@@\n-{}\n+{}",
        old.replace('\n', "\n-"),
        new.replace('\n', "\n+")
    ))
}

fn ensure_allowed_file(scope: &CodingScope, absolute: &Path) -> Result<(), String> {
    if !scope.is_path_allowed(absolute, false) {
        return Err("Path not allowed in the current coding scope".into());
    }
    Ok(())
}

fn ensure_allowed_dir(scope: &CodingScope, absolute: &Path) -> Result<(), String> {
    if !scope.is_path_allowed(absolute, true) {
        return Err("Path not allowed in the current coding scope".into());
    }
    Ok(())
}

fn list_tree(scope: &CodingScope, args: &Value) -> String {
    let rel = arg_str(args, "path");
    let depth = arg_usize(args, "depth", 2).clamp(0, 4);
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if let Err(e) = ensure_allowed_dir(scope, &absolute) {
        return err_json(e);
    }
    if !absolute.exists() {
        return err_json("Path does not exist");
    }
    let Ok(meta) = fs::metadata(&absolute) else {
        return err_json("Failed to read path metadata");
    };
    if !meta.is_dir() {
        return err_json("Not a directory");
    }
    let mut items = Vec::new();
    walk_tree(scope, &absolute, 0, depth, &mut items);
    ok_json(json!({ "path": scope.relative_display(&absolute), "items": items }))
}

fn walk_tree(
    scope: &CodingScope,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<Value>,
) {
    if depth > max_depth {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !scope.is_path_allowed(&path, is_dir) {
            continue;
        }
        let rel = scope.relative_display(&path);
        out.push(json!({
            "path": rel,
            "type": if is_dir { "dir" } else { "file" },
            "depth": depth
        }));
        if is_dir && depth < max_depth {
            walk_tree(scope, &path, depth + 1, max_depth, out);
        }
    }
}

fn search(scope: &CodingScope, args: &Value) -> String {
    let pattern = arg_str(args, "pattern");
    if pattern.is_empty() {
        return err_json("pattern is required");
    }
    let re = match Regex::new(&pattern) {
        Ok(r) => r,
        Err(e) => return err_json(format!("Invalid regex: {e}")),
    };
    let rel = arg_str(args, "path");
    let max_matches = arg_usize(args, "max_matches", 40).clamp(1, 100);
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if !absolute.exists() {
        return err_json("Path does not exist");
    }
    let mut matches = Vec::new();
    let mut files_scanned = 0usize;
    search_walk(
        scope,
        &absolute,
        &re,
        max_matches,
        &mut matches,
        &mut files_scanned,
    );
    ok_json(json!({
        "matches": matches,
        "filesScanned": files_scanned,
        "truncated": matches.len() >= max_matches
    }))
}

fn search_walk(
    scope: &CodingScope,
    path: &Path,
    re: &Regex,
    max_matches: usize,
    matches: &mut Vec<Value>,
    files_scanned: &mut usize,
) {
    if matches.len() >= max_matches {
        return;
    }
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    if meta.is_dir() {
        if !scope.is_path_allowed(path, true) {
            return;
        }
        let Ok(entries) = fs::read_dir(path) else {
            return;
        };
        for entry in entries.filter_map(|e| e.ok()) {
            search_walk(scope, &entry.path(), re, max_matches, matches, files_scanned);
            if matches.len() >= max_matches {
                return;
            }
        }
        return;
    }
    if !scope.is_path_allowed(path, false) {
        return;
    }
    if meta.len() > MAX_SEARCH_FILE_SIZE {
        return;
    }
    let Ok(content) = fs::read_to_string(path) else {
        return;
    };
    *files_scanned += 1;
    for (idx, line) in content.lines().enumerate() {
        if re.is_match(line) {
            matches.push(json!({
                "path": scope.relative_display(path),
                "line": idx + 1,
                "text": truncate_str(line, 200)
            }));
            if matches.len() >= max_matches {
                return;
            }
        }
    }
}

fn truncate_str(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max).collect();
        format!("{truncated}…")
    }
}

fn read(scope: &CodingScope, args: &Value) -> String {
    let rel = arg_str(args, "path");
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if let Err(e) = ensure_allowed_file(scope, &absolute) {
        return err_json(e);
    }
    if !absolute.exists() {
        return err_json("File does not exist");
    }
    let Ok(meta) = fs::metadata(&absolute) else {
        return err_json("Failed to read file metadata");
    };
    if meta.is_dir() {
        return err_json("Is a directory");
    }
    if meta.len() > MAX_FILE_SIZE {
        return err_json("File too large (max 1MB)");
    }
    let content = match fs::read_to_string(&absolute) {
        Ok(c) => c,
        Err(e) => return err_json(e.to_string()),
    };
    let start = args
        .get("start_line")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let end = args
        .get("end_line")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize);
    let lines: Vec<&str> = content.lines().collect();
    let total = lines.len();
    let (slice_start, slice_end, sliced) = if start.is_some() || end.is_some() {
        let s = start.unwrap_or(1).saturating_sub(1).min(total);
        let e = end.unwrap_or(total).min(total);
        let e = e.max(s);
        (s + 1, e, lines[s..e].join("\n"))
    } else {
        (1, total, content)
    };
    ok_json(json!({
        "path": scope.relative_display(&absolute),
        "content": sliced,
        "startLine": slice_start,
        "endLine": slice_end,
        "totalLines": total
    }))
}

pub fn edit(scope: &CodingScope, args: &Value) -> String {
    let rel = arg_str(args, "path");
    let old = arg_str(args, "old_string");
    let new = arg_str(args, "new_string");
    if old.is_empty() {
        return err_json("old_string is required");
    }
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if let Err(e) = ensure_allowed_file(scope, &absolute) {
        return err_json(e);
    }
    if !absolute.exists() {
        return err_json("File does not exist");
    }
    let content = match fs::read_to_string(&absolute) {
        Ok(c) => c,
        Err(e) => return err_json(e.to_string()),
    };
    let count = content.matches(&old).count();
    if count == 0 {
        return err_json("old_string not found");
    }
    if count > 1 {
        return err_json(format!(
            "old_string appears {count} times; must be unique"
        ));
    }
    let updated = content.replacen(&old, &new, 1);
    match fs::write(&absolute, updated) {
        Ok(()) => ok_json(json!({
            "ok": true,
            "path": scope.relative_display(&absolute)
        })),
        Err(e) => err_json(e.to_string()),
    }
}

pub fn write(scope: &CodingScope, args: &Value) -> String {
    let rel = arg_str(args, "path");
    let content = arg_str(args, "content");
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if let Err(e) = ensure_allowed_file(scope, &absolute) {
        return err_json(e);
    }
    if let Some(parent) = absolute.parent() {
        if parent != scope.root.as_path() && !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return err_json(e.to_string());
            }
        }
        // Parent dirs must be within root (already ensured by resolve_relative).
    }
    match fs::write(&absolute, content) {
        Ok(()) => ok_json(json!({
            "ok": true,
            "path": scope.relative_display(&absolute)
        })),
        Err(e) => err_json(e.to_string()),
    }
}

pub fn delete(scope: &CodingScope, args: &Value) -> String {
    let rel = arg_str(args, "path");
    let absolute = match scope.resolve_relative(&rel) {
        Ok(p) => p,
        Err(e) => return err_json(e),
    };
    if let Err(e) = ensure_allowed_file(scope, &absolute) {
        return err_json(e);
    }
    if !absolute.exists() {
        return err_json("Path does not exist");
    }
    let Ok(meta) = fs::metadata(&absolute) else {
        return err_json("Failed to read path metadata");
    };
    if meta.is_dir() {
        return err_json("Refusing to delete directories");
    }
    match fs::remove_file(&absolute) {
        Ok(()) => ok_json(json!({
            "ok": true,
            "path": scope.relative_display(&absolute)
        })),
        Err(e) => err_json(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::coding::scope::CodingScope;
    use tempfile::tempdir;

    #[test]
    fn ws_edit_requires_unique_old_string() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::write(root.join("a.txt"), "foo bar foo").unwrap();
        let scope = CodingScope::project(root).unwrap();
        let result = edit(
            &scope,
            &json!({
                "path": "a.txt",
                "old_string": "foo",
                "new_string": "baz"
            }),
        );
        assert!(result.contains("appears 2 times"), "{result}");
    }

    #[test]
    fn ws_edit_replaces_unique_string() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::write(root.join("a.txt"), "hello world").unwrap();
        let scope = CodingScope::project(root.clone()).unwrap();
        let result = edit(
            &scope,
            &json!({
                "path": "a.txt",
                "old_string": "world",
                "new_string": "there"
            }),
        );
        assert!(result.contains("\"ok\":true"), "{result}");
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "hello there");
    }
}
