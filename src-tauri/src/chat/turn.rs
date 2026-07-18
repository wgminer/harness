use std::collections::HashMap;

use regex::Regex;
use serde::Serialize;
use serde_json::json;

use crate::memory::{get_messages, get_user_memory, pop_last_user_message, AppendMessageMeta};
use crate::openai::{tool_definitions, ChatMessageParam};
use crate::recent_conversations::build_recent_conversations_block;
use crate::settings;
use crate::system_prompt::{
    build_system_prompt, fields_from_settings, SystemPromptPreview, SystemPromptPreviewFact,
};
use crate::conversation_title::schedule_conversation_title_refinement;

use super::ChatController;

pub(crate) const DICTATION_POLISH_INSTRUCTION: &str =
    "Polish and clarify the following dictation. Fix grammar and wording; keep the meaning. Reply with a clear, concise version.";

#[derive(Debug, Clone)]
pub(crate) struct ContextAssembly {
    pub selected_memory: Vec<(String, String)>,
    pub memory_block: String,
    pub system_prompt: String,
    pub temporal_context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPreviewFact {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPreviewMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPreviewTool {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPreview {
    pub selected_facts: Vec<ContextPreviewFact>,
    pub system_prompt: String,
    pub temporal_context: String,
    pub memory_block: String,
    pub messages: Vec<ContextPreviewMessage>,
    pub tools: Vec<ContextPreviewTool>,
}

impl ChatController {
    pub async fn send(&self, conversation_id: &str, user_content: &str) -> Result<(), String> {
        let messages = self
            .build_message_list(conversation_id, Some(user_content), None)
            .await?;
        crate::memory::append_message(
            &self.state,
            conversation_id,
            "user",
            user_content,
            Some(AppendMessageMeta {
                timestamp: Some(chrono::Utc::now().timestamp_millis()),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        // Match iOS: refine title after each user message (covers first-message threads
        // even if the assistant stream errors before its own schedule runs).
        schedule_conversation_title_refinement(
            self.app.clone(),
            self.state.clone(),
            conversation_id.to_string(),
        );
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn polish_last_user(&self, conversation_id: &str) -> Result<(), String> {
        let transcript = pop_last_user_message(&self.state, conversation_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No user message to polish.".to_string())?;
        let instruction = DICTATION_POLISH_INSTRUCTION;
        let t1 = chrono::Utc::now().timestamp_millis();
        let t2 = t1 + 1;
        let messages = self
            .build_message_list(conversation_id, Some(instruction), Some(&transcript))
            .await?;
        crate::memory::append_message(
            &self.state,
            conversation_id,
            "user",
            instruction,
            Some(AppendMessageMeta {
                timestamp: Some(t1),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        crate::memory::append_message(
            &self.state,
            conversation_id,
            "user",
            &transcript,
            Some(AppendMessageMeta {
                timestamp: Some(t2),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        schedule_conversation_title_refinement(
            self.app.clone(),
            self.state.clone(),
            conversation_id.to_string(),
        );
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn generate_reply(&self, conversation_id: &str) -> Result<(), String> {
        let messages = self.build_message_list(conversation_id, None, None).await?;
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn get_system_prompt_preview(
        &self,
        platform: &str,
    ) -> Result<SystemPromptPreview, String> {
        let platform = if platform == "ios" { "ios" } else { "desktop" };
        let settings = settings::get_settings(&self.state.write_chains).await;
        let user_memory = get_user_memory(&self.state)
            .await
            .map_err(|e| e.to_string())?;
        let selected_memory = sorted_memory_entries(&user_memory);
        let memory_block = format_memory_context_block(&selected_memory);
        let recent_conversations_block =
            build_recent_conversations_block(&self.state, None)
                .await
                .map_err(|e| e.to_string())?;
        let temporal_context = format_temporal_context_block();
        let fields = fields_from_settings(&settings);
        let static_prompt = crate::system_prompt::build_static_system_prompt(&fields, platform);
        let assembled_prompt = build_system_prompt(
            &fields,
            platform,
            &memory_block,
            &recent_conversations_block,
            &temporal_context,
        );
        Ok(SystemPromptPreview {
            platform: platform.to_string(),
            static_prompt,
            memory_block,
            recent_conversations_block,
            temporal_context,
            assembled_prompt,
            selected_facts: selected_memory
                .into_iter()
                .map(|(key, value)| SystemPromptPreviewFact { key, value })
                .collect(),
        })
    }

    pub async fn get_context_preview(
        &self,
        conversation_id: Option<&str>,
    ) -> Result<ContextPreview, String> {
        let (assembly, messages) = self
            .assemble_context(conversation_id, None, None)
            .await?;
        Ok(ContextPreview {
            selected_facts: assembly
                .selected_memory
                .iter()
                .map(|(key, value)| ContextPreviewFact {
                    key: key.clone(),
                    value: value.clone(),
                })
                .collect(),
            system_prompt: assembly.system_prompt,
            temporal_context: assembly.temporal_context,
            memory_block: assembly.memory_block,
            messages: messages
                .into_iter()
                .filter(|m| m.role != "system")
                .map(|m| ContextPreviewMessage {
                    role: m.role,
                    content: m.content.unwrap_or_default(),
                })
                .collect(),
            tools: tool_summaries(),
        })
    }

    pub(crate) async fn build_message_list(
        &self,
        conversation_id: &str,
        user_content: Option<&str>,
        second_user_content: Option<&str>,
    ) -> Result<Vec<ChatMessageParam>, String> {
        let (_, messages) = self
            .assemble_context(
                Some(conversation_id),
                user_content,
                second_user_content,
            )
            .await?;
        Ok(messages)
    }

    pub(crate) async fn assemble_context(
        &self,
        conversation_id: Option<&str>,
        user_content: Option<&str>,
        second_user_content: Option<&str>,
    ) -> Result<(ContextAssembly, Vec<ChatMessageParam>), String> {
        let settings = settings::get_settings(&self.state.write_chains).await;
        let user_memory = get_user_memory(&self.state)
            .await
            .map_err(|e| e.to_string())?;
        let selected_memory = sorted_memory_entries(&user_memory);
        let memory_block = format_memory_context_block(&selected_memory);
        let recent_conversations_block =
            build_recent_conversations_block(&self.state, conversation_id)
                .await
                .map_err(|e| e.to_string())?;
        let temporal_context = format_temporal_context_block();
        let fields = fields_from_settings(&settings);
        let system_prompt = build_system_prompt(
            &fields,
            "desktop",
            &memory_block,
            &recent_conversations_block,
            &temporal_context,
        );
        let assembly = ContextAssembly {
            selected_memory,
            memory_block,
            system_prompt: system_prompt.clone(),
            temporal_context,
        };

        let history = if let Some(conversation_id) = conversation_id {
            get_messages(&self.state, conversation_id)
                .await
                .map_err(|e| e.to_string())?
        } else {
            Vec::new()
        };
        let mut messages = vec![ChatMessageParam {
            role: "system".into(),
            content: Some(system_prompt),
            tool_calls: None,
            tool_call_id: None,
        }];
        let now_ms = chrono::Utc::now().timestamp_millis();
        for m in history {
            if m.role == "system" {
                messages.push(ChatMessageParam {
                    role: m.role,
                    content: Some(m.content),
                    tool_calls: None,
                    tool_call_id: None,
                });
                continue;
            }
            messages.push(ChatMessageParam {
                role: m.role.clone(),
                content: Some(annotate_message_content_for_model(
                    &m.content,
                    m.timestamp,
                )),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        if let Some(content) = user_content {
            messages.push(ChatMessageParam {
                role: "user".into(),
                content: Some(annotate_message_content_for_model(content, Some(now_ms))),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        if let Some(content) = second_user_content {
            messages.push(ChatMessageParam {
                role: "user".into(),
                content: Some(annotate_message_content_for_model(content, Some(now_ms + 1))),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        Ok((assembly, messages))
    }
}

fn tool_summaries() -> Vec<ContextPreviewTool> {
    let defs = tool_definitions();
    let Some(items) = defs.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let func = item.get("function")?;
            Some(ContextPreviewTool {
                name: func.get("name")?.as_str()?.to_string(),
                description: func
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect()
}

pub(crate) fn format_temporal_context_block() -> String {
    let tz = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    let now = chrono::Local::now();
    let formatted = now.format("%A, %B %d, %Y at %I:%M:%S %p %Z").to_string();
    format!(
        "[TEMPORAL_CONTEXT]\nCurrent local date and time ({tz}): {formatted}\nWhen present, a user message begins with [sent_at=...] (ISO 8601 UTC) for when it was sent.\nUse sent_at together with the current time above to interpret relative dates and whether discussed future plans, events, or deadlines have already passed.\nNever include [sent_at=...] in your replies; it is metadata on user messages only."
    )
}

fn annotate_message_content_for_model(content: &str, timestamp_ms: Option<i64>) -> String {
    let Some(ts) = timestamp_ms else {
        return content.to_string();
    };
    let re = Regex::new(r"^\[sent_at=[^\]]+\]\n").unwrap();
    if re.is_match(content) {
        return content.to_string();
    }
    let sent_at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    format!("[sent_at={sent_at}]\n{content}")
}

pub(crate) fn strip_sent_at_prefix(content: &str) -> String {
    let re = Regex::new(r"\[sent_at=[^\]]+\]\n?").unwrap();
    re.replace_all(content, "").into_owned()
}

pub(crate) fn sorted_memory_entries(user_memory: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = user_memory
        .iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

pub(crate) fn format_memory_context_block(selected: &[(String, String)]) -> String {
    if selected.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "[USER_MEMORY_CONTEXT]".to_string(),
        "Use only if relevant to the current request.".to_string(),
    ];
    for (k, v) in selected {
        lines.push(format!("- {k}: {v}"));
    }
    lines.push(String::new());
    lines.push("[MEMORY_RULES]".into());
    lines.push("- Treat memory as hints, not absolute truth.".into());
    lines.push("- If memory conflicts with the user's current message, follow the current message.".into());
    lines.push("- If uncertain whether memory still applies, ask one brief clarifying question.".into());
    lines.join("\n")
}

#[cfg(test)]
mod context_preview_tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn tool_summaries_include_known_tools() {
        let tools = tool_summaries();
        assert!(tools.iter().any(|t| t.name == "list_directory"));
        assert!(tools.iter().any(|t| t.name == "task_create"));
        assert!(tools
            .iter()
            .all(|t| !t.name.is_empty() && !t.description.is_empty()));
    }

    #[test]
    fn build_system_prompt_includes_memory_and_temporal_blocks() {
        let memory = format_memory_context_block(&[("tone".into(), "concise".into())]);
        let temporal = format_temporal_context_block();
        let fields = fields_from_settings(&json!({}));
        let prompt = build_system_prompt(&fields, "desktop", &memory, "", &temporal);
        assert!(prompt.contains("[CORE_INSTRUCTIONS]"));
        assert!(prompt.contains("[USER_MEMORY_CONTEXT]"));
        assert!(prompt.contains("[TEMPORAL_CONTEXT]"));
    }

    #[test]
    fn sorted_memory_entries_returns_all_facts_sorted() {
        let mut mem = HashMap::new();
        mem.insert("zip".into(), "12528".into());
        mem.insert("alpha".into(), "first".into());
        let selected = sorted_memory_entries(&mem);
        assert_eq!(
            selected,
            vec![("alpha".into(), "first".into()), ("zip".into(), "12528".into())]
        );
    }
}
