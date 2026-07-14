use std::collections::HashMap;
use std::time::Duration;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::credentials::resolve_tavily_api_key;
use crate::memory::{AppState, SearchResult};
use crate::notes;
use crate::tasks::{
    clear_completed_tasks, create_task, delete_task, list_tasks, update_task, TasksPayload,
};

const TAVILY_SEARCH_URL: &str = "https://api.tavily.com/search";
const RIG_SECTION_GENERAL: &str = "System → General";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemoryFactsPayload {
    last_action: String,
    memory: HashMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MemorySearchPayload {
    last_action: String,
    query: String,
    results: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchHit {
    title: String,
    url: String,
    snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchResultPayload {
    query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<String>,
    results: Vec<WebSearchHit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

pub fn is_assistant_tool_name(name: &str) -> bool {
    matches!(
        name,
        "task_list"
            | "task_create"
            | "task_update"
            | "task_delete"
            | "task_clear_completed"
            | "memory_set_fact"
            | "memory_list_facts"
            | "memory_search_conversations"
            | "get_datetime"
            | "web_search"
            | "note_list"
            | "note_create"
            | "note_read"
            | "note_save"
            | "note_delete"
    )
}

async fn set_memory_fact(state: &AppState, args: &Value) -> Result<MemoryFactsPayload, std::io::Error> {
    let key = args
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let value = args
        .get("value")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if key.is_empty() {
        let current = crate::memory::get_user_memory(state).await?;
        return Ok(MemoryFactsPayload {
            last_action: "set_fact".into(),
            memory: current,
            key: Some(key),
        });
    }

    crate::memory::set_user_memory(state, &key, &value).await?;
    let memory = crate::memory::get_user_memory(state).await?;
    Ok(MemoryFactsPayload {
        last_action: "set_fact".into(),
        memory,
        key: Some(key),
    })
}

async fn list_memory_facts(state: &AppState) -> Result<MemoryFactsPayload, std::io::Error> {
    let memory = crate::memory::get_user_memory(state).await?;
    Ok(MemoryFactsPayload {
        last_action: "list_facts".into(),
        memory,
        key: None,
    })
}

async fn search_memory_conversations(
    state: &AppState,
    args: &Value,
) -> Result<MemorySearchPayload, std::io::Error> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let results = if query.is_empty() {
        Vec::new()
    } else {
        crate::memory::search_conversations(state, &query, false).await?
    };
    Ok(MemorySearchPayload {
        last_action: "search_conversations".into(),
        query,
        results,
    })
}

fn get_datetime(args: &Value) -> Value {
    let now = Utc::now();
    let requested = args
        .get("timezone")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();

    let timezone = if requested.is_empty() {
        iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into())
    } else {
        match requested.parse::<Tz>() {
            Ok(_) => requested.to_string(),
            Err(_) => {
                return json!({ "error": format!("Invalid timezone: {requested}") });
            }
        }
    };

    let tz: Tz = timezone.parse().unwrap_or(chrono_tz::UTC);
    let local: DateTime<Tz> = now.with_timezone(&tz);
    let utc_iso = now.to_rfc3339();
    let epoch_ms = now.timestamp_millis();
    let offset = local.format("%:z").to_string();
    let local_iso = local.format("%Y-%m-%dT%H:%M:%S").to_string();
    let formatted = local.format("%A, %B %d, %Y at %I:%M:%S %p %Z").to_string();

    json!({
        "epoch_ms": epoch_ms,
        "utc_iso": utc_iso,
        "timezone": timezone,
        "offset": offset,
        "local_iso": local_iso,
        "formatted": formatted
    })
}

async fn search_web_tavily(api_key: &str, query: &str, max_results: i64) -> WebSearchResultPayload {
    let q = query.trim();
    if q.is_empty() {
        return WebSearchResultPayload {
            query: String::new(),
            answer: None,
            results: Vec::new(),
            error: Some("Search query is required".into()),
        };
    }
    if api_key.trim().is_empty() {
        return WebSearchResultPayload {
            query: q.to_string(),
            answer: None,
            results: Vec::new(),
            error: Some(format!(
                "Tavily API key is not set. Add it in {RIG_SECTION_GENERAL}."
            )),
        };
    }

    let n = max_results.clamp(1, 10);
    let client = Client::new();
    let response = client
        .post(TAVILY_SEARCH_URL)
        .json(&json!({
            "api_key": api_key.trim(),
            "query": q,
            "search_depth": "basic",
            "max_results": n,
            "include_answer": false
        }))
        .timeout(Duration::from_secs(45))
        .send()
        .await;

    let response = match response {
        Ok(r) => r,
        Err(err) => {
            return WebSearchResultPayload {
                query: q.to_string(),
                answer: None,
                results: Vec::new(),
                error: Some(err.to_string()),
            };
        }
    };

    let status = response.status();
    let raw: Value = response.json().await.unwrap_or_else(|_| json!({}));
    if !status.is_success() {
        let detail = raw
            .get("detail")
            .and_then(|v| v.as_str())
            .or_else(|| raw.get("message").and_then(|v| v.as_str()))
            .unwrap_or("request failed");
        return WebSearchResultPayload {
            query: q.to_string(),
            answer: None,
            results: Vec::new(),
            error: Some(format!("Tavily error: {detail}")),
        };
    }

    let results = raw
        .get("results")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|row| {
            let title = row.get("title").and_then(|v| v.as_str()).unwrap_or("");
            let url = row.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let content = row.get("content").and_then(|v| v.as_str()).unwrap_or("");
            WebSearchHit {
                title: if title.is_empty() {
                    if url.is_empty() {
                        "Untitled".into()
                    } else {
                        url.to_string()
                    }
                } else {
                    title.to_string()
                },
                url: url.to_string(),
                snippet: content.chars().take(4000).collect(),
            }
        })
        .collect();

    let answer = raw
        .get("answer")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    WebSearchResultPayload {
        query: q.to_string(),
        answer,
        results,
        error: None,
    }
}

async fn fetch_web_search(args: &Value) -> WebSearchResultPayload {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let api_key = resolve_tavily_api_key().await;
    let max_results = args
        .get("max_results")
        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
        .unwrap_or(5.0);
    let max_results = if max_results > 0.0 {
        max_results.floor() as i64
    } else {
        5
    };
    search_web_tavily(&api_key, &query, max_results).await
}

async fn execute_note_tool(state: &AppState, name: &str, args: &Value) -> Value {
    match name {
        "note_list" => match notes::list_notes(state).await {
            Ok(notes) => json!({ "notes": notes }),
            Err(err) => json!({ "error": err.to_string() }),
        },
        "note_create" => {
            let title = args.get("title").and_then(|v| v.as_str());
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let summary = args
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            match notes::create_note(state, title, content).await {
                Ok(note) => {
                    if summary.is_empty() {
                        json!({ "note": note })
                    } else {
                        json!({
                            "note": note,
                            "summary": summary,
                            "attachedToMessage": true,
                        })
                    }
                }
                Err(err) => json!({ "error": err.to_string() }),
            }
        }
        "note_read" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "note_read requires a non-empty 'id' string" });
            }
            match notes::read_note(state, id).await {
                Ok(Some(note)) => json!({ "note": note }),
                Ok(None) => json!({ "error": format!("Note not found: {id}") }),
                Err(err) => json!({ "error": err.to_string() }),
            }
        }
        "note_save" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
            if id.is_empty() {
                return json!({ "error": "note_save requires a non-empty 'id' string" });
            }
            match notes::save_note(state, id, content).await {
                Ok(note) => json!({ "note": note }),
                Err(err) => json!({ "error": err.to_string() }),
            }
        }
        "note_delete" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
            if id.is_empty() {
                return json!({ "error": "note_delete requires a non-empty 'id' string" });
            }
            match notes::delete_note(state, id).await {
                Ok(_) => json!({ "ok": true }),
                Err(err) => json!({ "error": err.to_string() }),
            }
        }
        _ => json!({ "error": format!("Unknown note tool: {name}") }),
    }
}

pub async fn execute_assistant_tool(
    state: &AppState,
    name: &str,
    args: Value,
) -> Result<String, std::io::Error> {
    let payload: Value = match name {
        "task_list" => serde_json::to_value(list_tasks(state).await?)?.into(),
        "task_create" => serde_json::to_value(create_task(state, args).await?)?.into(),
        "task_update" => serde_json::to_value(update_task(state, args).await?)?.into(),
        "task_delete" => serde_json::to_value(delete_task(state, args).await?)?.into(),
        "task_clear_completed" => serde_json::to_value(clear_completed_tasks(state).await?)?.into(),
        "memory_set_fact" => serde_json::to_value(set_memory_fact(state, &args).await?)?.into(),
        "memory_list_facts" => serde_json::to_value(list_memory_facts(state).await?)?.into(),
        "memory_search_conversations" => {
            serde_json::to_value(search_memory_conversations(state, &args).await?)?.into()
        }
        "get_datetime" => get_datetime(&args),
        "web_search" => serde_json::to_value(fetch_web_search(&args).await)?.into(),
        "note_list" | "note_create" | "note_read" | "note_save" | "note_delete" => {
            execute_note_tool(state, name, &args).await
        }
        _ => json!({ "error": format!("Unknown assistant tool: {name}") }),
    };
    Ok(serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into()))
}

pub type TasksPayloadExport = TasksPayload;
