use serde_json::{json, Value};

use crate::credentials::{migrate_secrets_from_settings_raw, set_credential, CredentialKey};
use crate::system_prompt::{default_system_prompt_value, parse_system_prompt};
use crate::paths::{ensure_local_data_migration, get_local_data_settings_path};
use crate::storage::{atomic_write_utf8, file_exists, read_json_object_file, WriteChains};

const DEFAULT_TRANSCRIPTION_PROMPT: &str = "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.";

/// Must match `DEFAULT_ACCENT` in `src/shared/accent.ts` and `--accent` in `base.css`.
const DEFAULT_ACCENT: &str = "#5b9cf5";

pub fn default_settings() -> Value {
    json!({
        "version": 1,
        "openai": { "apiKey": "" },
        "recording": {
            "autoSend": true,
            "globalFnHotkey": true
        },
        "transcription": {
            "cleanup": {
                "enabled": false,
                "prompt": DEFAULT_TRANSCRIPTION_PROMPT
            },
            "dictionary": []
        },
        "search": { "tavilyApiKey": "" },
        "notes": {
            "templates": default_note_templates(),
            "defaultTemplateId": "blank"
        },
        "sync": {
            "accountId": "",
            "bucket": "",
            "prefix": "harness/",
            "accessKeyId": ""
        },
        "chat": {
            "openToComposeOnLaunch": true
        },
        "systemPrompt": default_system_prompt_value(),
        "appearance": {
            "accent": DEFAULT_ACCENT
        }
    })
}

fn default_note_templates() -> Value {
    json!([
        {
            "id": "blank",
            "title": "Blank",
            "content": "# Note\n"
        },
        {
            "id": "one-on-one",
            "title": "1:1",
            "content": "# 1:1\n\n## Wins\n- \n\n## Updates\n- \n\n## Feedback\n- \n\n## Blockers\n- \n\n## Next steps\n- [ ] "
        },
        {
            "id": "daily-log",
            "title": "Daily log",
            "content": "# Daily Log\n\n{{today}}\n\n## Wins\n- \n\n## Focus\n- \n\n## Blockers\n- \n\n## Tomorrow\n- "
        }
    ])
}

pub fn normalize_note_templates(input: Option<&Value>) -> Value {
    let defaults = default_note_templates();

    let Some(items) = input.and_then(|v| v.as_array()) else {
        return defaults;
    };
    if items.len() != defaults.as_array().map(|a| a.len()).unwrap_or(0) {
        return defaults;
    }

    let mut by_id = std::collections::HashMap::new();
    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
        let title = obj.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
        let content = obj
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() || title.is_empty() {
            continue;
        }
        by_id.insert(
            id.to_string(),
            json!({
                "id": id,
                "title": title,
                "content": content
            }),
        );
    }

    let merged: Vec<Value> = defaults
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|base| {
            let id = base.get("id").and_then(|v| v.as_str()).unwrap_or("");
            by_id.get(id).cloned().unwrap_or(base)
        })
        .collect();
    Value::Array(merged)
}

fn normalize_default_note_template_id(input: Option<&Value>, templates: &Value) -> Value {
    let blank = "blank";
    let id = input.and_then(|v| v.as_str()).unwrap_or("").trim();
    let valid = templates
        .as_array()
        .map(|arr| {
            arr.iter()
                .any(|item| item.get("id").and_then(|v| v.as_str()) == Some(id))
        })
        .unwrap_or(false);
    if !id.is_empty() && valid {
        json!(id)
    } else {
        json!(blank)
    }
}

fn parse_transcription(raw: Option<&Value>, defaults: &Value) -> Value {
    let default_cleanup = defaults
        .get("transcription")
        .and_then(|v| v.get("cleanup"))
        .cloned()
        .unwrap_or_else(|| json!({ "enabled": false, "prompt": DEFAULT_TRANSCRIPTION_PROMPT }));

    let cleanup_raw = raw.and_then(|v| v.get("cleanup"));
    let enabled = cleanup_raw
        .and_then(|v| v.get("enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| {
            default_cleanup
                .get("enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });
    let prompt = cleanup_raw
        .and_then(|v| v.get("prompt"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            default_cleanup
                .get("prompt")
                .and_then(|v| v.as_str())
                .unwrap_or(DEFAULT_TRANSCRIPTION_PROMPT)
        });

    let dictionary_raw = raw
        .and_then(|v| v.get("dictionary"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut dedupe = std::collections::HashSet::new();
    let mut dictionary = Vec::new();
    for entry in dictionary_raw {
        let Some(obj) = entry.as_object() else {
            continue;
        };
        let from = obj
            .get("from")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let to = obj
            .get("to")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if from.is_empty() {
            continue;
        }
        let key = from.to_lowercase();
        if dedupe.contains(&key) {
            continue;
        }
        dedupe.insert(key);
        dictionary.push(json!({ "from": from, "to": to }));
    }

    json!({
        "cleanup": { "enabled": enabled, "prompt": prompt },
        "dictionary": dictionary
    })
}

fn parse_sync(raw: Option<&Value>, defaults: &Value) -> Value {
    let default_sync = defaults.get("sync").cloned().unwrap_or_else(|| {
        json!({
            "accountId": "",
            "bucket": "",
            "prefix": "harness/",
            "accessKeyId": ""
        })
    });

    let prefix_raw = raw
        .and_then(|v| v.get("prefix"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let default_prefix = default_sync
        .get("prefix")
        .and_then(|v| v.as_str())
        .unwrap_or("harness/");
    let prefix = if prefix_raw.is_empty() {
        default_prefix.to_string()
    } else {
        prefix_raw
    };
    let prefix = if prefix.ends_with('/') {
        prefix
    } else {
        format!("{prefix}/")
    };

    json!({
        "accountId": raw
            .and_then(|v| v.get("accountId"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                default_sync
                    .get("accountId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
            }),
        "bucket": raw
            .and_then(|v| v.get("bucket"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                default_sync
                    .get("bucket")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
            }),
        "prefix": prefix,
        "accessKeyId": raw
            .and_then(|v| v.get("accessKeyId"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                default_sync
                    .get("accessKeyId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
            })
    })
}

fn normalize_accent_hex(raw: Option<&Value>) -> String {
    let Some(s) = raw.and_then(|v| v.as_str()) else {
        return DEFAULT_ACCENT.to_string();
    };
    let trimmed = s.trim();
    let hex = trimmed.strip_prefix('#').unwrap_or(trimmed);
    let lower = hex.to_ascii_lowercase();
    let expanded = if lower.len() == 3 && lower.chars().all(|c| c.is_ascii_hexdigit()) {
        lower
            .chars()
            .flat_map(|c| [c, c])
            .collect::<String>()
    } else if lower.len() == 6 && lower.chars().all(|c| c.is_ascii_hexdigit()) {
        lower
    } else {
        return DEFAULT_ACCENT.to_string();
    };
    format!("#{expanded}")
}

fn parse_appearance(raw: Option<&Value>) -> Value {
    json!({
        "accent": normalize_accent_hex(raw.and_then(|v| v.get("accent")))
    })
}

pub fn parse_settings(data: &Value) -> Value {
    let defaults = default_settings();
    let obj = data.as_object();

    let chat_raw = obj.and_then(|o| o.get("chat"));
    let open_to_compose = chat_raw
        .and_then(|v| v.get("openToComposeOnLaunch"))
        .and_then(|v| v.as_bool())
        .or_else(|| chat_raw.and_then(|v| v.get("composeFirst")).and_then(|v| v.as_bool()))
        .unwrap_or_else(|| {
            defaults
                .get("chat")
                .and_then(|v| v.get("openToComposeOnLaunch"))
                .and_then(|v| v.as_bool())
                .unwrap_or(true)
        });

    let note_templates = normalize_note_templates(
        obj.and_then(|o| o.get("notes")).and_then(|v| v.get("templates")),
    );
    let default_note_template_id = normalize_default_note_template_id(
        obj.and_then(|o| o.get("notes"))
            .and_then(|v| v.get("defaultTemplateId")),
        &note_templates,
    );

    json!({
        "version": defaults.get("version").cloned().unwrap_or(json!(1)),
        "openai": { "apiKey": "" },
        "search": { "tavilyApiKey": "" },
        "notes": {
            "templates": note_templates,
            "defaultTemplateId": default_note_template_id
        },
        "recording": {
            "autoSend": obj
                .and_then(|o| o.get("recording"))
                .and_then(|v| v.get("autoSend"))
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    defaults
                        .get("recording")
                        .and_then(|v| v.get("autoSend"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true)
                }),
            "globalFnHotkey": obj
                .and_then(|o| o.get("recording"))
                .and_then(|v| v.get("globalFnHotkey"))
                .and_then(|v| v.as_bool())
                .unwrap_or_else(|| {
                    defaults
                        .get("recording")
                        .and_then(|v| v.get("globalFnHotkey"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true)
                })
        },
        "transcription": parse_transcription(obj.and_then(|o| o.get("transcription")), &defaults),
        "sync": parse_sync(obj.and_then(|o| o.get("sync")), &defaults),
        "chat": { "openToComposeOnLaunch": open_to_compose },
        "systemPrompt": parse_system_prompt(
            obj.and_then(|o| o.get("systemPrompt")),
            &defaults,
        ),
        "appearance": parse_appearance(obj.and_then(|o| o.get("appearance"))),
    })
}

pub fn strip_settings_secrets(raw: &mut Value) {
    let Some(obj) = raw.as_object_mut() else {
        return;
    };

    if let Some(openai) = obj.get_mut("openai").and_then(|v| v.as_object_mut()) {
        openai.remove("apiKey");
        if openai.is_empty() {
            obj.remove("openai");
        }
    }

    if let Some(search) = obj.get_mut("search").and_then(|v| v.as_object_mut()) {
        search.remove("tavilyApiKey");
        if search.is_empty() {
            obj.remove("search");
        }
    }
}

fn strip_secrets_before_save(settings: &Value) -> Value {
    let mut out = settings.clone();
    if let Some(openai) = out.get_mut("openai").and_then(|v| v.as_object_mut()) {
        openai.insert("apiKey".into(), json!(""));
    } else {
        out["openai"] = json!({ "apiKey": "" });
    }
    if let Some(search) = out.get_mut("search").and_then(|v| v.as_object_mut()) {
        search.insert("tavilyApiKey".into(), json!(""));
    } else {
        out["search"] = json!({ "tavilyApiKey": "" });
    }
    out
}

async fn migrate_settings_file_at_path(chains: &WriteChains, path: &std::path::Path) -> std::io::Result<()> {
    if !file_exists(path).await {
        return Ok(());
    }
    let raw_text = tokio::fs::read_to_string(path).await?;
    let mut raw: Value = match serde_json::from_str(&raw_text) {
        Ok(v) => v,
        Err(_) => return Ok(()),
    };
    let migrated_secrets = migrate_secrets_from_settings_raw(&mut raw).await;
    let stripped_before = raw.clone();
    strip_settings_secrets(&mut raw);
    if !migrated_secrets && raw == stripped_before {
        return Ok(());
    }
    let pretty = serde_json::to_string_pretty(&raw).unwrap_or_default();
    atomic_write_utf8(chains, path, &pretty).await
}

pub async fn load_settings_from_path(chains: &WriteChains, path: &std::path::Path) -> Value {
    migrate_settings_file_at_path(chains, path).await.ok();
    if !file_exists(path).await {
        return default_settings();
    }
    let parsed = read_json_object_file(path).await;
    parse_settings(&parsed.value)
}

async fn load_settings(chains: &WriteChains) -> Value {
    ensure_local_data_migration();
    let path = get_local_data_settings_path();
    load_settings_from_path(chains, &path).await
}

pub async fn save_settings_to_path(
    chains: &WriteChains,
    path: &std::path::Path,
    settings: &Value,
) -> std::io::Result<()> {
    let stripped = strip_secrets_before_save(settings);
    let pretty = serde_json::to_string_pretty(&stripped).unwrap_or_default();
    atomic_write_utf8(chains, path, &pretty).await
}

async fn save_settings(chains: &WriteChains, settings: &Value) -> std::io::Result<()> {
    ensure_local_data_migration();
    let path = get_local_data_settings_path();
    save_settings_to_path(chains, &path, settings).await
}

pub async fn get_settings(chains: &WriteChains) -> Value {
    load_settings(chains).await
}

fn merge_object_fields(base: &Value, patch: &Value, keys: &[&str]) -> Value {
    let mut out = base.clone();
    let Some(patch_obj) = patch.as_object() else {
        return out;
    };
    let out_obj = out.as_object_mut().unwrap();
    for key in keys {
        if let Some(val) = patch_obj.get(*key) {
            out_obj.insert((*key).to_string(), val.clone());
        }
    }
    out
}

pub async fn set_settings(chains: &WriteChains, partial: &Value) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let openai_key = partial
        .get("openai")
        .and_then(|v| v.get("apiKey"))
        .and_then(|v| v.as_str());
    let tavily_key = partial
        .get("search")
        .and_then(|v| v.get("tavilyApiKey"))
        .and_then(|v| v.as_str());

    if let Some(key) = openai_key {
        set_credential(CredentialKey::OpenAiApiKey, key)?;
    }
    if let Some(key) = tavily_key {
        set_credential(CredentialKey::TavilyApiKey, key)?;
    }

    let current = load_settings(chains).await;
    let defaults = default_settings();

    let mut next = current.clone();

    if let Some(recording) = partial.get("recording") {
        next["recording"] = merge_object_fields(
            current.get("recording").unwrap_or(&json!({})),
            recording,
            &["autoSend", "globalFnHotkey"],
        );
    }

    if let Some(transcription) = partial.get("transcription") {
        let current_transcription = current.get("transcription").cloned().unwrap_or_else(|| {
            defaults.get("transcription").cloned().unwrap_or(json!({}))
        });
        let mut merged = current_transcription.clone();
        if let Some(dict) = transcription.get("dictionary") {
            merged["dictionary"] = parse_transcription(Some(&json!({ "dictionary": dict })), &defaults)
                .get("dictionary")
                .cloned()
                .unwrap_or_else(|| json!([]));
        }
        if let Some(cleanup) = transcription.get("cleanup") {
            merged["cleanup"] = merge_object_fields(
                merged.get("cleanup").unwrap_or(&json!({})),
                cleanup,
                &["enabled", "prompt"],
            );
        }
        next["transcription"] = merged;
    }

    if let Some(notes) = partial.get("notes") {
        let current_notes = current.get("notes").cloned().unwrap_or_else(|| json!({}));
        let mut merged = current_notes;
        if let Some(templates) = notes.get("templates") {
            merged["templates"] = normalize_note_templates(Some(templates));
        }
        let templates = merged
            .get("templates")
            .cloned()
            .unwrap_or_else(default_note_templates);
        if let Some(default_template_id) = notes.get("defaultTemplateId") {
            merged["defaultTemplateId"] =
                normalize_default_note_template_id(Some(default_template_id), &templates);
        } else {
            merged["defaultTemplateId"] = normalize_default_note_template_id(
                merged.get("defaultTemplateId"),
                &templates,
            );
        }
        next["notes"] = merged;
    }

    if let Some(sync) = partial.get("sync") {
        next["sync"] = merge_object_fields(
            current.get("sync").unwrap_or(&json!({})),
            sync,
            &["accountId", "bucket", "prefix", "accessKeyId"],
        );
    }

    if let Some(chat) = partial.get("chat") {
        next["chat"] = merge_object_fields(
            current.get("chat").unwrap_or(&json!({})),
            chat,
            &["openToComposeOnLaunch"],
        );
    }

    if let Some(system_prompt) = partial.get("systemPrompt") {
        let current_sp = current
            .get("systemPrompt")
            .cloned()
            .unwrap_or_else(default_system_prompt_value);
        next["systemPrompt"] = merge_object_fields(
            &current_sp,
            system_prompt,
            &["shared", "desktop", "ios"],
        );
    }

    if let Some(appearance) = partial.get("appearance") {
        next["appearance"] = merge_object_fields(
            current.get("appearance").unwrap_or(&json!({})),
            appearance,
            &["accent"],
        );
    }

    next["openai"] = json!({ "apiKey": "" });
    next["search"] = json!({ "tavilyApiKey": "" });

    let normalized = parse_settings(&next);
    save_settings(chains, &normalized).await?;
    Ok(normalized)
}
