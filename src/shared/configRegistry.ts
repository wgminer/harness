import { MEMORY_INJECTION_STRATEGY_OPTIONS } from "./memoryInjection";
import { FONT_MONO_IDS_FOR_SCHEMA, FONT_SIZE_OPTIONS, FONT_UI_IDS_FOR_SCHEMA, THEME_PRESETS } from "./theme";

export type ConfigControlType =
  | "text"
  | "secret"
  | "textarea"
  | "switch"
  | "select"
  | "color"
  | "number"
  | "folder"
  | "list";

export type ConfigStore = "settings" | "theme" | "layout";

export type ConfigListKind = "noteTemplates" | "dictionary" | "memory";

export interface ConfigSelectOption {
  value: string;
  label: string;
}

export interface ConfigEntry {
  id: string;
  group: string;
  label: string;
  description: string;
  control: ConfigControlType;
  store: ConfigStore;
  /** Dot path within the store object (e.g. `transcription.cleanup.enabled`). */
  path: string;
  options?: ConfigSelectOption[];
  listKind?: ConfigListKind;
}

export interface ConfigViewSection {
  title: string;
  lead?: string;
  entryIds: string[];
}

export interface ConfigViewSpec {
  title?: string;
  sections: ConfigViewSection[];
}

const INJECTION_OPTIONS = MEMORY_INJECTION_STRATEGY_OPTIONS.map((o) => ({
  value: o.id,
  label: o.label,
}));

const THEME_PRESET_OPTIONS = THEME_PRESETS.map((p) => ({ value: p.id, label: p.label }));

const FONT_UI_OPTIONS = FONT_UI_IDS_FOR_SCHEMA.map((id) => ({ value: id, label: id }));
const FONT_MONO_OPTIONS = FONT_MONO_IDS_FOR_SCHEMA.map((id) => ({ value: id, label: id }));
const FONT_SIZE_OPTIONS_LIST = FONT_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n}px` }));

export const CONFIG_ENTRIES: ConfigEntry[] = [
  {
    id: "openai.apiKey",
    group: "OpenAI",
    label: "API key",
    description: "OpenAI API key for chat, titles, and transcript cleanup.",
    control: "secret",
    store: "settings",
    path: "openai.apiKey",
  },
  {
    id: "recording.autoSend",
    group: "Voice",
    label: "Auto-send dictation",
    description: "Send the transcript automatically when Fn-key recording stops.",
    control: "switch",
    store: "settings",
    path: "recording.autoSend",
  },
  {
    id: "transcription.cleanup.enabled",
    group: "Voice",
    label: "Transcript cleanup",
    description: "Run an optional cleanup pass on dictation output via OpenAI.",
    control: "switch",
    store: "settings",
    path: "transcription.cleanup.enabled",
  },
  {
    id: "transcription.cleanup.prompt",
    group: "Voice",
    label: "Cleanup prompt",
    description: "Instructions for the transcript cleanup model.",
    control: "textarea",
    store: "settings",
    path: "transcription.cleanup.prompt",
  },
  {
    id: "transcription.dictionary",
    group: "Voice",
    label: "Transcript dictionary",
    description: "Deterministic replacements applied after transcription.",
    control: "list",
    store: "settings",
    path: "transcription.dictionary",
    listKind: "dictionary",
  },
  {
    id: "search.tavilyApiKey",
    group: "Tools",
    label: "Tavily API key",
    description: "API key for the web_search assistant tool.",
    control: "secret",
    store: "settings",
    path: "search.tavilyApiKey",
  },
  {
    id: "weather.defaultZip",
    group: "Tools",
    label: "Default weather ZIP",
    description: "US ZIP used when the model does not pass one to get_weather.",
    control: "text",
    store: "settings",
    path: "weather.defaultZip",
  },
  {
    id: "memory.injectionStrategy",
    group: "Context",
    label: "Memory injection",
    description: "How stored user facts are included in the chat system prompt.",
    control: "select",
    store: "settings",
    path: "memory.injectionStrategy",
    options: INJECTION_OPTIONS,
  },
  {
    id: "memory.userFacts",
    group: "Context",
    label: "User facts",
    description: "Persistent facts about you injected into chat (when enabled).",
    control: "list",
    store: "settings",
    path: "memory.userFacts",
    listKind: "memory",
  },
  {
    id: "notes.templates",
    group: "Notes",
    label: "Note templates",
    description: "Templates available when creating notes.",
    control: "list",
    store: "settings",
    path: "notes.templates",
    listKind: "noteTemplates",
  },
  {
    id: "backup.folderPath",
    group: "Data",
    label: "Backup folder",
    description: "Folder where Harness writes sync bundles.",
    control: "folder",
    store: "settings",
    path: "backup.folderPath",
  },
  {
    id: "theme.preset",
    group: "Appearance",
    label: "Color preset",
    description: "Apply a built-in color palette (typography unchanged).",
    control: "select",
    store: "theme",
    path: "_preset",
    options: THEME_PRESET_OPTIONS,
  },
  {
    id: "theme.accent",
    group: "Appearance",
    label: "Accent color",
    description: "Primary accent color.",
    control: "color",
    store: "theme",
    path: "accent",
  },
  {
    id: "theme.fg",
    group: "Appearance",
    label: "Text color",
    description: "Primary text color.",
    control: "color",
    store: "theme",
    path: "fg",
  },
  {
    id: "theme.bg",
    group: "Appearance",
    label: "Background color",
    description: "Primary background color.",
    control: "color",
    store: "theme",
    path: "bg",
  },
  {
    id: "theme.font",
    group: "Appearance",
    label: "UI font",
    description: "Font for app chrome and UI.",
    control: "select",
    store: "theme",
    path: "font",
    options: FONT_UI_OPTIONS,
  },
  {
    id: "theme.fontMono",
    group: "Appearance",
    label: "Monospace font",
    description: "Font for code blocks and the notes editor.",
    control: "select",
    store: "theme",
    path: "fontMono",
    options: FONT_MONO_OPTIONS,
  },
  {
    id: "theme.fontSize",
    group: "Appearance",
    label: "Base font size",
    description: "Base UI font size in pixels.",
    control: "select",
    store: "theme",
    path: "fontSize",
    options: FONT_SIZE_OPTIONS_LIST,
  },
  {
    id: "layout.sidebar",
    group: "Layout",
    label: "Sidebar position",
    description: "Which side the sidebar appears on.",
    control: "select",
    store: "layout",
    path: "sidebar",
    options: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  {
    id: "layout.gridOverlay",
    group: "Layout",
    label: "Grid overlay",
    description: "Design grid overlay spacing for alignment checks.",
    control: "select",
    store: "layout",
    path: "gridOverlay",
    options: [
      { value: "off", label: "Off" },
      { value: "4", label: "4px" },
      { value: "8", label: "8px" },
      { value: "16", label: "16px" },
    ],
  },
];

const ENTRY_BY_ID = new Map(CONFIG_ENTRIES.map((e) => [e.id, e]));

export function getConfigEntry(id: string): ConfigEntry | undefined {
  return ENTRY_BY_ID.get(id);
}

export function getAllConfigEntryIds(): string[] {
  return CONFIG_ENTRIES.map((e) => e.id);
}

export function buildDefaultViewSpec(): ConfigViewSpec {
  const byGroup = new Map<string, string[]>();
  for (const entry of CONFIG_ENTRIES) {
    const ids = byGroup.get(entry.group) ?? [];
    ids.push(entry.id);
    byGroup.set(entry.group, ids);
  }
  return {
    title: "Config",
    sections: [...byGroup.entries()].map(([title, entryIds]) => ({ title, entryIds })),
  };
}

export function normalizeConfigViewSpec(raw: unknown): ConfigViewSpec | null {
  if (raw == null || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (!Array.isArray(data.sections)) return null;

  const sections: ConfigViewSection[] = [];
  for (const section of data.sections) {
    if (section == null || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!title) continue;
    const entryIds = Array.isArray(s.entryIds)
      ? s.entryIds.filter((id): id is string => typeof id === "string" && ENTRY_BY_ID.has(id))
      : [];
    if (entryIds.length === 0) continue;
    sections.push({
      title,
      lead: typeof s.lead === "string" && s.lead.trim() ? s.lead.trim() : undefined,
      entryIds,
    });
  }

  if (sections.length === 0) return null;

  return {
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : undefined,
    sections,
  };
}

export function validateConfigViewSpec(spec: ConfigViewSpec): string | null {
  for (const section of spec.sections) {
    for (const id of section.entryIds) {
      if (!ENTRY_BY_ID.has(id)) return `Unknown config entry: ${id}`;
    }
  }
  return null;
}
