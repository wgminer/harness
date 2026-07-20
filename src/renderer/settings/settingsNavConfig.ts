import { RIG_NOTES_TAB_LABEL } from "../../shared/rigPage";

export type SettingsTabId = "general" | "notes" | "voice" | "data";

export type SettingsNavIconId =
  | "SlidersHorizontal"
  | "StickyNote"
  | "Mic"
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
      "accent",
      "color",
      "hex",
      "launch",
      "compose",
      "auto-send",
      "behavior",
      "notes",
      "window",
      "sticky",
      "fn",
      "menu bar",
      "accessibility",
      "microphone",
    ],
  },
  {
    id: "notes",
    label: RIG_NOTES_TAB_LABEL,
    subtitle: "Templates",
    icon: "StickyNote",
    keywords: [
      "notes",
      "writing",
      "editor",
      "template",
      "grid",
      "overlay",
    ],
  },
  {
    id: "voice",
    label: "Voice",
    subtitle: "Dictation & Fn",
    icon: "Mic",
    keywords: ["transcription", "dictation", "cleanup"],
  },
  {
    id: "data",
    label: "Data",
    subtitle: "Keys, memory, sync",
    icon: "Database",
    keywords: [
      "openai",
      "api",
      "key",
      "tavily",
      "web search",
      "memory",
      "facts",
      "sync",
      "backup",
      "icloud",
      "import",
      "chatgpt",
      "claude",
      "storage",
      "paths",
      "finder",
      "recordings",
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
  if (tab === "general" || tab === "notes" || tab === "voice" || tab === "data") {
    return tab;
  }
  return "general";
}
