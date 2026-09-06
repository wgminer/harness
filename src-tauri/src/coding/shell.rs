use std::process::Stdio;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::Command;
use tokio::time::timeout;

use super::scope::CodingScope;

const OUTPUT_CAP: usize = 20 * 1024;
const COMMAND_TIMEOUT_SECS: u64 = 120;

/// Exact-prefix allowlist for auto-run (no user gate).
const AUTO_RUN_PREFIXES: &[&str] = &[
    "git status",
    "git diff",
    "git log",
    "npm run typecheck",
    "npx eslint",
    "npx tsc --noEmit",
    "cargo check",
];

pub fn is_command_allowlisted(command: &str) -> bool {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return false;
    }
    if contains_control_chars(trimmed) {
        return false;
    }
    // Reject shell chaining / redirection for auto-run safety.
    if trimmed.contains('|')
        || trimmed.contains(';')
        || trimmed.contains('&')
        || trimmed.contains('>')
        || trimmed.contains('<')
        || trimmed.contains('`')
        || trimmed.contains('$')
    {
        return false;
    }
    AUTO_RUN_PREFIXES
        .iter()
        .any(|prefix| trimmed == *prefix || trimmed.starts_with(&format!("{prefix} ")))
}

fn contains_control_chars(command: &str) -> bool {
    command.chars().any(|c| c == '\n' || c == '\r' || c == '\0')
}

pub fn needs_gate_for_run_command(args: &Value) -> bool {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    !is_command_allowlisted(command)
}

pub async fn run_command(scope: &CodingScope, args: &Value) -> String {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if command.is_empty() {
        return json!({ "error": "command is required" }).to_string();
    }
    execute_shell(scope, &command).await
}

async fn execute_shell(scope: &CodingScope, command: &str) -> String {
    let mut cmd = Command::new("sh");
    cmd.arg("-lc")
        .arg(command)
        .current_dir(&scope.root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    // Scrub common secret env vars from the child.
    for key in [
        "OPENAI_API_KEY",
        "VITE_OPENAI_API_KEY",
        "TAVILY_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
        "R2_SECRET_ACCESS_KEY",
    ] {
        cmd.env_remove(key);
    }

    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return json!({ "error": format!("Failed to spawn: {e}") }).to_string(),
    };

    let output = match timeout(
        Duration::from_secs(COMMAND_TIMEOUT_SECS),
        child.wait_with_output(),
    )
    .await
    {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => return json!({ "error": format!("Command failed: {e}") }).to_string(),
        Err(_) => {
            return json!({
                "error": format!("Command timed out after {COMMAND_TIMEOUT_SECS}s"),
                "command": command
            })
            .to_string()
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    json!({
        "command": command,
        "exitCode": output.status.code(),
        "stdout": cap_tail(&stdout, OUTPUT_CAP),
        "stderr": cap_tail(&stderr, OUTPUT_CAP),
        "cwd": scope.root.display().to_string()
    })
    .to_string()
}

fn cap_tail(text: &str, max: usize) -> String {
    let bytes = text.as_bytes();
    if bytes.len() <= max {
        return text.to_string();
    }
    let start = bytes.len() - max;
    // Align to char boundary.
    let mut idx = start;
    while idx < bytes.len() && !text.is_char_boundary(idx) {
        idx += 1;
    }
    format!("…(truncated)\n{}", &text[idx..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlists_typecheck_and_git_status() {
        assert!(is_command_allowlisted("git status"));
        assert!(is_command_allowlisted("git status -sb"));
        assert!(is_command_allowlisted("npm run typecheck"));
        assert!(is_command_allowlisted("npx eslint src/renderer/App.tsx"));
        assert!(!is_command_allowlisted("ls"));
        assert!(!is_command_allowlisted("rg TODO src"));
        assert!(!is_command_allowlisted("npm test"));
        assert!(!is_command_allowlisted("git status\ncat /etc/passwd"));
        assert!(!is_command_allowlisted("git status; rm -rf /"));
        assert!(!is_command_allowlisted("git diff | cat"));
    }
}
