use serde::Deserialize;
use serde::Serialize;
use std::sync::OnceLock;

const SYSTEM_PROMPT_JSON: &str = include_str!("../../resources/contracts/systemPrompt.json");

#[derive(Debug, Deserialize)]
struct SystemPromptContract {
    shared: String,
    desktop: String,
    ios: String,
}

fn contract() -> &'static SystemPromptContract {
    static CONTRACT: OnceLock<SystemPromptContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(SYSTEM_PROMPT_JSON)
            .expect("resources/contracts/systemPrompt.json must parse")
    })
}

/// Default shared system prompt (from `resources/contracts/systemPrompt.json`).
pub fn default_shared() -> &'static str {
    &contract().shared
}

/// Default desktop overlay (from `resources/contracts/systemPrompt.json`).
pub fn default_desktop() -> &'static str {
    &contract().desktop
}

/// Default iOS overlay (from `resources/contracts/systemPrompt.json`).
pub fn default_ios() -> &'static str {
    &contract().ios
}

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
    pub shared: String,
    pub platform_overlay: String,
    pub static_prompt: String,
    /// Desktop chat-mode overlay (`decide` / `write` / `refine`); empty for chat / iOS.
    pub mode_overlay: String,
    pub chat_mode: String,
    pub memory_block: String,
    pub recent_conversations_block: String,
    pub temporal_context: String,
    pub assembled_prompt: String,
    pub selected_memories: Vec<SystemPromptPreviewMemory>,
    /// Tool schemas attached to the chat request (not part of the system prompt text).
    pub tools: Vec<SystemPromptPreviewTool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptPreviewMemory {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPromptPreviewTool {
    pub name: String,
    pub description: String,
}

/// Static prompt fields from `resources/contracts/systemPrompt.json` (not settings-overridable).
pub fn contract_fields() -> SystemPromptFields {
    SystemPromptFields {
        shared: default_shared().to_string(),
        desktop: default_desktop().to_string(),
        ios: default_ios().to_string(),
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
    recent_conversations_block: &str,
    temporal_context: &str,
) -> String {
    build_system_prompt_with_mode(
        fields,
        platform,
        "",
        "",
        memory_block,
        recent_conversations_block,
        temporal_context,
    )
}

pub fn build_system_prompt_with_mode(
    fields: &SystemPromptFields,
    platform: &str,
    mode_overlay: &str,
    coding_scope_block: &str,
    memory_block: &str,
    recent_conversations_block: &str,
    temporal_context: &str,
) -> String {
    let mut out = build_static_system_prompt(fields, platform);
    if !mode_overlay.trim().is_empty() {
        out.push_str("\n\n");
        out.push_str(mode_overlay.trim());
    }
    if !coding_scope_block.trim().is_empty() {
        out.push_str("\n\n");
        out.push_str(coding_scope_block.trim());
    }
    if !memory_block.is_empty() {
        out.push_str("\n\n");
        out.push_str(memory_block);
    }
    if !recent_conversations_block.is_empty() {
        out.push_str("\n\n");
        out.push_str(recent_conversations_block);
    }
    out.push_str("\n\n");
    out.push_str(temporal_context);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_has_expected_sections() {
        assert!(default_shared().contains("[CONVERSATION_RECALL]"));
        assert!(!default_shared().contains("[FORMATTING_CAPABILITIES]"));
        assert!(default_desktop().contains("[CORE_INSTRUCTIONS]"));
        assert!(default_desktop().contains("[FORMATTING_CAPABILITIES]"));
        assert!(default_ios().contains("[CORE_INSTRUCTIONS]"));
        assert!(!default_ios().contains("[FORMATTING_CAPABILITIES]"));
        assert!(default_ios().contains("Harness Mobile"));
    }

    #[test]
    fn contract_fields_match_defaults() {
        let fields = contract_fields();
        assert_eq!(fields.shared, default_shared());
        assert_eq!(fields.desktop, default_desktop());
        assert_eq!(fields.ios, default_ios());
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
        let fields = contract_fields();
        let prompt = build_system_prompt(
            &fields,
            "desktop",
            "[USER_MEMORY_CONTEXT]\nmemory",
            "[RECENT_CONVERSATIONS]\nrecent",
            "[TEMPORAL_CONTEXT]\nnow",
        );
        assert!(prompt.contains(default_shared()));
        assert!(prompt.contains(default_desktop()));
        assert!(prompt.contains("[USER_MEMORY_CONTEXT]"));
        assert!(prompt.contains("[RECENT_CONVERSATIONS]"));
        assert!(prompt.contains("[TEMPORAL_CONTEXT]"));
    }

    #[test]
    fn build_system_prompt_with_mode_inserts_overlay_before_memory() {
        let fields = SystemPromptFields {
            shared: "SHARED".into(),
            desktop: "DESKTOP".into(),
            ios: "IOS".into(),
        };
        let prompt = build_system_prompt_with_mode(
            &fields,
            "desktop",
            "[CHAT_MODE: decide]\noverlay",
            "",
            "[USER_MEMORY_CONTEXT]\nmemory",
            "",
            "[TEMPORAL_CONTEXT]\nnow",
        );
        let mode_at = prompt.find("[CHAT_MODE: decide]").unwrap();
        let memory_at = prompt.find("[USER_MEMORY_CONTEXT]").unwrap();
        assert!(mode_at < memory_at);
        assert!(prompt.contains("SHARED"));
        assert!(prompt.contains("DESKTOP"));
    }

}
