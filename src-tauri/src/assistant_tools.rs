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
use crate::settings;
use crate::tasks::{
    clear_completed_tasks, create_task, delete_task, list_tasks, update_task, TasksPayload,
};

const TAVILY_SEARCH_URL: &str = "https://api.tavily.com/search";
const ZIPPOPOTAM_URL: &str = "https://api.zippopotam.us/us";
const OPEN_METEO_FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct WeatherLocation {
    zip: String,
    place: String,
    state: String,
    lat: f64,
    lon: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct WeatherCurrent {
    time: String,
    temp_f: f64,
    apparent_f: f64,
    humidity_pct: f64,
    wind_mph: f64,
    wind_gusts_mph: f64,
    precipitation_in: f64,
    weather: String,
    is_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct WeatherDaily {
    date: String,
    weather: String,
    high_f: f64,
    low_f: f64,
    precip_chance_pct: f64,
    precip_sum_in: f64,
    sunrise: String,
    sunset: String,
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
            | "get_weather"
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

fn normalize_zip(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 5 {
        return None;
    }
    Some(digits.chars().take(5).collect())
}

fn describe_weather_code(code: i64) -> String {
    match code {
        0 => "Clear sky".into(),
        1 => "Mainly clear".into(),
        2 => "Partly cloudy".into(),
        3 => "Overcast".into(),
        45 => "Fog".into(),
        48 => "Depositing rime fog".into(),
        51 => "Light drizzle".into(),
        53 => "Drizzle".into(),
        55 => "Heavy drizzle".into(),
        56 => "Light freezing drizzle".into(),
        57 => "Freezing drizzle".into(),
        61 => "Light rain".into(),
        63 => "Rain".into(),
        65 => "Heavy rain".into(),
        66 => "Light freezing rain".into(),
        67 => "Freezing rain".into(),
        71 => "Light snow".into(),
        73 => "Snow".into(),
        75 => "Heavy snow".into(),
        77 => "Snow grains".into(),
        80 => "Rain showers".into(),
        81 => "Heavy rain showers".into(),
        82 => "Violent rain showers".into(),
        85 => "Snow showers".into(),
        86 => "Heavy snow showers".into(),
        95 => "Thunderstorm".into(),
        96 => "Thunderstorm with hail".into(),
        99 => "Thunderstorm with heavy hail".into(),
        other => format!("Weather code {other}"),
    }
}

async fn fetch_json(client: &Client, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("error")
        ));
    }
    response.json().await.map_err(|e| e.to_string())
}

async fn geocode_zip(client: &Client, zip: &str) -> Result<WeatherLocation, String> {
    let data = fetch_json(client, &format!("{ZIPPOPOTAM_URL}/{zip}")).await?;
    let place = data
        .get("places")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    let lat = place
        .get("latitude")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    let lon = place
        .get("longitude")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<f64>().ok())
        .ok_or_else(|| format!("Could not resolve ZIP {zip}"))?;
    Ok(WeatherLocation {
        zip: data
            .get("post code")
            .and_then(|v| v.as_str())
            .unwrap_or(zip)
            .to_string(),
        place: place
            .get("place name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        state: place
            .get("state abbreviation")
            .or_else(|| place.get("state"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        lat,
        lon,
    })
}

async fn fetch_forecast(
    client: &Client,
    location: &WeatherLocation,
    days: i64,
) -> Result<(WeatherCurrent, Vec<WeatherDaily>), String> {
    let days = days.clamp(1, 7);
    let url = format!(
        "{OPEN_METEO_FORECAST_URL}?latitude={}&longitude={}&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,precipitation,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset&forecast_days={days}",
        location.lat, location.lon
    );
    let data = fetch_json(client, &url).await?;
    let current_raw = data.get("current").cloned().unwrap_or_else(|| json!({}));
    let current = WeatherCurrent {
        time: current_raw
            .get("time")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        temp_f: current_raw
            .get("temperature_2m")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN),
        apparent_f: current_raw
            .get("apparent_temperature")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN),
        humidity_pct: current_raw
            .get("relative_humidity_2m")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN),
        wind_mph: current_raw
            .get("wind_speed_10m")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN),
        wind_gusts_mph: current_raw
            .get("wind_gusts_10m")
            .and_then(|v| v.as_f64())
            .unwrap_or(f64::NAN),
        precipitation_in: current_raw
            .get("precipitation")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        weather: describe_weather_code(
            current_raw
                .get("weather_code")
                .and_then(|v| v.as_i64())
                .unwrap_or(-1),
        ),
        is_day: current_raw.get("is_day").and_then(|v| v.as_i64()) == Some(1),
    };

    let daily_raw = data.get("daily").cloned().unwrap_or_else(|| json!({}));
    let times = daily_raw
        .get("time")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut daily = Vec::new();
    for (i, date) in times.iter().enumerate() {
        let date = date.as_str().unwrap_or("").to_string();
        daily.push(WeatherDaily {
            date,
            weather: describe_weather_code(
                daily_raw
                    .get("weather_code")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.get(i))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(-1),
            ),
            high_f: daily_raw
                .get("temperature_2m_max")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_f64())
                .unwrap_or(f64::NAN),
            low_f: daily_raw
                .get("temperature_2m_min")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_f64())
                .unwrap_or(f64::NAN),
            precip_chance_pct: daily_raw
                .get("precipitation_probability_max")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            precip_sum_in: daily_raw
                .get("precipitation_sum")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            sunrise: daily_raw
                .get("sunrise")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            sunset: daily_raw
                .get("sunset")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.get(i))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        });
    }

    Ok((current, daily))
}

async fn get_weather_for_zip(zip: &str, days: i64) -> Value {
    let Some(normalized) = normalize_zip(zip) else {
        return json!({ "error": "Invalid ZIP code (expected 5 US digits)", "zip": zip });
    };
    let client = Client::new();
    match geocode_zip(&client, &normalized).await {
        Ok(location) => match fetch_forecast(&client, &location, days).await {
            Ok((current, daily)) => json!({
                "units": "imperial",
                "location": location,
                "current": current,
                "daily": daily
            }),
            Err(err) => json!({ "error": err, "zip": normalized }),
        },
        Err(err) => json!({ "error": err, "zip": normalized }),
    }
}

async fn fetch_weather(state: &AppState, args: &Value) -> Value {
    let arg_zip = args
        .get("zip")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .unwrap_or("");
    let mut zip = arg_zip.to_string();
    if zip.is_empty() {
        let settings = settings::get_settings(&state.write_chains).await;
        zip = settings
            .get("weather")
            .and_then(|v| v.get("defaultZip"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
    }
    if zip.is_empty() {
        return json!({
            "error": format!("No ZIP provided and no default ZIP is set. Add one in {RIG_SECTION_GENERAL}.")
        });
    }
    let days_raw = args
        .get("days")
        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|n| n as f64)))
        .unwrap_or(3.0);
    let days = if days_raw > 0.0 {
        days_raw.floor().min(7.0) as i64
    } else {
        3
    };
    get_weather_for_zip(&zip, days).await
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
        "get_weather" => fetch_weather(state, &args).await,
        "web_search" => serde_json::to_value(fetch_web_search(&args).await)?.into(),
        "note_list" | "note_create" | "note_read" | "note_save" | "note_delete" => {
            execute_note_tool(state, name, &args).await
        }
        _ => json!({ "error": format!("Unknown assistant tool: {name}") }),
    };
    Ok(serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into()))
}

pub type TasksPayloadExport = TasksPayload;
