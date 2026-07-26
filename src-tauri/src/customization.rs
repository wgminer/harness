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
#[serde(rename_all = "lowercase")]
pub enum WideView {
    Centered,
    Scaled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutOptions {
    pub sidebar: SidebarPosition,
    pub wide_view: WideView,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            sidebar: SidebarPosition::Left,
            wide_view: WideView::Scaled,
        }
    }
}

fn parse_sidebar(raw: Option<&str>) -> SidebarPosition {
    match raw {
        Some("right") => SidebarPosition::Right,
        _ => SidebarPosition::Left,
    }
}

fn parse_wide_view(raw: Option<&str>) -> WideView {
    match raw {
        Some("centered") => WideView::Centered,
        _ => WideView::Scaled,
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
        wide_view: parse_wide_view(parsed.get("wideView").and_then(|v| v.as_str())),
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
        wide_view: options
            .get("wideView")
            .and_then(|v| v.as_str())
            .map(|s| parse_wide_view(Some(s)))
            .unwrap_or(current.wide_view),
    };
    let payload = json!({
        "sidebar": match next.sidebar {
            SidebarPosition::Left => "left",
            SidebarPosition::Right => "right",
        },
        "wideView": match next.wide_view {
            WideView::Centered => "centered",
            WideView::Scaled => "scaled",
        },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_wide_view_defaults_to_scaled() {
        assert_eq!(parse_wide_view(None), WideView::Scaled);
        assert_eq!(parse_wide_view(Some("centered")), WideView::Centered);
        assert_eq!(parse_wide_view(Some("scaled")), WideView::Scaled);
        assert_eq!(parse_wide_view(Some("nope")), WideView::Scaled);
    }

    #[test]
    fn wide_view_merge_preserves_unset_field() {
        let current = LayoutOptions {
            sidebar: SidebarPosition::Right,
            wide_view: WideView::Scaled,
        };
        // Only sidebar provided → wide_view stays scaled
        let next = LayoutOptions {
            sidebar: parse_sidebar(Some("left")),
            wide_view: current.wide_view,
        };
        assert_eq!(next.sidebar, SidebarPosition::Left);
        assert_eq!(next.wide_view, WideView::Scaled);

        // Only wideView provided → sidebar stays right
        let next2 = LayoutOptions {
            sidebar: current.sidebar,
            wide_view: parse_wide_view(Some("centered")),
        };
        assert_eq!(next2.sidebar, SidebarPosition::Right);
        assert_eq!(next2.wide_view, WideView::Centered);
    }
}
