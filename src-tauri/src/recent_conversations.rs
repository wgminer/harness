use std::collections::HashSet;

use chrono::{Local, TimeZone, Utc};
use regex::Regex;

use crate::memory::{
    load_conversations_in, load_messages_in, ConversationMeta, MessageRecord, AppState,
};

pub const RECENT_PER_CHAT_BODY_BUDGET: usize = 2000;
pub const RECENT_TOTAL_BODY_BUDGET: usize = 8000;
pub const RECENT_PROTECT_RECENT_COUNT: usize = 3;

#[derive(Debug, Clone)]
pub struct RecentConversationEntry {
    pub id: String,
    pub title: String,
    pub activity_at: i64,
    pub body: String,
}

#[derive(Debug, Clone)]
pub(crate) struct RecentCandidate {
    id: String,
    title: Option<String>,
    created_at: i64,
    activity_at: i64,
    messages: Vec<MessageRecord>,
}

pub async fn build_recent_conversations_block(
    state: &AppState,
    exclude_conversation_id: Option<&str>,
) -> Result<String, std::io::Error> {
    let memory_dir = crate::memory::get_memory_dir();
    let conv = load_conversations_in(state, &memory_dir).await;
    let now_ms = Utc::now().timestamp_millis();
    let mut candidates = Vec::new();

    for (id, meta) in conv {
        if exclude_conversation_id == Some(id.as_str()) {
            continue;
        }
        if !is_list_visible(&meta) {
            continue;
        }
        let messages = load_messages_in(state, &memory_dir, &id).await;
        if messages.is_empty() {
            continue;
        }
        let activity_at = conversation_activity_at(&messages, meta.created_at);
        if clean_dialogue_body(&messages, RECENT_PER_CHAT_BODY_BUDGET)
            .trim()
            .is_empty()
        {
            continue;
        }
        candidates.push(RecentCandidate {
            id,
            title: meta.title,
            created_at: meta.created_at,
            activity_at,
            messages,
        });
    }

    let selected = select_recent_candidates(candidates, now_ms);
    if selected.is_empty() {
        return Ok(String::new());
    }

    let mut entries: Vec<RecentConversationEntry> = selected
        .into_iter()
        .map(|candidate| RecentConversationEntry {
            id: candidate.id,
            title: conversation_display_title(candidate.title.as_deref(), candidate.created_at),
            activity_at: candidate.activity_at,
            body: clean_dialogue_body(&candidate.messages, RECENT_PER_CHAT_BODY_BUDGET),
        })
        .collect();

    apply_total_body_budget(
        &mut entries,
        RECENT_TOTAL_BODY_BUDGET,
        RECENT_PROTECT_RECENT_COUNT,
    );

    Ok(format_recent_conversations_block(&entries, now_ms))
}

fn is_list_visible(meta: &ConversationMeta) -> bool {
    meta.has_messages == Some(true)
}

fn conversation_activity_at(messages: &[MessageRecord], created_at: i64) -> i64 {
    messages
        .iter()
        .filter_map(|m| m.timestamp)
        .max()
        .unwrap_or(created_at)
}

fn conversation_display_title(title: Option<&str>, created_at: i64) -> String {
    let trimmed = title.map(str::trim).unwrap_or("");
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }
    let time = Local
        .timestamp_millis_opt(created_at)
        .single()
        .map(format_sidebar_time)
        .unwrap_or_else(|| "Unknown".to_string());
    format!("Empty chat @ {time}")
}

fn format_sidebar_time(dt: chrono::DateTime<Local>) -> String {
    let hour: u32 = dt.format("%I").to_string().parse().unwrap_or(12);
    format!("{hour}:{} {}", dt.format("%M"), dt.format("%p"))
}

pub(crate) fn select_recent_candidates(
    mut candidates: Vec<RecentCandidate>,
    now_ms: i64,
) -> Vec<RecentCandidate> {
    if candidates.is_empty() {
        return Vec::new();
    }
    candidates.sort_by(|a, b| b.activity_at.cmp(&a.activity_at));

    let top_ids: HashSet<String> = candidates
        .iter()
        .take(RECENT_PROTECT_RECENT_COUNT)
        .map(|c| c.id.clone())
        .collect();
    let today_start = local_day_start_ms(now_ms);
    let today_ids: HashSet<String> = candidates
        .iter()
        .filter(|c| is_same_local_day(c.activity_at, today_start))
        .map(|c| c.id.clone())
        .collect();

    let selected_ids: HashSet<String> = top_ids.union(&today_ids).cloned().collect();
    candidates
        .into_iter()
        .filter(|c| selected_ids.contains(&c.id))
        .collect()
}

fn local_day_start_ms(timestamp_ms: i64) -> i64 {
    let dt = Local.timestamp_millis_opt(timestamp_ms).single().unwrap_or_else(Local::now);
    let start = dt.date_naive().and_hms_opt(0, 0, 0).unwrap();
    Local
        .from_local_datetime(&start)
        .single()
        .map(|d| d.timestamp_millis())
        .unwrap_or(timestamp_ms)
}

fn is_same_local_day(timestamp_ms: i64, day_start_ms: i64) -> bool {
    timestamp_ms >= day_start_ms && timestamp_ms < day_start_ms + 86_400_000
}

pub fn clean_dialogue_body(messages: &[MessageRecord], per_chat_budget: usize) -> String {
    let mut turns: Vec<(String, String)> = Vec::new();
    for message in messages {
        let role = message.role.as_str();
        if role != "user" && role != "assistant" {
            continue;
        }
        let text = strip_sent_at_prefix(message.content.trim());
        if text.is_empty() {
            continue;
        }
        if role == "assistant" {
            let has_tools = message
                .tool_calls
                .as_ref()
                .is_some_and(|calls| !calls.is_empty());
            if has_tools && message.content.trim().is_empty() {
                continue;
            }
        }
        let label = if role == "user" {
            "User"
        } else {
            "Assistant"
        };
        turns.push((label.to_string(), text));
    }

    if turns.is_empty() {
        return String::new();
    }

    window_dialogue_from_end(&turns, per_chat_budget)
}

fn window_dialogue_from_end(turns: &[(String, String)], budget: usize) -> String {
    let mut selected: Vec<(String, String)> = Vec::new();
    let mut used = 0usize;

    for (label, text) in turns.iter().rev() {
        let turn_text = format_turn(label, text);
        let turn_len = char_len(&turn_text);
        if turn_len > budget {
            let tail = truncate_tail(text, budget);
            selected.insert(0, (label.clone(), tail));
            break;
        }
        if !selected.is_empty() && used + turn_len > budget {
            break;
        }
        selected.insert(0, (label.clone(), text.clone()));
        used += turn_len;
    }

    if selected.is_empty() {
        let (label, text) = turns.last().unwrap();
        let tail = truncate_tail(text, budget);
        selected.push((label.clone(), tail));
    }

    selected
        .iter()
        .map(|(label, text)| format_turn(label, text))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn format_turn(label: &str, text: &str) -> String {
    format!("{label}: {text}")
}

fn char_len(text: &str) -> usize {
    text.chars().count()
}

fn truncate_tail(text: &str, max_chars: usize) -> String {
    if char_len(text) <= max_chars {
        return text.to_string();
    }
    let keep = max_chars.saturating_sub(1);
    let tail: String = text.chars().rev().take(keep).collect::<String>().chars().rev().collect();
    format!("…{tail}")
}

pub fn apply_total_body_budget(
    entries: &mut [RecentConversationEntry],
    total_max: usize,
    protect_count: usize,
) {
    let mut total: usize = entries.iter().map(|e| char_len(&e.body)).sum();
    if total <= total_max {
        return;
    }

    let protect = protect_count.min(entries.len());
    trim_from_oldest(entries, &mut total, total_max, protect, false);
    if total > total_max {
        trim_from_oldest(entries, &mut total, total_max, protect, true);
    }
}

fn trim_from_oldest(
    entries: &mut [RecentConversationEntry],
    total: &mut usize,
    total_max: usize,
    protect: usize,
    include_protected: bool,
) {
    for index in (0..entries.len()).rev() {
        if *total <= total_max {
            break;
        }
        if index < protect && !include_protected {
            continue;
        }
        let entry = &mut entries[index];
        let body_len = char_len(&entry.body);
        let excess = total.saturating_sub(total_max);
        if body_len <= excess {
            *total -= body_len;
            entry.body.clear();
            continue;
        }
        let new_len = body_len.saturating_sub(excess);
        entry.body = truncate_head(&entry.body, new_len);
        *total = entries.iter().map(|e| char_len(&e.body)).sum();
    }
}

fn truncate_head(text: &str, max_chars: usize) -> String {
    if char_len(text) <= max_chars {
        return text.to_string();
    }
    let trimmed: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{trimmed}…")
}

pub fn format_recent_conversations_block(entries: &[RecentConversationEntry], now_ms: i64) -> String {
    let mut lines = vec![
        "[RECENT_CONVERSATIONS]".to_string(),
        "Other recent chats for continuity (newest first). Bodies may be truncated.".to_string(),
        String::new(),
    ];

    for entry in entries {
        if entry.body.trim().is_empty() {
            continue;
        }
        lines.push(format!("--- {}", entry.title));
        lines.push(format_activity_line(entry.activity_at, now_ms));
        lines.push(String::new());
        lines.push(entry.body.clone());
        lines.push(String::new());
    }

    lines.join("\n").trim_end().to_string()
}

fn format_activity_line(activity_at: i64, now_ms: i64) -> String {
    let absolute = Local
        .timestamp_millis_opt(activity_at)
        .single()
        .map(|dt| dt.format("%A, %B %d, %Y at %I:%M:%S %p %Z").to_string())
        .unwrap_or_else(|| "Unknown time".to_string());
    let relative = format_relative_hint(activity_at, now_ms);
    format!("Last active: {absolute} ({relative})")
}

fn format_relative_hint(activity_at: i64, now_ms: i64) -> String {
    let delta_ms = now_ms.saturating_sub(activity_at);
    let minutes = delta_ms / 60_000;
    if minutes < 1 {
        return "just now".to_string();
    }
    if minutes < 60 {
        return format!("{minutes} minute{} ago", if minutes == 1 { "" } else { "s" });
    }
    let hours = minutes / 60;
    if hours < 24 {
        return format!("{hours} hour{} ago", if hours == 1 { "" } else { "s" });
    }
    let days = hours / 24;
    if days == 1 {
        return "yesterday".to_string();
    }
    if days < 7 {
        return format!("{days} days ago");
    }
    let weeks = days / 7;
    format!("{weeks} week{} ago", if weeks == 1 { "" } else { "s" })
}

fn strip_sent_at_prefix(content: &str) -> String {
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\[sent_at=[^\]]+\]\n?").unwrap());
    re.replace_all(content, "").into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory::ToolCallRecord;

    fn msg(role: &str, content: &str, ts: i64) -> MessageRecord {
        MessageRecord {
            role: role.to_string(),
            content: content.to_string(),
            tool_calls: None,
            timestamp: Some(ts),
            model: None,
        }
    }

    #[test]
    fn clean_dialogue_keeps_user_assistant_and_windows_from_end() {
        let messages = vec![
            msg("system", "ignore", 1),
            msg("user", "old", 2),
            msg("assistant", "old reply", 3),
            msg("user", "new question", 4),
            msg("assistant", "new answer", 5),
        ];
        let body = clean_dialogue_body(&messages, 50);
        assert!(body.contains("User: new question"));
        assert!(body.contains("Assistant: new answer"));
        assert!(!body.contains("old reply"));
    }

    #[test]
    fn clean_dialogue_drops_tool_only_assistant() {
        let messages = vec![MessageRecord {
            role: "assistant".to_string(),
            content: String::new(),
            tool_calls: Some(vec![ToolCallRecord {
                tool_name: "task_list".to_string(),
                payload: None,
            }]),
            timestamp: Some(1),
            model: None,
        }];
        assert!(clean_dialogue_body(&messages, 2000).is_empty());
    }

    #[test]
    fn clean_dialogue_truncates_oversized_turn_from_tail() {
        let long = "x".repeat(2500);
        let messages = vec![msg("user", &long, 1)];
        let body = clean_dialogue_body(&messages, 2000);
        assert!(body.starts_with("User: …"));
        assert!(body.chars().count() <= 2006);
    }

    #[test]
    fn select_recent_unions_top_three_and_today() {
        let today = Utc::now().timestamp_millis();
        let yesterday = today - 86_400_000;
        let candidates = vec![
            RecentCandidate {
                id: "a".into(),
                title: None,
                created_at: today,
                activity_at: today,
                messages: vec![],
            },
            RecentCandidate {
                id: "b".into(),
                title: None,
                created_at: today - 1,
                activity_at: today - 1,
                messages: vec![],
            },
            RecentCandidate {
                id: "c".into(),
                title: None,
                created_at: yesterday,
                activity_at: yesterday,
                messages: vec![],
            },
            RecentCandidate {
                id: "d".into(),
                title: None,
                created_at: yesterday,
                activity_at: yesterday,
                messages: vec![],
            },
            RecentCandidate {
                id: "today-extra".into(),
                title: None,
                created_at: today,
                activity_at: today - 3_600_000,
                messages: vec![],
            },
        ];
        let selected = select_recent_candidates(candidates, today);
        let ids: HashSet<_> = selected.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains("a"));
        assert!(ids.contains("b"));
        assert!(ids.contains("today-extra"));
        assert_eq!(selected.first().map(|c| c.id.as_str()), Some("a"));
    }

    #[test]
    fn apply_total_body_budget_protects_recent_three() {
        let mut entries = vec![
            RecentConversationEntry {
                id: "1".into(),
                title: "One".into(),
                activity_at: 3,
                body: "a".repeat(2500),
            },
            RecentConversationEntry {
                id: "2".into(),
                title: "Two".into(),
                activity_at: 2,
                body: "b".repeat(2500),
            },
            RecentConversationEntry {
                id: "3".into(),
                title: "Three".into(),
                activity_at: 1,
                body: "c".repeat(2500),
            },
            RecentConversationEntry {
                id: "4".into(),
                title: "Four".into(),
                activity_at: 0,
                body: "d".repeat(2500),
            },
        ];
        apply_total_body_budget(&mut entries, 8000, 3);
        let total: usize = entries.iter().map(|e| char_len(&e.body)).sum();
        assert!(total <= 8000, "total was {total}");
        assert_eq!(char_len(&entries[0].body), 2500);
        assert_eq!(char_len(&entries[1].body), 2500);
        assert_eq!(char_len(&entries[2].body), 2500);
        assert_eq!(char_len(&entries[3].body), 500);
    }

    #[test]
    fn format_block_includes_marker() {
        let block = format_recent_conversations_block(
            &[RecentConversationEntry {
                id: "x".into(),
                title: "Test".into(),
                activity_at: Utc::now().timestamp_millis(),
                body: "User: hi\n\nAssistant: hello".into(),
            }],
            Utc::now().timestamp_millis(),
        );
        assert!(block.contains("[RECENT_CONVERSATIONS]"));
        assert!(block.contains("User: hi"));
    }
}
