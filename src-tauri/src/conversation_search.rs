//! Library search — conversations, dictations, note titles, image titles.
//! Contract: `resources/contracts/conversationSearch.json`.

use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::memory::{ConversationMeta, ConversationSessionKind, MessageRecord};

const CONTRACT_JSON: &str = include_str!("../../resources/contracts/conversationSearch.json");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Weights {
    title_token: i64,
    body_token: i64,
    message_match: i64,
    all_tokens_bonus: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HrefPrefixes {
    chat: String,
    dictation: String,
    note: String,
    image: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationSearchContract {
    min_token_length: usize,
    stopwords: Vec<String>,
    weights: Weights,
    tool_result_cap: usize,
    excerpt_budget: usize,
    excerpt_count: usize,
    snippet_chars_before: usize,
    snippet_chars_after: usize,
    snippet_max_lines: usize,
    href_prefixes: HrefPrefixes,
}

fn library_href(kind: SearchResultKind, id: &str) -> String {
    let prefixes = &contract().href_prefixes;
    let prefix = match kind {
        SearchResultKind::Chat => &prefixes.chat,
        SearchResultKind::Dictation => &prefixes.dictation,
        SearchResultKind::Note => &prefixes.note,
        SearchResultKind::Image => &prefixes.image,
    };
    format!("{prefix}{id}")
}

fn contract() -> &'static ConversationSearchContract {
    static CONTRACT: OnceLock<ConversationSearchContract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(CONTRACT_JSON)
            .expect("resources/contracts/conversationSearch.json must parse")
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchResultKind {
    Chat,
    Dictation,
    Note,
    Image,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub kind: SearchResultKind,
    pub title: Option<String>,
    pub created_at: i64,
    pub title_matched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_match_range: Option<[usize; 2]>,
    pub snippet: String,
    pub snippet_match_range: [i64; 2],
    pub score: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchHit {
    pub kind: SearchResultKind,
    pub id: String,
    pub title: String,
    pub activity_at: i64,
    pub score: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub excerpts: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub href: String,
}

#[derive(Debug, Clone)]
pub struct SearchTitleCandidate {
    pub id: String,
    pub title: String,
    pub activity_at: i64,
}

#[derive(Debug, Clone)]
pub struct SearchConversationCandidate {
    pub id: String,
    pub meta: ConversationMeta,
    pub messages: Vec<MessageRecord>,
    pub activity_at: i64,
}

pub fn tokenize_query(raw: &str) -> Vec<String> {
    let cfg = contract();
    let stop: HashSet<&str> = cfg.stopwords.iter().map(|s| s.as_str()).collect();
    let re = Regex::new(r"[^a-zA-Z0-9]+").expect("token split regex");
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for token in re.split(raw).filter(|t| !t.is_empty()) {
        let lower = token.to_lowercase();
        if lower.len() < cfg.min_token_length || stop.contains(lower.as_str()) {
            continue;
        }
        if seen.insert(lower.clone()) {
            out.push(lower);
        }
    }
    out
}

fn is_dictation(meta: &ConversationMeta) -> bool {
    if meta.session_kind == Some(ConversationSessionKind::Dictation) {
        return true;
    }
    meta.title
        .as_deref()
        .map(|t| t.trim().starts_with("Dictation @ "))
        .unwrap_or(false)
        && meta.has_assistant_reply != Some(true)
}

fn conversation_kind(meta: &ConversationMeta) -> SearchResultKind {
    if is_dictation(meta) {
        SearchResultKind::Dictation
    } else {
        SearchResultKind::Chat
    }
}

fn strip_sent_at_prefix(content: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^\[sent_at=[^\]]+\]\n?").expect("sent_at regex"));
    re.replace(content, "").to_string()
}

fn find_first_token_match(text: &str, tokens: &[String]) -> Option<(usize, usize)> {
    let lower = text.to_lowercase();
    for token in tokens {
        if let Some(idx) = lower.find(token.as_str()) {
            return Some((idx, token.len()));
        }
    }
    None
}

pub fn extract_snippet(content: &str, match_index: usize, match_len: usize) -> (String, [usize; 2]) {
    let cfg = contract();
    let window_start = match_index.saturating_sub(cfg.snippet_chars_before);
    let match_end_in_content = match_index + match_len;
    let mut snippet_end = (match_end_in_content + cfg.snippet_chars_after).min(content.len());
    let mut snippet_start = window_start;

    if let Some(last_newline_before) = content[..match_index.min(content.len())].rfind('\n') {
        if last_newline_before >= window_start {
            snippet_start = last_newline_before + 1;
        }
    }
    if match_end_in_content < content.len() {
        if let Some(next_newline_after) = content[match_end_in_content..].find('\n') {
            let idx = match_end_in_content + next_newline_after;
            if idx <= snippet_end {
                snippet_end = idx + 1;
            }
        }
    }

    let mut line_count = 1usize;
    for ch in content[snippet_start..snippet_end].chars() {
        if ch == '\n' {
            line_count += 1;
        }
        if line_count >= cfg.snippet_max_lines {
            break;
        }
    }
    if line_count >= cfg.snippet_max_lines {
        let first = content[snippet_start..].find('\n').map(|i| snippet_start + i);
        if let Some(first_nl) = first {
            if let Some(second_nl) = content[first_nl + 1..].find('\n') {
                let end = first_nl + 1 + second_nl + 1;
                if end < snippet_end {
                    snippet_end = end;
                }
            }
        }
    }

    let snippet = content[snippet_start..snippet_end].to_string();
    let match_start_in_snippet = match_index.saturating_sub(snippet_start);
    let match_end_in_snippet = match_start_in_snippet + match_len;
    let clamped_start = match_start_in_snippet.min(snippet.len());
    let clamped_end = clamped_start.max(match_end_in_snippet.min(snippet.len()));
    (snippet, [clamped_start, clamped_end])
}

fn score_tokens_in_text(text: &str, tokens: &[String], per_token: i64) -> i64 {
    if tokens.is_empty() || text.trim().is_empty() {
        return 0;
    }
    let lower = text.to_lowercase();
    let mut score = 0i64;
    let mut matched = 0usize;
    for token in tokens {
        if lower.contains(token.as_str()) {
            score += per_token;
            matched += 1;
        }
    }
    if matched == tokens.len() && tokens.len() > 1 {
        score += contract().weights.all_tokens_bonus;
    }
    score
}

struct ConversationScore {
    score: i64,
    title_matched: bool,
    title_match_range: Option<[usize; 2]>,
    snippet: String,
    snippet_match_range: [i64; 2],
    match_count: usize,
    excerpts: Vec<String>,
}

fn score_conversation(candidate: &SearchConversationCandidate, tokens: &[String]) -> Option<ConversationScore> {
    if tokens.is_empty() {
        return None;
    }
    let cfg = contract();
    let title_str = candidate.meta.title.clone().unwrap_or_default();
    let mut score = score_tokens_in_text(&title_str, tokens, cfg.weights.title_token);
    let title_matched = tokens.iter().any(|t| title_str.to_lowercase().contains(t.as_str()));
    let title_match_range = if title_matched {
        find_first_token_match(&title_str, tokens).map(|(idx, len)| [idx, idx + len])
    } else {
        None
    };

    let mut match_count = 0usize;
    let mut excerpt_sources: Vec<String> = Vec::new();
    let mut best_snippet = String::new();
    let mut best_snippet_range = [-1i64, -1i64];

    for message in &candidate.messages {
        let stripped = strip_sent_at_prefix(message.content.trim());
        if stripped.is_empty() {
            continue;
        }
        let body_score = score_tokens_in_text(&stripped, tokens, cfg.weights.body_token);
        if body_score > 0 {
            match_count += 1;
            score += body_score + cfg.weights.message_match;
            excerpt_sources.push(stripped.clone());
            if best_snippet_range[0] < 0 {
                if let Some((idx, len)) = find_first_token_match(&stripped, tokens) {
                    let (snippet, range) = extract_snippet(&stripped, idx, len);
                    best_snippet = snippet;
                    best_snippet_range = [range[0] as i64, range[1] as i64];
                }
            }
        }
    }

    if score <= 0 {
        return None;
    }

    if best_snippet.is_empty() && title_matched {
        let first = candidate
            .messages
            .iter()
            .find(|m| !m.content.trim().is_empty())
            .map(|m| m.content.as_str())
            .unwrap_or("");
        let lines: Vec<&str> = first.lines().take(cfg.snippet_max_lines).collect();
        best_snippet = lines.join("\n").trim().to_string();
        if best_snippet.is_empty() {
            best_snippet = "No message content".into();
        }
        best_snippet_range = [-1, -1];
    } else if best_snippet.is_empty() {
        best_snippet = excerpt_sources
            .first()
            .map(|s| s.chars().take(cfg.excerpt_budget).collect())
            .unwrap_or_default();
        best_snippet_range = [-1, -1];
    }

    let mut excerpts = Vec::new();
    for source in excerpt_sources.iter().take(cfg.excerpt_count) {
        if let Some((idx, len)) = find_first_token_match(source, tokens) {
            excerpts.push(extract_snippet(source, idx, len).0);
        } else {
            excerpts.push(source.chars().take(cfg.excerpt_budget).collect());
        }
    }

    Some(ConversationScore {
        score,
        title_matched,
        title_match_range,
        snippet: best_snippet,
        snippet_match_range: best_snippet_range,
        match_count,
        excerpts,
    })
}

fn score_title_only(title: &str, tokens: &[String]) -> Option<(i64, Option<[usize; 2]>)> {
    let score = score_tokens_in_text(title, tokens, contract().weights.title_token);
    if score <= 0 {
        return None;
    }
    let range = find_first_token_match(title, tokens).map(|(idx, len)| [idx, idx + len]);
    Some((score, range))
}

pub fn search_conversation_candidates(
    candidates: &[SearchConversationCandidate],
    query: &str,
    exclude_id: Option<&str>,
    require_messages: bool,
) -> Vec<SearchResult> {
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    for candidate in candidates {
        if exclude_id == Some(candidate.id.as_str()) {
            continue;
        }
        if require_messages
            && candidate.meta.has_messages != Some(true)
            && candidate.messages.is_empty()
        {
            continue;
        }
        let Some(scored) = score_conversation(candidate, &tokens) else {
            continue;
        };
        results.push(SearchResult {
            id: candidate.id.clone(),
            kind: conversation_kind(&candidate.meta),
            title: candidate.meta.title.clone(),
            created_at: candidate.meta.created_at,
            title_matched: scored.title_matched,
            title_match_range: scored.title_match_range,
            snippet: scored.snippet,
            snippet_match_range: scored.snippet_match_range,
            score: scored.score,
        });
    }

    results.sort_by(|a, b| b.score.cmp(&a.score).then(b.created_at.cmp(&a.created_at)));
    results
}

pub fn search_title_candidates(
    candidates: &[SearchTitleCandidate],
    query: &str,
    kind: SearchResultKind,
) -> Vec<SearchResult> {
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();
    for candidate in candidates {
        let Some((score, range)) = score_title_only(&candidate.title, &tokens) else {
            continue;
        };
        let snippet_match_range = range
            .map(|r| [r[0] as i64, r[1] as i64])
            .unwrap_or([-1, -1]);
        results.push(SearchResult {
            id: candidate.id.clone(),
            kind,
            title: Some(candidate.title.clone()),
            created_at: candidate.activity_at,
            title_matched: true,
            title_match_range: range,
            snippet: candidate.title.clone(),
            snippet_match_range,
            score,
        });
    }

    results.sort_by(|a, b| b.score.cmp(&a.score).then(b.created_at.cmp(&a.created_at)));
    results
}

pub fn build_memory_search_hits(
    conversations: &[SearchConversationCandidate],
    notes: &[SearchTitleCandidate],
    images: &[SearchTitleCandidate],
    query: &str,
    exclude_conversation_id: Option<&str>,
) -> Vec<MemorySearchHit> {
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return Vec::new();
    }

    let cfg = contract();
    let mut hits = Vec::new();

    for candidate in conversations {
        if exclude_conversation_id == Some(candidate.id.as_str()) {
            continue;
        }
        if candidate.meta.has_messages != Some(true) && candidate.messages.is_empty() {
            continue;
        }
        let Some(scored) = score_conversation(candidate, &tokens) else {
            continue;
        };
        let title = candidate
            .meta
            .title
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .unwrap_or("Untitled chat")
            .to_string();
        let kind = conversation_kind(&candidate.meta);
        hits.push(MemorySearchHit {
            kind,
            id: candidate.id.clone(),
            title,
            activity_at: candidate.activity_at,
            score: scored.score,
            match_count: Some(scored.match_count),
            excerpts: if scored.excerpts.is_empty() {
                None
            } else {
                Some(scored.excerpts)
            },
            snippet: if scored.snippet.is_empty() {
                None
            } else {
                Some(scored.snippet)
            },
            href: library_href(kind, &candidate.id),
        });
    }

    for candidate in notes {
        let Some((score, _)) = score_title_only(&candidate.title, &tokens) else {
            continue;
        };
        hits.push(MemorySearchHit {
            kind: SearchResultKind::Note,
            id: candidate.id.clone(),
            title: candidate.title.clone(),
            activity_at: candidate.activity_at,
            score,
            match_count: None,
            excerpts: None,
            snippet: Some(candidate.title.clone()),
            href: library_href(SearchResultKind::Note, &candidate.id),
        });
    }

    for candidate in images {
        let Some((score, _)) = score_title_only(&candidate.title, &tokens) else {
            continue;
        };
        hits.push(MemorySearchHit {
            kind: SearchResultKind::Image,
            id: candidate.id.clone(),
            title: candidate.title.clone(),
            activity_at: candidate.activity_at,
            score,
            match_count: None,
            excerpts: None,
            snippet: Some(candidate.title.clone()),
            href: library_href(SearchResultKind::Image, &candidate.id),
        });
    }

    hits.sort_by(|a, b| b.score.cmp(&a.score).then(b.activity_at.cmp(&a.activity_at)));
    hits.truncate(cfg.tool_result_cap);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokenize_drops_stopwords() {
        let tokens = tokenize_query("the kitchen renovation");
        assert!(tokens.contains(&"kitchen".to_string()));
        assert!(tokens.contains(&"renovation".to_string()));
        assert!(!tokens.contains(&"the".to_string()));
    }

    #[test]
    fn scores_conversation_by_body_tokens() {
        let candidate = SearchConversationCandidate {
            id: "c1".into(),
            meta: ConversationMeta {
                title: Some("Home".into()),
                created_at: 500,
                is_from_chat_gpt: None,
                chatgpt_id: None,
                is_from_claude: None,
                claude_id: None,
                title_source: None,
                session_kind: Some(ConversationSessionKind::Chat),
                has_assistant_reply: None,
                has_messages: Some(true),
                chat_mode: None,
                dictation_reply_action: None,
            },
            messages: vec![MessageRecord {
                role: "user".into(),
                content: "We are renovating the kitchen".into(),
                tool_calls: None,
                timestamp: Some(500),
                model: None,
                attachments: None,
            }],
            activity_at: 500,
        };
        let results = search_conversation_candidates(&[candidate], "kitchen renovation", None, true);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "c1");
    }

    #[test]
    fn classifies_dictation_kind() {
        let candidate = SearchConversationCandidate {
            id: "d1".into(),
            meta: ConversationMeta {
                title: Some("Dictation @ 3:45 PM".into()),
                created_at: 300,
                is_from_chat_gpt: None,
                chatgpt_id: None,
                is_from_claude: None,
                claude_id: None,
                title_source: None,
                session_kind: Some(ConversationSessionKind::Dictation),
                has_assistant_reply: None,
                has_messages: Some(true),
                chat_mode: None,
                dictation_reply_action: None,
            },
            messages: vec![MessageRecord {
                role: "user".into(),
                content: "Budget meeting".into(),
                tool_calls: None,
                timestamp: Some(300),
                model: None,
                attachments: None,
            }],
            activity_at: 300,
        };
        let results = search_conversation_candidates(&[candidate], "budget", None, true);
        assert_eq!(results[0].kind, SearchResultKind::Dictation);
    }
}
