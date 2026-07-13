//! Local-only map from conversation id → recording filenames under audio-recordings/.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::paths::get_recordings_dir;

const INDEX_FILE_NAME: &str = "dictation_recordings.json";

fn index_file_in(recordings_dir: &Path) -> PathBuf {
    recordings_dir.join(INDEX_FILE_NAME)
}

fn load_map(recordings_dir: &Path) -> HashMap<String, Vec<String>> {
    let path = index_file_in(recordings_dir);
    let Ok(data) = std::fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(parsed) = serde_json::from_str::<HashMap<String, Value>>(&data) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    for (conversation_id, value) in parsed {
        let filenames = match value {
            Value::String(name) => vec![name],
            Value::Array(items) => items
                .into_iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => continue,
        };
        if !filenames.is_empty() {
            out.insert(conversation_id, filenames);
        }
    }
    out
}

fn save_map(recordings_dir: &Path, map: &HashMap<String, Vec<String>>) -> Result<(), String> {
    std::fs::create_dir_all(recordings_dir).map_err(|e| e.to_string())?;
    let path = index_file_in(recordings_dir);
    let data = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

fn filename_from_path(recording_path: &Path) -> Result<String, String> {
    recording_path
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        .ok_or_else(|| "Invalid recording path.".to_string())
}

pub fn link_in(recordings_dir: &Path, conversation_id: &str, recording_path: &Path) -> Result<(), String> {
    let filename = filename_from_path(recording_path)?;
    let mut map = load_map(recordings_dir);
    let entries = map.entry(conversation_id.to_string()).or_default();
    if !entries.iter().any(|f| f == &filename) {
        entries.push(filename);
    }
    save_map(recordings_dir, &map)
}

pub fn link(conversation_id: &str, recording_path: &Path) -> Result<(), String> {
    link_in(&get_recordings_dir(), conversation_id, recording_path)
}

pub fn list_in(recordings_dir: &Path, conversation_id: &str) -> Vec<PathBuf> {
    let map = load_map(recordings_dir);
    let Some(filenames) = map.get(conversation_id) else {
        return Vec::new();
    };
    filenames
        .iter()
        .map(|name| recordings_dir.join(name))
        .collect()
}

pub fn list(conversation_id: &str) -> Vec<PathBuf> {
    let dir = get_recordings_dir();
    list_in(&dir, conversation_id)
}

pub fn unlink_in(recordings_dir: &Path, conversation_id: &str) {
    let mut map = load_map(recordings_dir);
    if map.remove(conversation_id).is_some() {
        let _ = save_map(recordings_dir, &map);
    }
}

pub fn unlink(conversation_id: &str) {
    unlink_in(&get_recordings_dir(), conversation_id);
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingLink {
    pub path: String,
    pub filename: String,
    pub exists: bool,
}

pub fn list_links(conversation_id: &str) -> Vec<RecordingLink> {
    let dir = get_recordings_dir();
    list_in(&dir, conversation_id)
        .into_iter()
        .map(|path| {
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();
            let exists = path.is_file();
            RecordingLink {
                path: path.display().to_string(),
                filename,
                exists,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_list_unlink_round_trip() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let recordings = tmp.path().join("audio-recordings");
        std::fs::create_dir_all(&recordings).expect("mkdir");
        let wav = recordings.join("rec_123.wav");
        std::fs::write(&wav, b"wav").expect("write wav");

        link_in(&recordings, "conv_a", &wav).expect("link");
        link_in(&recordings, "conv_a", &wav).expect("link again");
        let listed = list_in(&recordings, "conv_a");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0], wav);

        let wav2 = recordings.join("rec_456.wav");
        std::fs::write(&wav2, b"wav2").expect("write wav2");
        link_in(&recordings, "conv_a", &wav2).expect("link second");
        assert_eq!(list_in(&recordings, "conv_a").len(), 2);

        unlink_in(&recordings, "conv_a");
        assert!(list_in(&recordings, "conv_a").is_empty());
    }
}
