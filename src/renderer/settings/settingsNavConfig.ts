import { RIG_APPEARANCE_TAB_LABEL, RIG_MEMORY_TAB_LABEL } from "../../shared/rigPage";

export type SettingsTabId =
  | "general"
  | "appearance"
  | "voice"
  | "memory"
  | "data";

export type SettingsNavIconId =
  | "SlidersHorizontal"
  | "Palette"
  | "Mic"
  | "Brain"
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
    subtitle: "API, tools & launch",
    icon: "SlidersHorizontal",
    keywords: [
      "openai",
      "api",
      "key",
      "launch",
      "compose",
      "tavily",
      "web search",
      "auto-send",
      "facts",
      "memory",
      "injection",
    ],
  },
  {
    id: "appearance",
    label: RIG_APPEARANCE_TAB_LABEL,
    subtitle: "Layout & editor",
    icon: "Palette",
    keywords: ["grid", "overlay", "template", "notes", "writing", "editor", "window", "sticky"],
  },
  {
    id: "voice",
    label: "Voice",
    subtitle: "Dictation & Fn",
    icon: "Mic",
    keywords: ["transcription", "dictation", "cleanup", "fn", "accessibility", "recordings"],
  },
  {
    id: "memory",
    label: RIG_MEMORY_TAB_LABEL,
    subtitle: "Facts & imports",
    icon: "Brain",
    keywords: ["memory", "context", "facts", "import", "system prompt", "prompt"],
  },
  {
    id: "data",
    label: "Data",
    subtitle: "Sync & backup",
    icon: "Database",
    keywords: ["sync", "backup", "icloud", "import", "chatgpt", "claude", "storage"],
  },
];

/** Header tab strip (id + label only). */
export const SETTINGS_TABS: Array<{ id: SettingsTabId; label: string }> = SETTINGS_NAV.map(
  ({ id, label }) => ({ id, label }),
);

export function normalizeSettingsTab(tab: string | undefined): SettingsTabId {
  if (tab === "tools") return "general";
  if (tab === "notes") return "appearance";
  if (
    tab === "general" ||
    tab === "appearance" ||
    tab === "voice" ||
    tab === "memory" ||
    tab === "data"
  ) {
    return tab;
  }
  return "general";
}
