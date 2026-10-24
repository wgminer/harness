//! Conversion between Harness's stored chat messages and genai's types.
//!
//! An assistant tool round keeps its output as Responses API items in
//! `ChatMessageParam::response_items` (reasoning, text, function calls), the same
//! shape gated-tool checkpoints have always stored, so older checkpoints still load.

use genai::chat::{ChatMessage, ContentPart, MessageContent, Tool, ToolCall, ToolConfig, ToolResponse};
use serde_json::{json, Value};

use crate::openai::{ChatMessageParam, ToolCallParam, ToolFunctionParam};

/// Chat Completions-style tool definitions (`{type, function: {...}}`, the shape of
/// `resources/contracts/tools.json`) as genai tools, never strict.
pub(super) fn genai_tools(tools: &Value) -> Vec<Tool> {
    let Some(defs) = tools.as_array() else {
        return Vec::new();
    };
    defs.iter()
        .filter_map(|def| {
            let function = def.get("function")?;
            let name = function.get("name")?.as_str()?;
            let parameters = function
                .get("parameters")
                .cloned()
                .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
            let description = function.get("description").and_then(|v| v.as_str());
            let mut tool = Tool::new(name.to_string())
                .with_schema(parameters.clone())
                .with_strict(false);
            if let Some(description) = description {
                tool = tool.with_description(description.to_string());
            }
            // genai sends a tool named `web_search` as OpenAI's hosted search; its
            // config is merged over that, so spell out our own function instead.
            if name == "web_search" {
                tool = tool.with_config(ToolConfig::Custom(json!({
                    "type": "function",
                    "name": name,
                    "description": description,
                    "parameters": parameters,
                    "strict": false
                })));
            }
            Some(tool)
        })
        .collect()
}

pub(super) fn to_genai_messages(messages: &[ChatMessageParam]) -> Vec<ChatMessage> {
    let mut out = Vec::new();
    for message in messages {
        let content = message.content.clone().unwrap_or_default();
        match message.role.as_str() {
            "tool" => out.push(ChatMessage::from(ToolResponse::new(
                message.tool_call_id.clone().unwrap_or_default(),
                content,
            ))),
            "system" => out.push(ChatMessage::system(content)),
            "assistant" => {
                let parts = match &message.response_items {
                    Some(items) => parts_from_response_items(items),
                    None => {
                        let mut parts = Vec::new();
                        if !content.is_empty() {
                            parts.push(ContentPart::Text(content));
                        }
                        for call in message.tool_calls.as_deref().unwrap_or(&[]) {
                            parts.push(ContentPart::ToolCall(genai_tool_call(
                                &call.id,
                                &call.function.name,
                                &call.function.arguments,
                            )));
                        }
                        parts
                    }
                };
                if !parts.is_empty() {
                    out.push(ChatMessage::assistant(MessageContent::from_parts(parts)));
                }
            }
            _ => out.push(ChatMessage::user(content)),
        }
    }
    out
}

fn parts_from_response_items(items: &[Value]) -> Vec<ContentPart> {
    let mut parts = Vec::new();
    for item in items {
        match item.get("type").and_then(|v| v.as_str()) {
            Some("reasoning") => {
                if let Some(blob) = item.get("encrypted_content").and_then(|v| v.as_str()) {
                    parts.push(ContentPart::ThoughtSignature(blob.to_string()));
                }
            }
            Some("message") => {
                let text: String = item
                    .get("content")
                    .and_then(|v| v.as_array())
                    .map(|content| {
                        content
                            .iter()
                            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                            .collect()
                    })
                    .unwrap_or_default();
                if !text.is_empty() {
                    parts.push(ContentPart::Text(text));
                }
            }
            Some("function_call") => {
                let (Some(call_id), Some(name)) = (
                    item.get("call_id").and_then(|v| v.as_str()),
                    item.get("name").and_then(|v| v.as_str()),
                ) else {
                    continue;
                };
                let arguments = item.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
                parts.push(ContentPart::ToolCall(genai_tool_call(call_id, name, arguments)));
            }
            _ => {}
        }
    }
    parts
}

fn genai_tool_call(call_id: &str, name: &str, arguments: &str) -> ToolCall {
    ToolCall {
        call_id: call_id.to_string(),
        fn_name: name.to_string(),
        fn_arguments: serde_json::from_str(arguments).unwrap_or_else(|_| json!({})),
        thought_signatures: None,
    }
}

/// Arguments as the JSON text tools receive; genai keeps unparsable ones as a string.
fn arguments_text(arguments: &Value) -> String {
    match arguments {
        Value::String(raw) if raw.trim().is_empty() => "{}".into(),
        Value::String(raw) => raw.clone(),
        Value::Null => "{}".into(),
        other => other.to_string(),
    }
}

pub(super) fn tool_call_params(calls: &[ToolCall]) -> Vec<ToolCallParam> {
    calls
        .iter()
        .filter(|call| !call.call_id.is_empty())
        .map(|call| ToolCallParam {
            id: call.call_id.clone(),
            call_type: "function".into(),
            function: ToolFunctionParam {
                name: call.fn_name.clone(),
                arguments: arguments_text(&call.fn_arguments),
            },
        })
        .collect()
}

/// One round's output as Responses API items, in the order the API emits them.
pub(super) fn response_items(
    signatures: &[String],
    text: &str,
    tool_calls: &[ToolCallParam],
) -> Vec<Value> {
    let mut items: Vec<Value> = signatures
        .iter()
        .map(|blob| json!({ "type": "reasoning", "encrypted_content": blob, "summary": [] }))
        .collect();
    if !text.is_empty() {
        items.push(json!({
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text }]
        }));
    }
    for call in tool_calls {
        items.push(json!({
            "type": "function_call",
            "call_id": call.id,
            "name": call.function.name,
            "arguments": call.function.arguments
        }));
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use genai::chat::ChatRole;

    fn message(role: &str, content: Option<&str>) -> ChatMessageParam {
        ChatMessageParam {
            role: role.into(),
            content: content.map(Into::into),
            tool_calls: None,
            tool_call_id: None,
            response_items: None,
        }
    }

    fn roles(messages: &[ChatMessage]) -> Vec<ChatRole> {
        messages.iter().map(|m| m.role.clone()).collect()
    }

    #[test]
    fn converts_tool_definitions_without_strict() {
        let defs = crate::openai::tool_definitions();
        let tools = genai_tools(&defs);
        assert_eq!(tools.len(), defs.as_array().unwrap().len());
        for tool in &tools {
            assert_eq!(tool.strict, Some(false));
            assert!(tool.schema.as_ref().is_some_and(|s| s.is_object()));
        }
    }

    #[test]
    fn converts_plain_messages_and_drops_empty_assistant() {
        let out = to_genai_messages(&[
            message("system", Some("sys")),
            message("user", Some("hi")),
            message("assistant", Some("")),
            message("assistant", Some("hello")),
        ]);
        assert_eq!(
            roles(&out),
            vec![ChatRole::System, ChatRole::User, ChatRole::Assistant]
        );
        assert_eq!(out[2].content.first_text(), Some("hello"));
    }

    #[test]
    fn replays_response_items_then_tool_output() {
        let mut assistant = message("assistant", None);
        assistant.response_items = Some(vec![
            json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "abc" }),
            json!({ "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "On it." }] }),
            json!({ "type": "function_call", "id": "fc_1", "call_id": "call_a", "name": "x", "arguments": "{\"a\":1}" }),
        ]);
        let mut tool = message("tool", Some("{\"ok\":true}"));
        tool.tool_call_id = Some("call_a".into());

        let out = to_genai_messages(&[assistant, tool]);
        let parts = out[0].content.parts();
        assert!(matches!(&parts[0], ContentPart::ThoughtSignature(s) if s == "abc"));
        assert!(matches!(&parts[1], ContentPart::Text(t) if t == "On it."));
        assert!(matches!(&parts[2], ContentPart::ToolCall(c) if c.call_id == "call_a" && c.fn_arguments == json!({"a": 1})));
        assert!(matches!(
            &out[1].content.parts()[0],
            ContentPart::ToolResponse(r) if r.call_id == "call_a" && r.content == "{\"ok\":true}"
        ));
    }

    /// Gated-tool checkpoints written before the Responses migration have no
    /// `response_items`; they must still load and convert.
    #[test]
    fn converts_legacy_checkpoint_tool_round() {
        let legacy: Vec<ChatMessageParam> = serde_json::from_value(json!([
            { "role": "assistant", "content": "On it.", "tool_calls": [
                { "id": "call_a", "type": "function", "function": { "name": "x", "arguments": "{}" } }
            ] },
            { "role": "tool", "content": "done", "tool_call_id": "call_a" }
        ]))
        .unwrap();
        let out = to_genai_messages(&legacy);
        assert_eq!(roles(&out), vec![ChatRole::Assistant, ChatRole::Tool]);
        let parts = out[0].content.parts();
        assert!(matches!(&parts[0], ContentPart::Text(t) if t == "On it."));
        assert!(matches!(&parts[1], ContentPart::ToolCall(c) if c.fn_name == "x"));
    }

    #[test]
    fn round_items_survive_a_replay() {
        let calls = tool_call_params(&[ToolCall {
            call_id: "call_a".into(),
            fn_name: "get_datetime".into(),
            fn_arguments: json!({}),
            thought_signatures: None,
        }]);
        let items = response_items(&["sig".into()], "", &calls);
        assert_eq!(items.len(), 2);
        let parts = parts_from_response_items(&items);
        assert!(matches!(&parts[0], ContentPart::ThoughtSignature(s) if s == "sig"));
        assert!(matches!(&parts[1], ContentPart::ToolCall(c) if c.fn_name == "get_datetime"));
    }

    #[test]
    fn keeps_unparsable_arguments_and_skips_calls_without_id() {
        let calls = tool_call_params(&[
            ToolCall {
                call_id: "call_a".into(),
                fn_name: "x".into(),
                fn_arguments: Value::String("{\"a\":".into()),
                thought_signatures: None,
            },
            ToolCall {
                call_id: String::new(),
                fn_name: "y".into(),
                fn_arguments: json!({}),
                thought_signatures: None,
            },
        ]);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].function.arguments, "{\"a\":");
    }
}
