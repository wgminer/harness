import { SETTINGS_NOTES_TAB_LABEL } from "../../shared/settingsPage";

export type SettingsTabId = "status" | "general" | "notes" | "voice" | "connections" | "data";

export const SETTINGS_NAV: Array<{
  id: SettingsTabId;
  label: string;
  keywords: string[];
}> = [
  {
    id: "status",
    label: "Status",
    keywords: ["status", "health", "usage", "stats", "ready", "permissions"],
  },
  {
    id: "general",
    label: "General",
    keywords: [
      "theme",
      "dark",
      "light",
      "time",
      "accent",
      "color",
      "cursor",
      "launch",
      "compose",
      "selection",
      "font",
      "reply",
      "image",
      "weather",
      "zip",
    ],
  },
  {
    id: "notes",
    label: SETTINGS_NOTES_TAB_LABEL,
    keywords: ["notes", "editor", "template", "window", "sticky", "cli", "command line", "terminal"],
  },
  {
    id: "voice",
    label: "Voice",
    keywords: [
      "transcription",
      "dictation",
      "cleanup",
      "spelling",
      "glossary",
      "auto-send",
      "fn",
      "shortcut",
      "accessibility",
      "microphone",
      "voice pe",
      "recordings",
      "timing",
    ],
  },
  {
    id: "connections",
    label: "Connections",
    keywords: [
      "openai",
      "api",
      "key",
      "model",
      "provider",
      "claude",
      "anthropic",
      "local",
      "ollama",
      "lm studio",
      "tavily",
      "web search",
      "google",
      "gmail",
      "connection",
    ],
  },
  {
    id: "data",
    label: "Data",
    keywords: [
      "sync",
      "backup",
      "r2",
      "cloudflare",
      "iphone",
      "qr",
      "memory",
      "import",
      "chatgpt",
      "claude",
      "storage",
      "finder",
      "system prompt",
    ],
  },
];

/** Header tab strip (id + label only). */
export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = SETTINGS_NAV.map(
  ({ id, label }) => ({ id, label }),
);

export function normalizeSettingsTab(tab: string | undefined): SettingsTabId {
  if (tab === "tools" || tab === "appearance") return "general";
  if (tab === "accounts" || tab === "model") return "connections";
  if (tab === "memory") return "data";
  if (SETTINGS_NAV.some((item) => item.id === tab)) return tab as SettingsTabId;
  return "status";
}
