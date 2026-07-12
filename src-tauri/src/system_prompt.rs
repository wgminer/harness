use serde::Serialize;
use serde_json::{json, Value};

pub const DEFAULT_SHARED: &str = r#"Prefer concise, practical, high-signal responses.
For complex writing/thinking tasks, start with structure (questions, outline, tradeoffs) unless the user explicitly asks for a full draft immediately.

[FORMATTING_CAPABILITIES]
Standard markdown (bold, italic, lists, tables, fenced code, blockquotes) is supported. Use plain prose by default. Only reach for the layout blocks below when they add genuine clarity over a paragraph or list. Never wrap an entire reply in a single block.

Callouts — one sentence of emphasis, not a heading replacement:
  :::tip
  Short suggestion.
  :::
  (variants: :::tip, :::note, :::warning, :::danger)

Collapsible — fold away long context or sources the user may not need:
  :::details{summary="Sources"}
  Long content.
  :::

Inline chip — a short status tag inside a sentence:
  Build is :chip[failing]{tone=danger}.
  (tones: info, warn, danger, success, neutral)

Link card — only when surfacing a single primary URL the user should open:
  :::link{url="https://example.com" title="Example" desc="One-line summary." site="example.com"}
  :::

Mermaid diagrams — for flows, sequences, small state diagrams:
  ```mermaid
  flowchart LR
    A --> B
  ```

Options — 2-5 short labels the user can tap to reply. Only title is shown; no body text, recommended flag, or section title. Outer fence uses FOUR colons:
  ::::options
  :::option{title="Plain-English walkthrough"}
  :::
  :::option{title="Full Express demo"}
  :::
  ::::

Slide deck — a small inline deck (max ~6 slides). Outer fence uses FOUR colons. Layouts: title, bullets, quote, blank.
  ::::slides
  :::slide{layout=title title="Q3 Review" subtitle="Highlights"}
  :::
  :::slide{layout=bullets title="Wins"}
  - Shipped feature X
  - Closed deal Y
  :::
  :::slide{layout=quote attribution="— Lee"}
  Make it work, then make it fast.
  :::
  :::slide{layout=blank title="Notes"}
  Free-form markdown body.
  :::
  ::::

Rules of thumb: prefer plain prose first; use at most one layout block per reply unless the user is explicitly asking for a comparison or a deck; never nest :::slides inside another directive; do not use callouts as section headers."#;

pub const DEFAULT_DESKTOP: &str = r#"[CORE_INSTRUCTIONS]
You are a helpful assistant running in a local desktop app.
Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); set_layout (sidebar position and optional design grid overlay); task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_set_fact, memory_list_facts, memory_search_conversations (to remember stable user facts and search across prior conversations); get_datetime (for the current date and time, optionally in a specific IANA timezone); get_weather (current conditions and a short daily forecast for a US ZIP; call with no arguments to use the user's default ZIP from Settings); web_search (Tavily web search for current information outside the user's local data); note_list, note_create, note_read, note_save, note_delete (for persistent notes separate from chat; short saved snippets belong in a note titled "Clippings" as a numbered markdown list, optionally with inline #tags). Call them when appropriate.

Long replies: when a response will exceed ~3 short paragraphs, call note_create with title and summary (1-3 sentences). Leave content empty and write the full body in your following output — it streams into the note and appears inline in chat. Do not put the long body in normal chat prose. One inline write-up per turn."#;

pub const DEFAULT_IOS: &str = r#"[CORE_INSTRUCTIONS]
You are a helpful assistant in Harness Mobile (iOS).
Available tools: task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_search_conversations (search all prior chats for a free-text query when the user asks about past conversations or needs recall across threads). Call them when appropriate."#;

#[derive(Debug, Clone)]
pub struct SystemPromptFields {
    pub shared: String,
    pub desktop: String,
    pub ios: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptPreview {
    pub platform: String,
    pub static_prompt: String,
    pub memory_block: String,
    pub temporal_context: String,
    pub assembled_prompt: String,
    pub injection_strategy: String,
    pub selected_facts: Vec<SystemPromptPreviewFact>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptPreviewFact {
    pub key: String,
    pub value: String,
}

pub fn default_system_prompt_value() -> Value {
    json!({
        "shared": DEFAULT_SHARED,
        "desktop": DEFAULT_DESKTOP,
        "ios": DEFAULT_IOS,
    })
}

fn field_or_default(raw: Option<&str>, default: &str) -> String {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(default)
        .to_string()
}

pub fn parse_system_prompt(raw: Option<&Value>, defaults: &Value) -> Value {
    let default_sp = defaults
        .get("systemPrompt")
        .cloned()
        .unwrap_or_else(default_system_prompt_value);
    let obj = raw.and_then(|v| v.as_object());
    json!({
        "shared": field_or_default(
            obj.and_then(|o| o.get("shared")).and_then(|v| v.as_str()),
            default_sp.get("shared").and_then(|v| v.as_str()).unwrap_or(DEFAULT_SHARED),
        ),
        "desktop": field_or_default(
            obj.and_then(|o| o.get("desktop")).and_then(|v| v.as_str()),
            default_sp.get("desktop").and_then(|v| v.as_str()).unwrap_or(DEFAULT_DESKTOP),
        ),
        "ios": field_or_default(
            obj.and_then(|o| o.get("ios")).and_then(|v| v.as_str()),
            default_sp.get("ios").and_then(|v| v.as_str()).unwrap_or(DEFAULT_IOS),
        ),
    })
}

pub fn fields_from_settings(settings: &Value) -> SystemPromptFields {
    let sp = settings
        .get("systemPrompt")
        .cloned()
        .unwrap_or_else(default_system_prompt_value);
    SystemPromptFields {
        shared: sp
            .get("shared")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_SHARED)
            .to_string(),
        desktop: sp
            .get("desktop")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_DESKTOP)
            .to_string(),
        ios: sp
            .get("ios")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_IOS)
            .to_string(),
    }
}

pub fn platform_overlay<'a>(fields: &'a SystemPromptFields, platform: &str) -> &'a str {
    if platform == "ios" {
        &fields.ios
    } else {
        &fields.desktop
    }
}

pub fn build_static_system_prompt(fields: &SystemPromptFields, platform: &str) -> String {
    format!(
        "{}\n\n{}",
        fields.shared,
        platform_overlay(fields, platform)
    )
}

pub fn build_system_prompt(
    fields: &SystemPromptFields,
    platform: &str,
    memory_block: &str,
    temporal_context: &str,
) -> String {
    let mut out = build_static_system_prompt(fields, platform);
    if !memory_block.is_empty() {
        out.push_str("\n\n");
        out.push_str(memory_block);
    }
    out.push_str("\n\n");
    out.push_str(temporal_context);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn absent_system_prompt_uses_defaults() {
        let defaults = default_settings();
        let parsed = parse_system_prompt(None, &defaults);
        assert_eq!(parsed["shared"].as_str().unwrap(), DEFAULT_SHARED);
        assert_eq!(parsed["desktop"].as_str().unwrap(), DEFAULT_DESKTOP);
        assert_eq!(parsed["ios"].as_str().unwrap(), DEFAULT_IOS);
    }

    #[test]
    fn partial_system_prompt_merges_missing_keys() {
        let defaults = default_settings();
        let parsed = parse_system_prompt(
            Some(&json!({ "shared": "custom shared" })),
            &defaults,
        );
        assert_eq!(parsed["shared"].as_str().unwrap(), "custom shared");
        assert_eq!(parsed["desktop"].as_str().unwrap(), DEFAULT_DESKTOP);
        assert_eq!(parsed["ios"].as_str().unwrap(), DEFAULT_IOS);
    }

    #[test]
    fn build_static_uses_platform_overlay() {
        let fields = SystemPromptFields {
            shared: "SHARED".into(),
            desktop: "DESKTOP".into(),
            ios: "IOS".into(),
        };
        assert_eq!(
            build_static_system_prompt(&fields, "desktop"),
            "SHARED\n\nDESKTOP"
        );
        assert_eq!(build_static_system_prompt(&fields, "ios"), "SHARED\n\nIOS");
    }

    #[test]
    fn build_system_prompt_appends_memory_and_temporal() {
        let fields = fields_from_settings(&json!({}));
        let prompt = build_system_prompt(
            &fields,
            "desktop",
            "[USER_MEMORY_CONTEXT]\nfact",
            "[TEMPORAL_CONTEXT]\nnow",
        );
        assert!(prompt.contains(DEFAULT_SHARED));
        assert!(prompt.contains(DEFAULT_DESKTOP));
        assert!(prompt.contains("[USER_MEMORY_CONTEXT]"));
        assert!(prompt.contains("[TEMPORAL_CONTEXT]"));
    }

    fn default_settings() -> Value {
        crate::settings::default_settings()
    }
}
