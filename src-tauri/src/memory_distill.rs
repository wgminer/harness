use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistilledMemory {
    pub key: String,
    pub value: String,
}

#[async_trait::async_trait]
pub trait MemoryCompileLlm: Send + Sync {
    async fn distill(&self, transcripts: &str) -> Result<Vec<DistilledMemory>, String>;
}

pub fn merge_memories(
    existing: &HashMap<String, String>,
    memories: &[DistilledMemory],
) -> (HashMap<String, String>, usize, usize) {
    let mut merged = existing.clone();
    let mut lower_to_key = HashMap::new();
    for k in merged.keys() {
        lower_to_key.insert(k.to_lowercase(), k.clone());
    }

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut seen_lower_keys = HashSet::new();

    for memory in memories {
        let raw_key = memory.key.trim();
        let raw_value = memory.value.trim();
        if raw_key.is_empty() || raw_value.is_empty() {
            continue;
        }
        let lower = raw_key.to_lowercase();
        if seen_lower_keys.contains(&lower) {
            continue;
        }
        seen_lower_keys.insert(lower.clone());

        if let Some(existing_key) = lower_to_key.get(&lower) {
            if merged.get(existing_key).map(|v| v.trim()) != Some(raw_value) {
                merged.insert(existing_key.clone(), raw_value.to_string());
                updated += 1;
            }
        } else {
            merged.insert(raw_key.to_string(), raw_value.to_string());
            lower_to_key.insert(lower, raw_key.to_string());
            added += 1;
        }
    }

    (merged, added, updated)
}

pub fn parse_memories_response(raw: &str) -> Vec<DistilledMemory> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let mut trimmed = raw.trim().to_string();
    if let Some(stripped) = trimmed.strip_prefix("```json") {
        trimmed = stripped.trim().to_string();
    } else if let Some(stripped) = trimmed.strip_prefix("```") {
        trimmed = stripped.trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_suffix("```") {
        trimmed = stripped.trim().to_string();
    }

    let parsed: serde_json::Value = match serde_json::from_str(&trimmed) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let memories = parsed
        .get("memories")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for m in memories {
        let key = m.get("key").and_then(|v| v.as_str());
        let value = m.get("value").and_then(|v| v.as_str());
        if let (Some(key), Some(value)) = (key, value) {
            out.push(DistilledMemory {
                key: key.to_string(),
                value: value.to_string(),
            });
        }
    }
    out
}
