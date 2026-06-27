import { RIG_APPEARANCE_TAB_LABEL, RIG_CONTEXT_TAB_LABEL } from "../../shared/rigPage";

export type SettingsTabId =
  | "general"
  | "appearance"
  | "tools"
  | "voice"
  | "notes"
  | "memory"
  | "data";

export type SettingsNavIconId =
  | "SlidersHorizontal"
  | "Palette"
  | "Wrench"
  | "Mic"
  | "FileText"
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
    subtitle: "API & launch",
    icon: "SlidersHorizontal",
    keywords: ["openai", "api", "key", "launch", "compose"],
  },
  {
    id: "appearance",
    label: RIG_APPEARANCE_TAB_LABEL,
    subtitle: "Theme & layout",
    icon: "Palette",
    keywords: ["theme", "color", "font", "grid", "overlay", "typography"],
  },
  {
    id: "tools",
    label: "Tools",
    subtitle: "Weather & search",
    icon: "Wrench",
    keywords: ["weather", "zip", "tavily", "web search"],
  },
  {
    id: "voice",
    label: "Voice",
    subtitle: "Dictation & Fn",
    icon: "Mic",
    keywords: ["transcription", "dictation", "cleanup", "fn", "accessibility", "auto-send", "recordings"],
  },
  {
    id: "notes",
    label: "Editor",
    subtitle: "Note templates",
    icon: "FileText",
    keywords: ["template", "notes", "writing"],
  },
  {
    id: "memory",
    label: RIG_CONTEXT_TAB_LABEL,
    subtitle: "User facts",
    icon: "Brain",
    keywords: ["memory", "context", "facts", "import", "compile", "injection"],
  },
  {
    id: "data",
    label: "Data",
    subtitle: "Sync & backup",
    icon: "Database",
    keywords: ["sync", "backup", "icloud", "import", "chatgpt", "claude", "storage"],
  },
];

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
