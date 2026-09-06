use std::path::PathBuf;

use crate::env_util::is_harness_dev;

use super::scope::{canonicalize_existing_dir, CodingScope};

/// Compile-time crate dir is `…/src-tauri`; repo root is its parent.
fn compiled_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")))
}

pub fn detect_harness_repo_root() -> Option<PathBuf> {
    if !is_harness_dev() {
        return None;
    }
    let root = compiled_repo_root();
    let ok = root.join("package.json").is_file()
        && root.join("src/renderer/index.html").is_file()
        && root.join("src-tauri").is_dir();
    if !ok {
        return None;
    }
    canonicalize_existing_dir(&root).ok()
}

pub fn self_scope_available() -> bool {
    detect_harness_repo_root().is_some()
}

pub fn build_self_scope() -> Result<CodingScope, String> {
    let root = detect_harness_repo_root()
        .ok_or_else(|| "Harness UI self-scope is only available in Harness Dev with a detectable repo root".to_string())?;
    CodingScope::self_repo(root)
}

pub fn self_scope_conventions_text() -> String {
    let aspects = super::scope::self_aspect_names().join(", ");
    format!(
        "[CODING_SCOPE]\nKind: Harness self (renderer UI)\nAllowed aspects: {aspects}\n\
Allowed paths: src/renderer/**/*.tsx, src/renderer/**/*.css, src/renderer/index.html only.\n\
Do not edit .ts helpers, src/shared, src-tauri, resources/contracts, or ios — if a change needs them, stop and tell the user.\n\
Prefer existing CSS variables (radius tokens in base.css). Use product terms from the glossary.\n\
Renderer edits hot-reload via Vite — describe what changed and ask the user to look at the running app.\n\
Before mutating files, check git_status; if on main/master, call git_checkout_branch first.\n\
Verify with allowlisted npm run typecheck / npx eslint when useful."
    )
}
