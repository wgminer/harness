import { SETTINGS_NOTES_TAB_LABEL } from "../../shared/settingsPage";

export type SettingsTabId = "general" | "notes" | "voice" | "accounts" | "data";

export type SettingsNavIconId =
  | "SlidersHorizontal"
  | "StickyNote"
  | "Mic"
  | "KeyRound"
  | "Database";

export const SETTINGS_NAV: Array<{
  id: SettingsTabId;
  label: string;
  subtitle?: string;
  icon: SettingsNavIconId;
  keywords: string[];
}> = [
  {
    id: "general",
    label: "General",
    subtitle: "Theme & behavior",
    icon: "SlidersHorizontal",
    keywords: [
      "theme",
      "dark",
      "time",
      "tint",
      "sky",
      "accent",
      "color",
      "hex",
      "launch",
      "compose",
      "behavior",
      "selection",
      "image",
      "weather",
      "zip",
      "temperature",
      "cli",
      "command line",
      "terminal",
    ],
  },
  {
    id: "notes",
    label: SETTINGS_NOTES_TAB_LABEL,
    subtitle: "Windows & templates",
    icon: "StickyNote",
    keywords: [
      "notes",
      "writing",
      "editor",
      "template",
      "grid",
      "overlay",
      "window",
      "sticky",
    ],
  },
  {
    id: "voice",
    label: "Voice",
    subtitle: "Dictation & cleanup",
    icon: "Mic",
    keywords: [
      "transcription",
      "dictation",
      "cleanup",
      "spelling",
      "glossary",
      "names",
      "auto-send",
      "fn",
      "menu bar",
      "shortcut",
      "accessibility",
      "microphone",
      "recordings",
      "retry",
    ],
  },
  {
    id: "accounts",
    label: "Accounts",
    subtitle: "Sync, keys, connections",
    icon: "KeyRound",
    keywords: [
      "sync",
      "backup",
      "r2",
      "cloudflare",
      "qr",
      "openai",
      "api",
      "key",
      "tavily",
      "web search",
      "gmail",
      "google",
      "connection",
    ],
  },
  {
    id: "data",
    label: "Data",
    subtitle: "Memory, import, storage",
    icon: "Database",
    keywords: [
      "memory",
      "memories",
      "import",
      "chatgpt",
      "claude",
      "storage",
      "paths",
      "finder",
      "folder",
      "system prompt",
      "prompt",
    ],
  },
];

/** Header tab strip (id + label only). */
export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = SETTINGS_NAV.map(
  ({ id, label }) => ({ id, label }),
);

export function normalizeSettingsTab(tab: string | undefined): SettingsTabId {
  if (tab === "tools") return "general";
  if (tab === "appearance") return "general";
  if (tab === "memory") return "data";
  if (
    tab === "general" ||
    tab === "notes" ||
    tab === "voice" ||
    tab === "accounts" ||
    tab === "data"
  ) {
    return tab;
  }
  return "general";
}
