pub mod fs_tools;
pub mod git;
pub mod scope;
pub mod self_repo;
pub mod shell;

use serde_json::{json, Value};

use self::scope::{is_coding_tool_name, is_gated_coding_tool, CodingScope, CodingScopeMeta};
use self::self_repo::{build_self_scope, self_scope_available, self_scope_conventions_text};

pub use self::scope::{
    coding_tool_definitions, merge_tool_definitions, CodingScopeKind,
};
pub use self::self_repo::detect_harness_repo_root;

pub fn coding_tool_name_is(name: &str) -> bool {
    is_coding_tool_name(name)
}

pub fn coding_tool_is_gated(name: &str, args: &Value) -> bool {
    if name == "run_command" {
        return shell::needs_gate_for_run_command(args);
    }
    is_gated_coding_tool(name)
}

pub fn coding_gated_preview(scope: &CodingScope, name: &str, args: &Value) -> Value {
    fs_tools::gated_preview_payload(scope, name, args)
}

pub async fn execute_coding_tool(scope: &CodingScope, name: &str, args: Value) -> String {
    // Self-scope mutations refuse main/master.
    if matches!(name, "ws_edit" | "ws_write" | "ws_delete")
        && scope.kind == CodingScopeKind::SelfRepo
    {
        if let Some(block) = git::refuse_mutation_on_protected_branch(scope).await {
            return block;
        }
    }

    match name {
        "ws_list_tree" | "ws_search" | "ws_read" | "ws_edit" | "ws_write" | "ws_delete" => {
            fs_tools::execute_coding_fs_tool(scope, name, &args)
        }
        "run_command" => shell::run_command(scope, &args).await,
        "git_status" | "git_diff" | "git_checkout_branch" => {
            git::execute_git_tool(scope, name, &args).await
        }
        _ => json!({ "error": format!("Unknown coding tool: {name}") }).to_string(),
    }
}

pub fn build_coding_scope_prompt_block(scope: &CodingScope) -> String {
    if scope.kind == CodingScopeKind::SelfRepo {
        let mut block = self_scope_conventions_text();
        block.push_str(&format!(
            "\nRoot: {}\nAllow globs:\n{}",
            scope.root.display(),
            scope
                .allow_patterns()
                .iter()
                .map(|p| format!("- {p}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
        return block;
    }

    let tree = top_level_names(&scope.root);
    let stack = detect_stack(&scope.root);
    format!(
        "[CODING_SCOPE]\nKind: project folder\nRoot: {}\nDetected stack: {}\nTop-level:\n{}\n\
Paths for coding tools are relative to this root. Stay inside the scope.\n\
Read before edit; prefer ws_edit with a unique old_string; keep diffs small.\n\
Use git_status / git_diff; run allowlisted verify commands when useful.",
        scope.root.display(),
        stack,
        tree
    )
}

fn top_level_names(root: &std::path::Path) -> String {
    let Ok(entries) = std::fs::read_dir(root) else {
        return "(unreadable)".into();
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                format!("{name}/")
            } else {
                name
            }
        })
        .filter(|n| {
            !matches!(
                n.as_str(),
                ".git/" | "node_modules/" | "target/" | "dist/" | "dist-web/" | ".DS_Store"
            )
        })
        .collect();
    names.sort();
    names.truncate(40);
    if names.is_empty() {
        "(empty)".into()
    } else {
        names
            .into_iter()
            .map(|n| format!("- {n}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn detect_stack(root: &std::path::Path) -> String {
    let mut parts = Vec::new();
    if root.join("package.json").is_file() {
        parts.push("node/npm");
    }
    if root.join("Cargo.toml").is_file() || root.join("src-tauri/Cargo.toml").is_file() {
        parts.push("rust/cargo");
    }
    if root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() {
        parts.push("python");
    }
    if parts.is_empty() {
        "unknown".into()
    } else {
        parts.join(", ")
    }
}

pub fn pick_project_scope_from_path(path: std::path::PathBuf) -> Result<CodingScope, String> {
    CodingScope::project(path)
}

pub fn use_self_scope() -> Result<CodingScope, String> {
    build_self_scope()
}

pub fn self_available() -> bool {
    self_scope_available()
}

pub fn meta_from_scope(scope: &CodingScope) -> CodingScopeMeta {
    scope.to_meta()
}

pub fn scope_from_meta(meta: &CodingScopeMeta) -> Result<CodingScope, String> {
    CodingScope::from_meta(meta)
}
