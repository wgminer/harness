import { RIG_APPEARANCE_TAB_LABEL, RIG_MEMORY_TAB_LABEL } from "../../shared/rigPage";

export type SettingsTabId =
  | "general"
  | "appearance"
  | "voice"
  | "memory"
  | "data";

/** @deprecated Pre–5-tab layout ids; mapped by {@link normalizeSettingsTab}. */
export type LegacySettingsTabId = "tools" | "notes";

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
      "weather",
      "zip",
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
    subtitle: "Theme, layout & editor",
    icon: "Palette",
    keywords: ["theme", "color", "font", "grid", "overlay", "typography", "template", "notes", "writing", "editor"],
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
    keywords: ["memory", "context", "facts", "import", "compile"],
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

export function filterSettingsNav(query: string): typeof SETTINGS_NAV {
  const q = query.trim().toLowerCase();
  if (!q) return SETTINGS_NAV;
  return SETTINGS_NAV.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.subtitle?.toLowerCase().includes(q) ?? false) ||
      item.keywords.some((kw) => kw.includes(q)),
  );
}
