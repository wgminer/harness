//! Transcript cleanup prompt + preferred-spellings glossary.
//! Contract: `resources/contracts/transcriptCleanup.json`.

use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

const CONTRACT_JSON: &str = include_str!("../../resources/contracts/transcriptCleanup.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptCleanupContract {
    default_prompt: String,
    legacy_default_prompt: String,
    preferred_spellings_header: String,
}

fn contract() -> &'static TranscriptCleanupContract {
    static CONTRACT: OnceLock<TranscriptCleanupContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(CONTRACT_JSON)
            .expect("resources/contracts/transcriptCleanup.json must parse")
    })
}

pub fn default_prompt() -> &'static str {
    &contract().default_prompt
}

pub fn migrate_cleanup_prompt(prompt: &str) -> String {
    let trimmed = prompt.trim();
    if trimmed.is_empty() || trimmed == contract().legacy_default_prompt {
        return default_prompt().to_string();
    }
    trimmed.to_string()
}

pub fn normalize_glossary(raw: Option<&Value>) -> Vec<String> {
    let Some(items) = raw.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items {
        let Some(term) = item.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        let key = term.to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        out.push(term.to_string());
    }
    out
}

fn glossary_from_legacy_dictionary(raw: Option<&Value>) -> Vec<String> {
    let Some(items) = raw.and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut terms = Vec::new();
    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let from = obj
            .get("from")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        match obj.get("to").and_then(|v| v.as_str()) {
            Some(to) => {
                let to = to.trim();
                if !to.is_empty() {
                    terms.push(json!(to));
                }
            }
            None => {
                if !from.is_empty() {
                    terms.push(json!(from));
                }
            }
        }
    }
    normalize_glossary(Some(&Value::Array(terms)))
}

/// Prefer an explicit `glossary` key (even if empty) over legacy `dictionary`.
pub fn resolve_glossary(transcription: Option<&Value>) -> Vec<String> {
    let Some(obj) = transcription.and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    if obj.contains_key("glossary") {
        return normalize_glossary(obj.get("glossary"));
    }
    glossary_from_legacy_dictionary(obj.get("dictionary"))
}

pub fn glossary_value(transcription: Option<&Value>) -> Value {
    json!(resolve_glossary(transcription))
}

pub fn append_preferred_spellings(prompt: &str, glossary: &[String]) -> String {
    let base = {
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            default_prompt().to_string()
        } else {
            trimmed.to_string()
        }
    };
    if glossary.is_empty() {
        return base;
    }
    let mut out = base;
    out.push_str("\n\n");
    out.push_str(&contract().preferred_spellings_header);
    for term in glossary {
        out.push_str("\n- ");
        out.push_str(term);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_legacy_dictionary_to_replacement_term() {
        let raw = json!({
            "dictionary": [
                { "from": "cursor", "to": "Cursor" },
                { "from": "um", "to": "" },
                { "from": "Harness", "to": "Harness" }
            ]
        });
        assert_eq!(
            resolve_glossary(Some(&raw)),
            vec!["Cursor".to_string(), "Harness".to_string()]
        );
    }

    #[test]
    fn empty_glossary_key_wins_over_dictionary() {
        let raw = json!({
            "glossary": [],
            "dictionary": [{ "from": "c", "to": "Cursor" }]
        });
        assert!(resolve_glossary(Some(&raw)).is_empty());
    }

    #[test]
    fn appends_preferred_spellings_block() {
        let out = append_preferred_spellings("Keep it terse.", &["Cursor".into(), "Harness".into()]);
        assert!(out.starts_with("Keep it terse.\n\n"));
        assert!(out.contains("- Cursor"));
        assert!(out.contains("- Harness"));
        assert!(out.contains(&contract().preferred_spellings_header));
    }

    #[test]
    fn upgrades_legacy_default_prompt() {
        assert_eq!(
            migrate_cleanup_prompt(&contract().legacy_default_prompt),
            default_prompt()
        );
        assert_eq!(migrate_cleanup_prompt("Keep filler."), "Keep filler.");
    }
}
