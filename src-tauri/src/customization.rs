use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::paths::get_layout_path;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SidebarPosition {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GridOverlay {
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "4")]
    Grid4,
    #[serde(rename = "8")]
    Grid8,
    #[serde(rename = "16")]
    Grid16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutOptions {
    pub sidebar: SidebarPosition,
    pub grid_overlay: GridOverlay,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            sidebar: SidebarPosition::Left,
            grid_overlay: GridOverlay::Off,
        }
    }
}

fn parse_sidebar(raw: Option<&str>) -> SidebarPosition {
    match raw {
        Some("right") => SidebarPosition::Right,
        _ => SidebarPosition::Left,
    }
}

fn parse_grid_overlay(raw: Option<&str>) -> GridOverlay {
    match raw {
        Some("4") => GridOverlay::Grid4,
        Some("8") => GridOverlay::Grid8,
        Some("16") => GridOverlay::Grid16,
        _ => GridOverlay::Off,
    }
}

pub fn get_layout_options() -> LayoutOptions {
    let path = get_layout_path();
    if !path.exists() {
        return LayoutOptions::default();
    }
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let parsed: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    LayoutOptions {
        sidebar: parse_sidebar(parsed.get("sidebar").and_then(|v| v.as_str())),
        grid_overlay: parse_grid_overlay(parsed.get("gridOverlay").and_then(|v| v.as_str())),
    }
}

pub fn set_layout(options: &Value) -> LayoutOptions {
    let current = get_layout_options();
    let next = LayoutOptions {
        sidebar: options
            .get("sidebar")
            .and_then(|v| v.as_str())
            .map(|s| parse_sidebar(Some(s)))
            .unwrap_or(current.sidebar),
        grid_overlay: options
            .get("gridOverlay")
            .and_then(|v| v.as_str())
            .map(|s| parse_grid_overlay(Some(s)))
            .unwrap_or(current.grid_overlay),
    };
    let payload = json!({
        "sidebar": match next.sidebar {
            SidebarPosition::Left => "left",
            SidebarPosition::Right => "right",
        },
        "gridOverlay": match next.grid_overlay {
            GridOverlay::Off => "off",
            GridOverlay::Grid4 => "4",
            GridOverlay::Grid8 => "8",
            GridOverlay::Grid16 => "16",
        }
    });
    let pretty = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{}".into());
    let _ = std::fs::write(get_layout_path(), pretty);
    next
}

pub fn is_customization_tool_name(name: &str) -> bool {
    matches!(name, "set_layout")
}

pub fn execute_customization_tool(name: &str, args: &Value) -> String {
    match name {
        "set_layout" => {
            let layout = set_layout(args);
            serde_json::to_string(&json!({ "ok": true, "layout": layout }))
                .unwrap_or_else(|_| "{\"ok\":true}".into())
        }
        _ => serde_json::to_string(&json!({ "error": format!("Unknown tool: {name}") }))
            .unwrap_or_else(|_| "{\"error\":\"unknown\"}".into()),
    }
}
