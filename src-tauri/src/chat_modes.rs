//! Desktop chat modes from `resources/contracts/chatModes.json`.

use serde::Deserialize;
use serde_json::Value;

const CHAT_MODES_JSON: &str = include_str!("../../resources/contracts/chatModes.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatMode {
    Chat,
    Decide,
    Write,
    Refine,
}

impl ChatMode {
    pub fn as_str(self) -> &'static str {
        match self {
            ChatMode::Chat => "chat",
            ChatMode::Decide => "decide",
            ChatMode::Write => "write",
            ChatMode::Refine => "refine",
        }
    }

    pub fn parse(raw: Option<&str>) -> ChatMode {
        match raw.map(str::trim).unwrap_or("") {
            "decide" => ChatMode::Decide,
            "write" => ChatMode::Write,
            "refine" => ChatMode::Refine,
            _ => ChatMode::Chat,
        }
    }
}

impl Default for ChatMode {
    fn default() -> Self {
        ChatMode::Chat
    }
}

#[derive(Debug, Deserialize)]
struct ChatModeEntry {
    id: String,
    #[serde(rename = "systemOverlay")]
    system_overlay: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChatModesFile {
    modes: Vec<ChatModeEntry>,
}

fn modes_file() -> ChatModesFile {
    serde_json::from_str(CHAT_MODES_JSON).expect("resources/contracts/chatModes.json must parse")
}

/// Overlay text for a mode, or empty string for Chat / unknown.
pub fn mode_overlay(mode: ChatMode) -> String {
    let id = mode.as_str();
    modes_file()
        .modes
        .into_iter()
        .find(|m| m.id == id)
        .and_then(|m| m.system_overlay)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_default()
}

/// JSON value for tests / parity.
pub fn chat_modes_contract_value() -> Value {
    serde_json::from_str(CHAT_MODES_JSON).expect("chatModes.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_has_four_modes() {
        let file = modes_file();
        assert_eq!(file.modes.len(), 4);
        let ids: Vec<_> = file.modes.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["chat", "decide", "write", "refine"]);
    }

    #[test]
    fn chat_has_no_overlay() {
        assert!(mode_overlay(ChatMode::Chat).is_empty());
        assert!(!mode_overlay(ChatMode::Decide).is_empty());
        assert!(!mode_overlay(ChatMode::Write).is_empty());
        assert!(!mode_overlay(ChatMode::Refine).is_empty());
    }
}
