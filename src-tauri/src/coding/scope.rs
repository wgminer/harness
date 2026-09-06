use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const SELF_MODIFY_SCOPES_JSON: &str =
    include_str!("../../../resources/contracts/selfModifyScopes.json");

const PROJECT_DENY_GLOBS: &[&str] = &[
    "**/.git/**",
    "**/.git",
    "**/node_modules/**",
    "**/node_modules",
    "**/target/**",
    "**/target",
    "**/dist/**",
    "**/dist",
    "**/dist-web/**",
    "**/dist-web",
    "**/.DS_Store",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CodingScopeKind {
    Project,
    SelfRepo,
}

impl CodingScopeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::SelfRepo => "self",
        }
    }

    pub fn parse(raw: Option<&str>) -> Option<Self> {
        match raw.map(str::trim).unwrap_or("") {
            "project" => Some(Self::Project),
            "self" | "selfRepo" => Some(Self::SelfRepo),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingScopeMeta {
    pub kind: String,
    pub root: String,
}

#[derive(Debug, Clone)]
pub struct CodingScope {
    pub kind: CodingScopeKind,
    pub root: PathBuf,
    allow: GlobSet,
    deny: GlobSet,
    allow_patterns: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SelfModifyContract {
    aspects: std::collections::BTreeMap<String, Vec<String>>,
}

fn self_modify_contract() -> &'static SelfModifyContract {
    static CONTRACT: OnceLock<SelfModifyContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(SELF_MODIFY_SCOPES_JSON)
            .expect("resources/contracts/selfModifyScopes.json must parse")
    })
}

fn build_globset(patterns: &[String]) -> Result<GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = Glob::new(pattern).map_err(|e| format!("Invalid glob `{pattern}`: {e}"))?;
        builder.add(glob);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build glob set: {e}"))
}

fn project_deny_patterns() -> Vec<String> {
    PROJECT_DENY_GLOBS.iter().map(|s| (*s).to_string()).collect()
}

pub fn self_aspect_patterns() -> Vec<String> {
    let contract = self_modify_contract();
    let mut out = Vec::new();
    for patterns in contract.aspects.values() {
        out.extend(patterns.iter().cloned());
    }
    out
}

pub fn self_aspect_names() -> Vec<String> {
    self_modify_contract().aspects.keys().cloned().collect()
}

impl CodingScope {
    pub fn project(root: PathBuf) -> Result<Self, String> {
        let root = canonicalize_existing_dir(&root)?;
        let allow = build_globset(&["**".to_string()])?;
        let deny = build_globset(&project_deny_patterns())?;
        Ok(Self {
            kind: CodingScopeKind::Project,
            root,
            allow,
            deny,
            allow_patterns: vec!["**".into()],
        })
    }

    pub fn self_repo(root: PathBuf) -> Result<Self, String> {
        let root = canonicalize_existing_dir(&root)?;
        let allow_patterns = self_aspect_patterns();
        if allow_patterns.is_empty() {
            return Err("selfModifyScopes.json has no aspect globs".into());
        }
        let allow = build_globset(&allow_patterns)?;
        let deny = build_globset(&project_deny_patterns())?;
        Ok(Self {
            kind: CodingScopeKind::SelfRepo,
            root,
            allow,
            deny,
            allow_patterns,
        })
    }

    pub fn from_meta(meta: &CodingScopeMeta) -> Result<Self, String> {
        let kind = CodingScopeKind::parse(Some(&meta.kind))
            .ok_or_else(|| format!("Unknown coding scope kind: {}", meta.kind))?;
        let root = PathBuf::from(&meta.root);
        match kind {
            CodingScopeKind::Project => Self::project(root),
            CodingScopeKind::SelfRepo => Self::self_repo(root),
        }
    }

    pub fn to_meta(&self) -> CodingScopeMeta {
        CodingScopeMeta {
            kind: self.kind.as_str().to_string(),
            root: self.root.display().to_string(),
        }
    }

    pub fn allow_patterns(&self) -> &[String] {
        &self.allow_patterns
    }

    pub fn resolve_relative(&self, relative: &str) -> Result<PathBuf, String> {
        let relative = relative.trim();
        let rel = if relative.is_empty() || relative == "." {
            PathBuf::new()
        } else {
            PathBuf::from(relative)
        };
        if rel.is_absolute() {
            return Err("Path must be relative to the coding scope root".into());
        }
        if rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err("Path must not contain `..`".into());
        }
        Ok(self.root.join(rel))
    }

    pub fn relative_display(&self, absolute: &Path) -> String {
        absolute
            .strip_prefix(&self.root)
            .map(|p| {
                let s = p.to_string_lossy().replace('\\', "/");
                if s.is_empty() {
                    ".".into()
                } else {
                    s
                }
            })
            .unwrap_or_else(|_| absolute.display().to_string())
    }

    /// True if the absolute path is under root and passes allow/deny.
    /// Directories use a trailing slash style match so tree listing can include folders
    /// that may contain allowed files.
    pub fn is_path_allowed(&self, absolute: &Path, is_dir: bool) -> bool {
        let Ok(resolved) = absolute.canonicalize().or_else(|_| {
            // Non-existent paths (writes): check parent chain against root.
            if absolute.starts_with(&self.root) {
                Ok(absolute.to_path_buf())
            } else {
                Err(std::io::Error::other("outside root"))
            }
        }) else {
            return false;
        };
        if !resolved.starts_with(&self.root) && resolved != self.root {
            return false;
        }
        let rel = match resolved.strip_prefix(&self.root) {
            Ok(p) => p,
            Err(_) => return resolved == self.root,
        };
        let mut rel_str = rel.to_string_lossy().replace('\\', "/");
        if rel_str.is_empty() {
            // Scope root itself is always listable.
            return true;
        }
        if is_dir && !rel_str.ends_with('/') {
            rel_str.push('/');
        }
        if self.deny.is_match(&rel_str) {
            return false;
        }
        if self.kind == CodingScopeKind::Project {
            return true;
        }
        // Self scope: directories are allowed if any allow pattern could live under them,
        // or if the dir path itself matches (rare). Files must match allow globs.
        if is_dir {
            return self.dir_may_contain_allowed(&rel_str);
        }
        self.allow.is_match(&rel_str)
    }

    fn dir_may_contain_allowed(&self, rel_dir: &str) -> bool {
        let prefix = rel_dir.trim_end_matches('/');
        for pattern in &self.allow_patterns {
            let pat = pattern.replace('\\', "/");
            if pat.starts_with(prefix)
                || pat.starts_with(&format!("{prefix}/"))
                || prefix.is_empty()
            {
                return true;
            }
            // Pattern like src/renderer/**/*.tsx — directory src/renderer should match.
            if let Some(star) = pat.find('*') {
                let head = pat[..star].trim_end_matches('/');
                if prefix == head
                    || prefix.starts_with(&format!("{head}/"))
                    || head.starts_with(prefix)
                {
                    return true;
                }
            }
        }
        false
    }
}

pub fn canonicalize_existing_dir(path: &Path) -> Result<PathBuf, String> {
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve folder {}: {e}", path.display()))?;
    let meta = std::fs::metadata(&resolved)
        .map_err(|e| format!("Cannot read {}: {e}", resolved.display()))?;
    if !meta.is_dir() {
        return Err(format!("{} is not a directory", resolved.display()));
    }
    Ok(resolved)
}

pub fn coding_tool_definitions() -> Value {
    const JSON: &str = include_str!("../../../resources/contracts/codingTools.json");
    serde_json::from_str(JSON)
        .expect("resources/contracts/codingTools.json must be a valid tool-definitions array")
}

pub fn is_coding_tool_name(name: &str) -> bool {
    matches!(
        name,
        "ws_list_tree"
            | "ws_search"
            | "ws_read"
            | "ws_edit"
            | "ws_write"
            | "ws_delete"
            | "run_command"
            | "git_status"
            | "git_diff"
            | "git_checkout_branch"
    )
}

pub fn is_gated_coding_tool(name: &str) -> bool {
    matches!(
        name,
        "ws_edit" | "ws_write" | "ws_delete" | "git_checkout_branch"
    )
}

pub fn merge_tool_definitions(base: Value, coding: Value) -> Value {
    let mut out = Vec::new();
    if let Some(arr) = base.as_array() {
        out.extend(arr.iter().cloned());
    }
    if let Some(arr) = coding.as_array() {
        out.extend(arr.iter().cloned());
    }
    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn project_scope_allows_under_root_denies_node_modules() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("src/a.ts"), "a").unwrap();
        fs::write(root.join("node_modules/pkg/x.js"), "x").unwrap();

        let scope = CodingScope::project(root.clone()).unwrap();
        assert!(scope.is_path_allowed(&root.join("src/a.ts"), false));
        assert!(!scope.is_path_allowed(&root.join("node_modules/pkg/x.js"), false));
        assert!(scope.is_path_allowed(&root.join("src"), true));
    }

    #[test]
    fn self_scope_allows_only_aspect_globs() {
        let dir = tempdir().unwrap();
        let root = dir.path().to_path_buf();
        fs::create_dir_all(root.join("src/renderer")).unwrap();
        fs::create_dir_all(root.join("src-tauri/src")).unwrap();
        fs::write(root.join("src/renderer/App.tsx"), "x").unwrap();
        fs::write(root.join("src/renderer/base.css"), "y").unwrap();
        fs::write(root.join("src/renderer/index.html"), "z").unwrap();
        fs::write(root.join("src/renderer/helper.ts"), "t").unwrap();
        fs::write(root.join("src-tauri/src/lib.rs"), "r").unwrap();

        let scope = CodingScope::self_repo(root.clone()).unwrap();
        assert!(scope.is_path_allowed(&root.join("src/renderer/App.tsx"), false));
        assert!(scope.is_path_allowed(&root.join("src/renderer/base.css"), false));
        assert!(scope.is_path_allowed(&root.join("src/renderer/index.html"), false));
        assert!(!scope.is_path_allowed(&root.join("src/renderer/helper.ts"), false));
        assert!(!scope.is_path_allowed(&root.join("src-tauri/src/lib.rs"), false));
        assert!(scope.is_path_allowed(&root.join("src/renderer"), true));
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let dir = tempdir().unwrap();
        let scope = CodingScope::project(dir.path().to_path_buf()).unwrap();
        assert!(scope.resolve_relative("../outside").is_err());
        assert!(scope.resolve_relative("/etc/passwd").is_err());
    }

    #[test]
    fn self_modify_contract_has_ui_and_css() {
        let names = self_aspect_names();
        assert!(names.iter().any(|n| n == "ui"));
        assert!(names.iter().any(|n| n == "css"));
        let patterns = self_aspect_patterns();
        assert!(patterns.iter().any(|p| p.contains("*.tsx")));
        assert!(patterns.iter().any(|p| p.contains("*.css")));
    }
}
