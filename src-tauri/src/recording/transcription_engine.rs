//! On-device transcription engines from `resources/contracts/transcriptionEngines.json`.
//!
//! Apple Speech is the default and the fallback. Parakeet needs a one-time model
//! download, which runs in the background (`HarnessSpeech --prepare`) so a
//! dictation never waits on it.

use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command as TokioCommand;

use crate::paths::get_speech_models_dir;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptionEngine {
    Apple,
    Parakeet,
}

impl TranscriptionEngine {
    pub fn as_str(self) -> &'static str {
        match self {
            TranscriptionEngine::Apple => "apple",
            TranscriptionEngine::Parakeet => "parakeet",
        }
    }

    pub fn parse(raw: Option<&str>) -> TranscriptionEngine {
        match raw.map(str::trim).unwrap_or("") {
            "parakeet" => TranscriptionEngine::Parakeet,
            _ => TranscriptionEngine::Apple,
        }
    }

    pub fn from_settings(settings: &Value) -> TranscriptionEngine {
        Self::parse(
            settings
                .get("transcription")
                .and_then(|t| t.get("engine"))
                .and_then(|v| v.as_str()),
        )
    }

    /// Helper CLI args for this engine (`--engine`, plus the model cache for Parakeet).
    pub fn helper_args(self) -> Vec<String> {
        match self {
            TranscriptionEngine::Apple => vec!["--engine".into(), "apple".into()],
            TranscriptionEngine::Parakeet => vec![
                "--engine".into(),
                "parakeet".into(),
                "--models-dir".into(),
                get_speech_models_dir().to_string_lossy().into_owned(),
            ],
        }
    }
}

pub const DEFAULT_TRANSCRIPTION_ENGINE: &str = "apple";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// `ready` | `missing` | `downloading` | `failed`
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

enum PrepareState {
    Idle,
    Downloading,
    Failed(String),
}

static PARAKEET_PREPARE: Mutex<PrepareState> = Mutex::new(PrepareState::Idle);

const EXIT_MODELS_NOT_READY: i32 = 6;

fn parakeet_command(exe: &Path, mode: &str) -> TokioCommand {
    let mut cmd = TokioCommand::new(exe);
    cmd.arg(mode)
        .args(TranscriptionEngine::Parakeet.helper_args())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    cmd
}

/// Whether Parakeet models are on disk, or being fetched right now.
pub async fn parakeet_status(exe: &Path) -> EngineStatus {
    {
        let state = PARAKEET_PREPARE.lock().unwrap();
        match &*state {
            PrepareState::Downloading => {
                return EngineStatus { state: "downloading", error: None };
            }
            PrepareState::Failed(err) => {
                return EngineStatus { state: "failed", error: Some(err.clone()) };
            }
            PrepareState::Idle => {}
        }
    }
    match parakeet_command(exe, "--check").output().await {
        Ok(out) if out.status.success() => EngineStatus { state: "ready", error: None },
        Ok(out) if out.status.code() == Some(EXIT_MODELS_NOT_READY) => {
            EngineStatus { state: "missing", error: None }
        }
        Ok(out) => EngineStatus {
            state: "failed",
            error: Some(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        },
        Err(err) => EngineStatus { state: "failed", error: Some(err.to_string()) },
    }
}

/// Start the one-time Parakeet download + compile in the background. No-op while one runs.
pub fn start_parakeet_prepare(exe: &Path) {
    {
        let mut state = PARAKEET_PREPARE.lock().unwrap();
        if matches!(*state, PrepareState::Downloading) {
            return;
        }
        *state = PrepareState::Downloading;
    }
    let mut cmd = parakeet_command(exe, "--prepare");
    tauri::async_runtime::spawn(async move {
        let next = match cmd.output().await {
            Ok(out) if out.status.success() => PrepareState::Idle,
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                PrepareState::Failed(if stderr.is_empty() {
                    format!("Parakeet download failed (exit {:?}).", out.status.code())
                } else {
                    stderr
                })
            }
            Err(err) => PrepareState::Failed(err.to_string()),
        };
        *PARAKEET_PREPARE.lock().unwrap() = next;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct EngineEntry {
        id: String,
    }

    #[derive(Debug, Deserialize)]
    struct EnginesFile {
        default: String,
        engines: Vec<EngineEntry>,
    }

    const TRANSCRIPTION_ENGINES_JSON: &str =
        include_str!("../../../resources/contracts/transcriptionEngines.json");

    fn contract() -> EnginesFile {
        serde_json::from_str(TRANSCRIPTION_ENGINES_JSON)
            .expect("resources/contracts/transcriptionEngines.json must parse")
    }

    #[test]
    fn contract_ids_match_enum() {
        let file = contract();
        let ids: Vec<_> = file.engines.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            [TranscriptionEngine::Apple.as_str(), TranscriptionEngine::Parakeet.as_str()]
        );
        assert_eq!(file.default, DEFAULT_TRANSCRIPTION_ENGINE);
        assert_eq!(
            TranscriptionEngine::parse(Some(&file.default)).as_str(),
            DEFAULT_TRANSCRIPTION_ENGINE
        );
    }

    #[test]
    fn unknown_engine_falls_back_to_apple() {
        assert_eq!(TranscriptionEngine::parse(Some("whisper")), TranscriptionEngine::Apple);
        assert_eq!(TranscriptionEngine::parse(None), TranscriptionEngine::Apple);
    }
}
