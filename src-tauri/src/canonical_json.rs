//! Canonical JSON for sync-merge output and cross-platform revision hashes.
//!
//! Format: 2-space pretty-print (or compact for dedup stamps), object keys sorted
//! lexicographically at every nesting level, no trailing newline.
//!
//! Changing this format changes revision hashes once — devices must re-pull.

use serde_json::Value;

fn sort_json_value(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for key in keys {
                sorted.insert(key.clone(), sort_json_value(map[key].clone()));
            }
            Value::Object(sorted)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(sort_json_value).collect()),
        other => other,
    }
}

fn strip_trailing_newline(mut bytes: Vec<u8>) -> Vec<u8> {
    if bytes.last() == Some(&b'\n') {
        bytes.pop();
    }
    bytes
}

/// Pretty JSON with sorted keys (2-space indent, no trailing newline).
pub fn to_vec_pretty_canonical(value: &Value) -> Vec<u8> {
    let sorted = sort_json_value(value.clone());
    strip_trailing_newline(serde_json::to_vec_pretty(&sorted).unwrap_or_default())
}

/// Compact JSON with sorted keys (for message dedup stamps).
pub fn to_string_compact_canonical(value: &Value) -> String {
    serde_json::to_string(&sort_json_value(value.clone())).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pretty_sorts_keys_and_omits_trailing_newline() {
        let value = json!({ "b": 1, "a": { "z": 1, "y": 2 } });
        let bytes = to_vec_pretty_canonical(&value);
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.ends_with('\n'));
        assert_eq!(
            text,
            "{\n  \"a\": {\n    \"y\": 2,\n    \"z\": 1\n  },\n  \"b\": 1\n}"
        );
    }

    #[test]
    fn compact_sorts_keys() {
        let value = json!({ "b": 1, "a": 2 });
        assert_eq!(to_string_compact_canonical(&value), r#"{"a":2,"b":1}"#);
    }
}
