//! Gmail integration: OAuth connection plus the `gmail_*` assistant tools.
//! Tools are attached to chat requests only while an account is connected.

pub mod auth;
mod api;
mod mime;

use futures_util::future::join_all;
use serde::Serialize;
use serde_json::{json, Value};

use crate::credentials::{get_credential, set_credential, CredentialKey};

const TOOL_DEFINITIONS_JSON: &str = include_str!("../../resources/contracts/gmailTools.json");
const SEARCH_DEFAULT: i64 = 10;
const SEARCH_MAX: i64 = 25;
const MODIFY_MAX: usize = 50;
const MESSAGE_BODY_MAX_CHARS: usize = 8_000;
const THREAD_BODY_MAX_CHARS: usize = 30_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailStatus {
    pub client_configured: bool,
    pub connected: bool,
    pub email: Option<String>,
}

pub fn status() -> GmailStatus {
    GmailStatus {
        client_configured: auth::client_config().is_some(),
        connected: auth::is_connected(),
        email: get_credential(CredentialKey::GmailAccountEmail),
    }
}

pub fn set_client(client_id: &str, client_secret: &str) -> Result<(), String> {
    set_credential(CredentialKey::GoogleClientId, client_id).map_err(|e| e.to_string())?;
    set_credential(CredentialKey::GoogleClientSecret, client_secret).map_err(|e| e.to_string())
}

/// Consent flow, then remember which account was connected.
pub async fn connect(open_url: impl FnOnce(&str) -> Result<(), String>) -> Result<GmailStatus, String> {
    auth::connect(open_url).await?;
    if let Ok(email) = api::profile_email().await {
        let _ = set_credential(CredentialKey::GmailAccountEmail, &email);
    }
    Ok(status())
}

pub async fn disconnect() -> Result<GmailStatus, String> {
    auth::disconnect().await?;
    Ok(status())
}

pub fn tool_definitions() -> Value {
    serde_json::from_str(TOOL_DEFINITIONS_JSON)
        .expect("resources/contracts/gmailTools.json must be a valid tool-definitions array")
}

pub fn is_gmail_tool_name(name: &str) -> bool {
    matches!(
        name,
        "gmail_search"
            | "gmail_read_thread"
            | "gmail_list_labels"
            | "gmail_create_draft"
            | "gmail_send"
            | "gmail_modify_threads"
    )
}

/// Tools that change the mailbox wait for Proceed/Cancel.
pub fn is_gated_gmail_tool(name: &str) -> bool {
    matches!(name, "gmail_create_draft" | "gmail_send" | "gmail_modify_threads")
}

fn str_arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(|v| v.as_str()).unwrap_or("").trim()
}

fn string_list(args: &Value, key: &str) -> Vec<String> {
    args.get(key)
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Ids are interpolated into API paths; reject anything that could escape the segment.
fn checked_id<'a>(id: &'a str, what: &str) -> Result<&'a str, String> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        Ok(id)
    } else {
        Err(format!("Invalid Gmail {what} id: '{id}'"))
    }
}

fn truncate_chars(text: &str, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        Some((idx, _)) => (format!("{}…", &text[..idx]), true),
        None => (text.to_string(), false),
    }
}

async fn thread_summary(thread_id: &str) -> Result<Value, String> {
    let thread_id = checked_id(thread_id, "thread")?;
    let query = [
        ("format", "metadata".to_string()),
        ("metadataHeaders", "Subject".to_string()),
        ("metadataHeaders", "From".to_string()),
        ("metadataHeaders", "Date".to_string()),
    ];
    let thread = api::get(&format!("/threads/{thread_id}"), &query).await?;
    let messages = thread
        .get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let first = messages.first().cloned().unwrap_or(Value::Null);
    let last = messages.last().cloned().unwrap_or(Value::Null);
    let unread = messages.iter().any(|m| {
        m.get("labelIds")
            .and_then(|l| l.as_array())
            .is_some_and(|l| l.iter().any(|id| id == "UNREAD"))
    });
    Ok(json!({
        "threadId": thread_id,
        "subject": mime::header(&first["payload"], "Subject").unwrap_or(""),
        "from": mime::header(&last["payload"], "From").unwrap_or(""),
        "date": mime::header(&last["payload"], "Date").unwrap_or(""),
        "snippet": last.get("snippet").and_then(|s| s.as_str()).unwrap_or(""),
        "messageCount": messages.len(),
        "unread": unread,
        "labels": last.get("labelIds").cloned().unwrap_or_else(|| json!([])),
    }))
}

async fn search(args: &Value) -> Result<Value, String> {
    let query = str_arg(args, "query");
    let max = args
        .get("max_results")
        .and_then(|v| v.as_i64())
        .unwrap_or(SEARCH_DEFAULT)
        .clamp(1, SEARCH_MAX);
    let mut params = vec![("maxResults", max.to_string())];
    if query.is_empty() {
        params.push(("labelIds", "INBOX".to_string()));
    } else {
        params.push(("q", query.to_string()));
    }
    let listing = api::get("/threads", &params).await?;
    let ids: Vec<String> = listing
        .get("threads")
        .and_then(|t| t.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|t| t.get("id")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let summaries = join_all(ids.iter().map(|id| thread_summary(id))).await;
    let threads: Vec<Value> = summaries.into_iter().filter_map(Result::ok).collect();
    Ok(json!({ "query": query, "threads": threads }))
}

async fn read_thread(args: &Value) -> Result<Value, String> {
    let thread_id = checked_id(str_arg(args, "thread_id"), "thread")?;
    let thread = api::get(&format!("/threads/{thread_id}"), &[("format", "full".to_string())]).await?;
    let mut budget = THREAD_BODY_MAX_CHARS;
    let mut messages = Vec::new();
    for msg in thread.get("messages").and_then(|m| m.as_array()).into_iter().flatten() {
        let payload = &msg["payload"];
        let (body, truncated) = truncate_chars(&mime::body_text(payload), MESSAGE_BODY_MAX_CHARS.min(budget));
        budget = budget.saturating_sub(body.chars().count());
        let h = |name: &str| mime::header(payload, name).unwrap_or("").to_string();
        messages.push(json!({
            "id": msg.get("id"),
            "from": h("From"),
            "to": h("To"),
            "cc": h("Cc"),
            "date": h("Date"),
            "subject": h("Subject"),
            "labels": msg.get("labelIds"),
            "body": body,
            "bodyTruncated": truncated,
            "attachments": mime::attachment_names(payload),
        }));
    }
    Ok(json!({ "threadId": thread_id, "messages": messages }))
}

async fn list_labels() -> Result<Vec<Value>, String> {
    let res = api::get("/labels", &[]).await?;
    Ok(res
        .get("labels")
        .and_then(|l| l.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|l| json!({ "id": l.get("id"), "name": l.get("name"), "type": l.get("type") }))
        .collect())
}

fn resolve_label_ids(requested: &[String], labels: &[Value]) -> Result<Vec<String>, String> {
    requested
        .iter()
        .map(|want| {
            labels
                .iter()
                .find(|l| {
                    let id = l.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let name = l.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    id == want || name.eq_ignore_ascii_case(want) || id.eq_ignore_ascii_case(want)
                })
                .and_then(|l| l.get("id")?.as_str().map(str::to_string))
                .ok_or_else(|| format!("Unknown Gmail label '{want}'. Call gmail_list_labels for valid names."))
        })
        .collect()
}

/// Build the raw message, adding thread + reply headers when replying.
async fn outgoing_request(args: &Value) -> Result<Value, String> {
    let to = str_arg(args, "to");
    if to.is_empty() {
        return Err("A recipient ('to') is required.".into());
    }
    let reply_id = str_arg(args, "reply_to_message_id");
    let mut subject = str_arg(args, "subject").to_string();
    let mut thread_id = None;
    let mut in_reply_to = None;
    let mut references = None;
    if !reply_id.is_empty() {
        let reply_id = checked_id(reply_id, "message")?;
        let query = [
            ("format", "metadata".to_string()),
            ("metadataHeaders", "Subject".to_string()),
            ("metadataHeaders", "Message-ID".to_string()),
            ("metadataHeaders", "References".to_string()),
        ];
        let original = api::get(&format!("/messages/{reply_id}"), &query).await?;
        let payload = &original["payload"];
        thread_id = original.get("threadId").and_then(|v| v.as_str()).map(str::to_string);
        if let Some(message_id) = mime::header(payload, "Message-ID") {
            in_reply_to = Some(message_id.to_string());
            references = Some(match mime::header(payload, "References") {
                Some(prior) => format!("{prior} {message_id}"),
                None => message_id.to_string(),
            });
        }
        if subject.is_empty() {
            subject = mime::reply_subject(mime::header(payload, "Subject").unwrap_or(""));
        }
    }
    let raw = mime::build_raw(&mime::OutgoingMessage {
        to,
        cc: str_arg(args, "cc"),
        bcc: str_arg(args, "bcc"),
        subject: &subject,
        body: args.get("body").and_then(|v| v.as_str()).unwrap_or(""),
        in_reply_to: in_reply_to.as_deref(),
        references: references.as_deref(),
    });
    let mut message = json!({ "raw": raw });
    if let Some(id) = thread_id {
        message["threadId"] = json!(id);
    }
    Ok(message)
}

async fn create_draft(args: &Value) -> Result<Value, String> {
    let message = outgoing_request(args).await?;
    let draft = api::post("/drafts", &json!({ "message": message })).await?;
    Ok(json!({
        "ok": true,
        "draftId": draft.get("id"),
        "messageId": draft.pointer("/message/id"),
        "threadId": draft.pointer("/message/threadId"),
    }))
}

async fn send(args: &Value) -> Result<Value, String> {
    let message = outgoing_request(args).await?;
    let sent = api::post("/messages/send", &message).await?;
    Ok(json!({ "ok": true, "messageId": sent.get("id"), "threadId": sent.get("threadId") }))
}

async fn modify_threads(args: &Value) -> Result<Value, String> {
    let ids = string_list(args, "thread_ids");
    if ids.is_empty() {
        return Err("gmail_modify_threads requires at least one thread id".into());
    }
    if ids.len() > MODIFY_MAX {
        return Err(format!("At most {MODIFY_MAX} threads per call."));
    }
    for id in &ids {
        checked_id(id, "thread")?;
    }
    let labels = list_labels().await?;
    let add = resolve_label_ids(&string_list(args, "add_labels"), &labels)?;
    let remove = resolve_label_ids(&string_list(args, "remove_labels"), &labels)?;
    if add.is_empty() && remove.is_empty() {
        return Err("Nothing to change: pass add_labels and/or remove_labels.".into());
    }
    let body = json!({ "addLabelIds": add, "removeLabelIds": remove });
    let results = join_all(ids.iter().map(|id| {
        let path = format!("/threads/{id}/modify");
        let body = &body;
        async move { api::post(&path, body).await }
    }))
    .await;
    let failed: Vec<Value> = ids
        .iter()
        .zip(results)
        .filter_map(|(id, r)| r.err().map(|e| json!({ "threadId": id, "error": e })))
        .collect();
    Ok(json!({ "ok": failed.is_empty(), "modified": ids.len() - failed.len(), "failed": failed }))
}

pub async fn execute_gmail_tool(name: &str, args: &Value) -> String {
    let result = match name {
        "gmail_search" => search(args).await,
        "gmail_read_thread" => read_thread(args).await,
        "gmail_list_labels" => list_labels().await.map(|labels| json!({ "labels": labels })),
        "gmail_create_draft" => create_draft(args).await,
        "gmail_send" => send(args).await,
        "gmail_modify_threads" => modify_threads(args).await,
        _ => Err(format!("Unknown Gmail tool: {name}")),
    };
    result
        .unwrap_or_else(|error| json!({ "error": error }))
        .to_string()
}

/// Drop message bodies before a result is persisted with the conversation.
pub fn strip_bodies_for_record(payload: &mut Value) {
    if let Some(messages) = payload.get_mut("messages").and_then(|m| m.as_array_mut()) {
        for msg in messages {
            if let Some(obj) = msg.as_object_mut() {
                obj.remove("body");
            }
        }
    }
}

fn message_preview(args: &Value) -> String {
    let mut lines = vec![format!("To: {}", str_arg(args, "to"))];
    for (label, key) in [("Cc", "cc"), ("Bcc", "bcc")] {
        let value = str_arg(args, key);
        if !value.is_empty() {
            lines.push(format!("{label}: {value}"));
        }
    }
    let subject = str_arg(args, "subject");
    if !subject.is_empty() {
        lines.push(format!("Subject: {subject}"));
    } else if !str_arg(args, "reply_to_message_id").is_empty() {
        lines.push("Subject: (reply)".into());
    }
    lines.push(String::new());
    lines.push(args.get("body").and_then(|v| v.as_str()).unwrap_or("").to_string());
    lines.join("\n")
}

async fn modify_preview(args: &Value) -> String {
    let ids = string_list(args, "thread_ids");
    let mut lines = Vec::new();
    for (label, key) in [("Add", "add_labels"), ("Remove", "remove_labels")] {
        let values = string_list(args, key);
        if !values.is_empty() {
            lines.push(format!("{label}: {}", values.join(", ")));
        }
    }
    lines.push(String::new());
    let summaries = join_all(ids.iter().take(10).map(|id| thread_summary(id))).await;
    for (id, summary) in ids.iter().zip(summaries) {
        let line = summary
            .ok()
            .and_then(|s| {
                let subject = s.get("subject")?.as_str()?.to_string();
                let from = s.get("from")?.as_str()?.to_string();
                Some(format!("{subject} — {from}"))
            })
            .unwrap_or_else(|| id.clone());
        lines.push(line);
    }
    if ids.len() > 10 {
        lines.push(format!("…and {} more", ids.len() - 10));
    }
    lines.join("\n")
}

/// Payload shown in the Proceed/Cancel card before a mailbox change runs.
pub async fn gated_preview(name: &str, args: &Value) -> Value {
    let preview = match name {
        "gmail_modify_threads" => modify_preview(args).await,
        _ => message_preview(args),
    };
    json!({ "preview": preview, "previewKind": "text" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_names_match_dispatch() {
        let defs = tool_definitions();
        let names: Vec<&str> = defs
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t.pointer("/function/name")?.as_str())
            .collect();
        assert_eq!(names.len(), 6);
        for name in names {
            assert!(is_gmail_tool_name(name), "contract tool not dispatched: {name}");
        }
    }

    #[test]
    fn resolves_labels_by_name_or_id() {
        let labels = vec![
            json!({ "id": "INBOX", "name": "INBOX" }),
            json!({ "id": "Label_7", "name": "Receipts" }),
        ];
        let ids = resolve_label_ids(&["inbox".into(), "receipts".into(), "Label_7".into()], &labels).unwrap();
        assert_eq!(ids, vec!["INBOX", "Label_7", "Label_7"]);
        assert!(resolve_label_ids(&["Nope".into()], &labels).is_err());
    }

    #[test]
    fn rejects_path_like_ids() {
        assert!(checked_id("18c2f0a9b1e4d3c2", "thread").is_ok());
        assert!(checked_id("../messages/x/trash", "thread").is_err());
        assert!(checked_id("", "thread").is_err());
    }

    #[test]
    fn truncates_on_char_boundary() {
        let (text, cut) = truncate_chars("h\u{e9}llo", 2);
        assert_eq!(text, "h\u{e9}…");
        assert!(cut);
        assert_eq!(truncate_chars("hi", 5), ("hi".to_string(), false));
    }
}
