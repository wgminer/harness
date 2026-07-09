use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub type WriteChains = Arc<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>;

pub fn new_write_chains() -> WriteChains {
    Arc::new(Mutex::new(HashMap::new()))
}

#[derive(Debug)]
pub struct ParseJsonResult<T> {
    pub value: T,
    pub repaired: bool,
}

pub fn json_extra_data_end_index(err: &serde_json::Error) -> Option<usize> {
    let msg = err.to_string();
    if !msg.to_lowercase().contains("after json") {
        return None;
    }
    let digits: String = msg
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    // fallback regex-like parse
    for token in msg.split_whitespace() {
        if let Ok(n) = token.trim_matches(|c: char| !c.is_ascii_digit()).parse::<usize>() {
            if n > 0 {
                return Some(n);
            }
        }
    }
    digits.parse().ok().filter(|n| *n > 0)
}

pub fn parse_json_utf8<T: DeserializeOwned>(raw: &str) -> Result<ParseJsonResult<T>, serde_json::Error> {
    let text = raw.trim();
    if text.is_empty() {
        return Ok(ParseJsonResult {
            value: serde_json::from_value(Value::Object(Default::default())).unwrap_or_else(|_| {
                panic!("empty object")
            }),
            repaired: false,
        });
    }
    match serde_json::from_str::<T>(text) {
        Ok(value) => Ok(ParseJsonResult {
            value,
            repaired: false,
        }),
        Err(err) => {
            if let Some(end) = json_extra_data_end_index(&err) {
                let partial = &text[..end.min(text.len())];
                let value = serde_json::from_str::<T>(partial)?;
                return Ok(ParseJsonResult {
                    value,
                    repaired: true,
                });
            }
            Err(err)
        }
    }
}

async fn atomic_write_utf8_once(path: &Path, data: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let tmp = format!(
        "{}.tmp.{}.{}",
        path.display(),
        std::process::id(),
        uuid::Uuid::new_v4()
    );
    let mut file = tokio::fs::File::create(&tmp).await?;
    file.write_all(data.as_bytes()).await?;
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(&tmp, path).await.map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e
    })
}

pub async fn atomic_write_utf8(chains: &WriteChains, path: &Path, data: &str) -> std::io::Result<()> {
    let lock = {
        let mut map = chains.lock().await;
        map.entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    };
    let _guard = lock.lock().await;
    atomic_write_utf8_once(path, data).await
}

pub async fn read_json_object_file(path: &Path) -> ParseJsonResult<Value> {
    if !path.exists() {
        return ParseJsonResult {
            value: Value::Object(Default::default()),
            repaired: false,
        };
    }
    let raw = tokio::fs::read_to_string(path).await.unwrap_or_default();
    match parse_json_utf8::<Value>(&raw) {
        Ok(parsed) => {
            if parsed.repaired {
                let stamp = chrono::Utc::now().timestamp_millis();
                let corrupt = format!("{}.corrupt-{}", path.display(), stamp);
                let _ = tokio::fs::write(&corrupt, &raw).await;
                let pretty = serde_json::to_string_pretty(&parsed.value).unwrap_or_default();
                let chains = new_write_chains();
                let _ = atomic_write_utf8(&chains, path, &pretty).await;
            }
            parsed
        }
        Err(_) => ParseJsonResult {
            value: Value::Object(Default::default()),
            repaired: false,
        },
    }
}

pub async fn read_json_array_file<T: DeserializeOwned>(path: &Path) -> Vec<T> {
    if !path.exists() {
        return Vec::new();
    }
    let raw = tokio::fs::read_to_string(path).await.unwrap_or_default();
    let text = raw.trim();
    if text.is_empty() {
        return Vec::new();
    }

    let mut repaired = false;
    let mut corrupt = false;
    let parsed: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(err) => {
            if let Some(end) = json_extra_data_end_index(&err) {
                match serde_json::from_str::<Value>(&text[..end.min(text.len())]) {
                    Ok(v) => {
                        repaired = true;
                        v
                    }
                    Err(_) => {
                        corrupt = true;
                        Value::Array(vec![])
                    }
                }
            } else {
                corrupt = true;
                Value::Array(vec![])
            }
        }
    };

    let arr = parsed.as_array().cloned().unwrap_or_default();
    let value: Vec<T> = arr
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();

    if (repaired || corrupt) && path.exists() {
        if corrupt {
            let stamp = chrono::Utc::now().timestamp_millis();
            let corrupt_path = format!("{}.corrupt-{}", path.display(), stamp);
            let _ = tokio::fs::write(&corrupt_path, &raw).await;
        }
        let pretty = serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| "[]".into());
        let chains = new_write_chains();
        let _ = atomic_write_utf8(&chains, path, &pretty).await;
    }

    value
}

pub async fn file_exists(path: &Path) -> bool {
    tokio::fs::metadata(path).await.is_ok()
}
