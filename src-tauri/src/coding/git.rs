use serde_json::{json, Value};
use tokio::process::Command;

use super::scope::CodingScope;
use super::shell::run_command;

pub async fn execute_git_tool(scope: &CodingScope, name: &str, args: &Value) -> String {
    match name {
        "git_status" => {
            run_command(
                scope,
                &json!({ "command": "git status --short --branch" }),
            )
            .await
        }
        "git_diff" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let command = if path.is_empty() {
                "git diff --no-color".to_string()
            } else if path.contains("..") || path.starts_with('/') {
                return json!({ "error": "Invalid path" }).to_string();
            } else {
                format!("git diff --no-color -- {path}")
            };
            run_command(scope, &json!({ "command": command })).await
        }
        "git_checkout_branch" => checkout_branch(scope, args).await,
        _ => json!({ "error": format!("Unknown git tool: {name}") }).to_string(),
    }
}

pub async fn current_branch(scope: &CodingScope) -> Result<String, String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&scope.root)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn is_protected_branch(branch: &str) -> bool {
    matches!(branch, "main" | "master")
}

async fn checkout_branch(scope: &CodingScope, args: &Value) -> String {
    let branch = args
        .get("branch")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if branch.is_empty() {
        return json!({ "error": "branch is required" }).to_string();
    }
    if branch.contains("..")
        || branch.contains('/') && branch.starts_with('-')
        || branch.chars().any(|c| c.is_whitespace())
    {
        // Keep branch names simple; still allow feature/foo style.
        if branch.chars().any(|c| c.is_whitespace() || c == ';' || c == '|' || c == '&') {
            return json!({ "error": "Invalid branch name" }).to_string();
        }
    }
    if is_protected_branch(&branch) {
        return json!({ "error": "Refusing to checkout protected branch main/master via tool" })
            .to_string();
    }

    let create = args
        .get("create")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let exists = Command::new("git")
        .args(["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")])
        .current_dir(&scope.root)
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false);

    let mut cmd = Command::new("git");
    cmd.current_dir(&scope.root);
    if !exists && create {
        cmd.args(["checkout", "-b", &branch]);
    } else {
        cmd.args(["checkout", &branch]);
    }
    match cmd.output().await {
        Ok(out) => json!({
            "ok": out.status.success(),
            "branch": branch,
            "stdout": String::from_utf8_lossy(&out.stdout).trim(),
            "stderr": String::from_utf8_lossy(&out.stderr).trim(),
            "exitCode": out.status.code()
        })
        .to_string(),
        Err(e) => json!({ "error": e.to_string() }).to_string(),
    }
}

/// Returns an error JSON string if mutating on a protected branch should be blocked.
pub async fn refuse_mutation_on_protected_branch(scope: &CodingScope) -> Option<String> {
    match current_branch(scope).await {
        Ok(branch) if is_protected_branch(&branch) => Some(
            json!({
                "error": format!(
                    "Refusing to mutate files on protected branch `{branch}`. Call git_checkout_branch first."
                ),
                "branch": branch
            })
            .to_string(),
        ),
        _ => None,
    }
}
