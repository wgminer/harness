//! Local-only map from conversation id → recording filenames under audio-recordings/.

use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
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
    pub byte_size: Option<u64>,
    pub duration_ms: Option<u64>,
}

fn wav_duration_ms(path: &Path, file_len: u64) -> Option<u64> {
    let mut file = File::open(path).ok()?;
    let mut header = [0_u8; 44];
    file.read_exact(&mut header).ok()?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return None;
    }
    let byte_rate = u32::from_le_bytes(header[28..32].try_into().ok()?);
    if byte_rate == 0 {
        return None;
    }
    let data_bytes = if &header[36..40] == b"data" {
        u32::from_le_bytes(header[40..44].try_into().ok()?) as u64
    } else {
        file_len.saturating_sub(44)
    };
    Some(data_bytes.saturating_mul(1000) / u64::from(byte_rate))
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
            let (byte_size, duration_ms) = if exists {
                let byte_size = std::fs::metadata(&path).ok().map(|m| m.len());
                let duration_ms = byte_size.and_then(|len| wav_duration_ms(&path, len));
                (byte_size, duration_ms)
            } else {
                (None, None)
            };
            RecordingLink {
                path: path.display().to_string(),
                filename,
                exists,
                byte_size,
                duration_ms,
            }
        })
        .collect()
}

/// Count regular files in the recordings dir, excluding the local index JSON.
pub fn count_files_in(recordings_dir: &Path) -> u64 {
    archive_stats_in(recordings_dir).file_count
}

pub fn count_files() -> u64 {
    count_files_in(&get_recordings_dir())
}

#[derive(Debug, Clone, Copy, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveStats {
    pub file_count: u64,
    pub duration_ms: u64,
}

/// Sum WAV durations for files in the recordings dir (skips the index JSON).
pub fn archive_stats_in(recordings_dir: &Path) -> ArchiveStats {
    let Ok(entries) = std::fs::read_dir(recordings_dir) else {
        return ArchiveStats::default();
    };
    let mut file_count = 0_u64;
    let mut duration_ms = 0_u64;
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let path = entry.path();
        let name = entry.file_name();
        if name.to_str() == Some(INDEX_FILE_NAME) {
            continue;
        }
        file_count += 1;
        if let Ok(meta) = std::fs::metadata(&path) {
            if let Some(ms) = wav_duration_ms(&path, meta.len()) {
                duration_ms = duration_ms.saturating_add(ms);
            }
        }
    }
    ArchiveStats {
        file_count,
        duration_ms,
    }
}

pub fn archive_stats() -> ArchiveStats {
    archive_stats_in(&get_recordings_dir())
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

    #[test]
    fn count_files_skips_index_and_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let recordings = tmp.path().join("audio-recordings");
        std::fs::create_dir_all(&recordings).expect("mkdir");
        std::fs::write(recordings.join("rec_a.wav"), b"a").expect("wav");
        std::fs::write(recordings.join("rec_b.wav"), b"b").expect("wav");
        std::fs::write(recordings.join(INDEX_FILE_NAME), b"{}").expect("index");
        std::fs::create_dir_all(recordings.join("subdir")).expect("subdir");
        assert_eq!(count_files_in(&recordings), 2);
    }

    #[test]
    fn archive_stats_sums_wav_duration() {
        let sample_rate = 16_000_u32;
        let sample_count = 16_000_u32; // 1s
        let data_bytes = sample_count * 2;
        let mut wav = vec![0_u8; 44 + data_bytes as usize];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
        wav[8..12].copy_from_slice(b"WAVE");
        wav[12..16].copy_from_slice(b"fmt ");
        wav[16..20].copy_from_slice(&16_u32.to_le_bytes());
        wav[20..22].copy_from_slice(&1_u16.to_le_bytes());
        wav[22..24].copy_from_slice(&1_u16.to_le_bytes());
        wav[24..28].copy_from_slice(&sample_rate.to_le_bytes());
        wav[28..32].copy_from_slice(&(sample_rate * 2).to_le_bytes());
        wav[32..34].copy_from_slice(&2_u16.to_le_bytes());
        wav[34..36].copy_from_slice(&16_u16.to_le_bytes());
        wav[36..40].copy_from_slice(b"data");
        wav[40..44].copy_from_slice(&data_bytes.to_le_bytes());

        let tmp = tempfile::tempdir().expect("tempdir");
        let recordings = tmp.path().join("audio-recordings");
        std::fs::create_dir_all(&recordings).expect("mkdir");
        std::fs::write(recordings.join("rec_1s.wav"), &wav).expect("wav1");
        std::fs::write(recordings.join("rec_1s_b.wav"), &wav).expect("wav2");
        std::fs::write(recordings.join(INDEX_FILE_NAME), b"{}").expect("index");

        let stats = archive_stats_in(&recordings);
        assert_eq!(stats.file_count, 2);
        assert_eq!(stats.duration_ms, 2000);
    }

    #[test]
    fn wav_duration_from_pcm_header() {
        // Minimal mono 16-bit 16 kHz WAV with 16000 samples (1s of silence).
        let sample_rate = 16_000_u32;
        let sample_count = 16_000_u32;
        let data_bytes = sample_count * 2;
        let mut wav = vec![0_u8; 44 + data_bytes as usize];
        wav[0..4].copy_from_slice(b"RIFF");
        wav[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
        wav[8..12].copy_from_slice(b"WAVE");
        wav[12..16].copy_from_slice(b"fmt ");
        wav[16..20].copy_from_slice(&16_u32.to_le_bytes());
        wav[20..22].copy_from_slice(&1_u16.to_le_bytes());
        wav[22..24].copy_from_slice(&1_u16.to_le_bytes());
        wav[24..28].copy_from_slice(&sample_rate.to_le_bytes());
        wav[28..32].copy_from_slice(&(sample_rate * 2).to_le_bytes());
        wav[32..34].copy_from_slice(&2_u16.to_le_bytes());
        wav[34..36].copy_from_slice(&16_u16.to_le_bytes());
        wav[36..40].copy_from_slice(b"data");
        wav[40..44].copy_from_slice(&data_bytes.to_le_bytes());

        let tmp = tempfile::tempdir().expect("tempdir");
        let path = tmp.path().join("rec_1s.wav");
        std::fs::write(&path, &wav).expect("write");
        assert_eq!(wav_duration_ms(&path, wav.len() as u64), Some(1000));
    }
}
