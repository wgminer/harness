import { ipcMain } from "electron";
import { join } from "path";
import OpenAI from "openai";
import {
  CONFIG_ENTRIES,
  buildDefaultViewSpec,
  getConfigEntry,
  normalizeConfigViewSpec,
  validateConfigViewSpec,
  type ConfigEntry,
  type ConfigViewSpec,
} from "../shared/configRegistry";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import type { LayoutOptions, Settings, TranscriptDictionaryEntry } from "../shared/types";
import type { ThemeSettings } from "../shared/theme";
import { coerceFontSizePx } from "../shared/theme";
import { parseMemoryInjectionStrategy } from "../shared/memoryInjection";
import { normalizeNoteTemplates } from "../shared/writing";
import { getSettings, setSettings } from "./settings";
import {
  applyThemePresetForConfig,
  getLayoutOptionsForConfig,
  getThemeSettingsForConfig,
  patchThemeSettingsForConfig,
  setLayoutForConfig,
} from "./customization";
import { getMemoryDir } from "./memory";
import { atomicWriteUtf8, readJsonObjectFile } from "./jsonFile";
import { recordOpenAIUsage } from "./usageStats";

const CONFIG_CANVAS_FILE = "config-canvas.json";

export const CONFIG_CANVAS_TOOL_NAMES = ["render_config_ui", "set_config_value"] as const;

export type ConfigCanvasToolName = (typeof CONFIG_CANVAS_TOOL_NAMES)[number];

export const CONFIG_CANVAS_TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "render_config_ui",
      description:
        "Render a settings UI for the user. Pick catalog entry ids relevant to their request and group them into sections.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Optional page title" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                lead: { type: "string", description: "Optional section description" },
                entryIds: {
                  type: "array",
                  items: { type: "string" },
                  description: "Catalog entry ids to show in this section",
                },
              },
              required: ["title", "entryIds"],
            },
          },
        },
        required: ["sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_config_value",
      description: "Set a configuration value by catalog entry id.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Catalog entry id" },
          value: { description: "New value (type depends on the control)" },
        },
        required: ["id", "value"],
      },
    },
  },
];

function getConfigCanvasPath(): string {
  return join(getMemoryDir(), CONFIG_CANVAS_FILE);
}

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function buildNestedPartial(path: string, value: unknown): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length === 1) return { [parts[0]!]: value };
  return { [parts[0]!]: buildNestedPartial(parts.slice(1).join("."), value) };
}

function buildSettingsPartial(path: string, value: unknown): Partial<Settings> {
  return buildNestedPartial(path, value) as Partial<Settings>;
}

async function readViewSpecFile(): Promise<ConfigViewSpec | null> {
  const { value } = await readJsonObjectFile<Record<string, unknown>>(getConfigCanvasPath());
  return normalizeConfigViewSpec(value);
}

async function saveViewSpec(spec: ConfigViewSpec): Promise<void> {
  const err = validateConfigViewSpec(spec);
  if (err) throw new Error(err);
  await atomicWriteUtf8(getConfigCanvasPath(), JSON.stringify(spec, null, 2));
}

export async function getConfigView(): Promise<ConfigViewSpec> {
  const stored = await readViewSpecFile();
  return stored ?? buildDefaultViewSpec();
}

export function getConfigCatalog(): ConfigEntry[] {
  return [...CONFIG_ENTRIES];
}

export async function getConfigValues(): Promise<Record<string, unknown>> {
  const settings = await getSettings();
  const theme = getThemeSettingsForConfig();
  const layout = getLayoutOptionsForConfig();

  const values: Record<string, unknown> = {};
  for (const entry of CONFIG_ENTRIES) {
    if (entry.id === "theme.preset") {
      values[entry.id] = null;
      continue;
    }
    if (entry.id === "memory.userFacts") {
      values[entry.id] = null;
      continue;
    }
    if (entry.store === "settings") {
      values[entry.id] = getAtPath(settings as unknown as Record<string, unknown>, entry.path);
    } else if (entry.store === "theme") {
      values[entry.id] = getAtPath(theme as unknown as Record<string, unknown>, entry.path);
    } else if (entry.store === "layout") {
      values[entry.id] = getAtPath(layout as unknown as Record<string, unknown>, entry.path);
    }
  }
  return values;
}

export async function setConfigValue(id: string, value: unknown): Promise<void> {
  const entry = getConfigEntry(id);
  if (!entry) throw new Error(`Unknown config entry: ${id}`);

  if (entry.id === "theme.preset") {
    if (typeof value !== "string") throw new Error("Theme preset must be a string id");
    const applied = applyThemePresetForConfig(value);
    if (!applied) throw new Error(`Unknown theme preset: ${value}`);
    return;
  }

  if (entry.id === "memory.userFacts") {
    throw new Error("User facts are edited via the memory list UI, not set_config_value");
  }

  if (entry.store === "settings") {
    if (entry.path === "memory.injectionStrategy") {
      const strategy = parseMemoryInjectionStrategy(value);
      await setSettings({ memory: { injectionStrategy: strategy } });
      return;
    }
    if (entry.path === "notes.templates") {
      await setSettings({ notes: { templates: normalizeNoteTemplates(value) } });
      return;
    }
    if (entry.path === "transcription.dictionary") {
      await setSettings({
        transcription: { dictionary: value as TranscriptDictionaryEntry[] },
      });
      return;
    }
    await setSettings(buildSettingsPartial(entry.path, value));
    return;
  }

  if (entry.store === "theme") {
    if (entry.path === "fontSize") {
      const n = typeof value === "number" ? value : Number(value);
      patchThemeSettingsForConfig({ fontSize: coerceFontSizePx(n) });
      return;
    }
    patchThemeSettingsForConfig({ [entry.path]: value } as Partial<ThemeSettings>);
    return;
  }

  if (entry.store === "layout") {
    setLayoutForConfig({ [entry.path]: value } as Partial<LayoutOptions>);
  }
}

function catalogSummaryForPrompt(): string {
  return JSON.stringify(
    CONFIG_ENTRIES.map((e) => ({
      id: e.id,
      group: e.group,
      label: e.label,
      description: e.description,
      control: e.control,
    })),
  );
}

function executeConfigCanvasTool(
  name: string,
  args: Record<string, unknown>,
  state: { spec: ConfigViewSpec; changedIds: string[] },
): { payload: Record<string, unknown>; spec?: ConfigViewSpec } {
  if (name === "render_config_ui") {
    const rawSpec = {
      title: args.title,
      sections: args.sections,
    };
    const spec = normalizeConfigViewSpec(rawSpec);
    if (!spec) {
      return { payload: { ok: false, error: "Invalid view spec" } };
    }
    const err = validateConfigViewSpec(spec);
    if (err) {
      return { payload: { ok: false, error: err } };
    }
    state.spec = spec;
    return { payload: { ok: true, spec } };
  }

  if (name === "set_config_value") {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id || !getConfigEntry(id)) {
      return { payload: { ok: false, error: `Unknown config entry: ${id || "(missing)"}` } };
    }
    return {
      payload: { ok: true, id, value: args.value, deferred: true },
    };
  }

  return { payload: { ok: false, error: `Unknown tool: ${name}` } };
}

export interface GenerateViewResult {
  spec: ConfigViewSpec;
  changedIds: string[];
  error?: string;
}

export async function generateConfigView(
  userMessage: string,
  currentSpec?: ConfigViewSpec | null,
): Promise<GenerateViewResult> {
  const settings = await getSettings();
  const apiKey = settings.openai?.apiKey?.trim() ?? "";
  if (!apiKey) {
    return {
      spec: currentSpec ?? (await getConfigView()),
      changedIds: [],
      error: "OpenAI API key required. Add one in Config or legacy settings.",
    };
  }

  const client = new OpenAI({ apiKey });
  const values = await getConfigValues();
  const state = {
    spec: currentSpec ?? (await getConfigView()),
    changedIds: [] as string[],
  };
  const pendingValueSets: Array<{ id: string; value: unknown }> = [];

  const system = [
    "You arrange a personal app settings UI for the user.",
    "You have a fixed catalog of configurable entries (ids, labels, controls).",
    "Given the user request, call render_config_ui with only the relevant entry ids grouped into clear sections.",
    "Optionally call set_config_value when the user asks to change a setting value.",
    "Always call render_config_ui at least once so the user sees an updated layout.",
    "",
    "Catalog:",
    catalogSummaryForPrompt(),
    "",
    "Current values:",
    JSON.stringify(values),
    "",
    "Current view spec:",
    JSON.stringify(state.spec),
  ].join("\n");

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: userMessage.trim() || "Show all settings." },
  ];

  for (let round = 0; round < 8; round++) {
    const completion = await client.chat.completions.create({
      model: OPENAI_CHAT_MODEL,
      messages,
      tools: CONFIG_CANVAS_TOOL_DEFINITIONS,
      tool_choice: "auto",
    });

    if (completion.usage) {
      recordOpenAIUsage(completion.usage, OPENAI_CHAT_MODEL);
    }

    const message = completion.choices[0]?.message;
    if (!message?.tool_calls?.length) break;

    messages.push({
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    });

    for (const tc of message.tool_calls) {
      const name = tc.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }

      const result = executeConfigCanvasTool(name, args, state);
      if (name === "set_config_value" && result.payload.ok && result.payload.deferred) {
        pendingValueSets.push({ id: String(result.payload.id), value: args.value });
      }

      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(result.payload),
      });
    }
  }

  for (const { id, value } of pendingValueSets) {
    try {
      await setConfigValue(id, value);
      state.changedIds.push(id);
    } catch (err) {
      messages.push({
        role: "user",
        content: `set_config_value failed for ${id}: ${String(err)}`,
      });
    }
  }

  await saveViewSpec(state.spec);

  return {
    spec: state.spec,
    changedIds: state.changedIds,
  };
}

export function registerConfigCanvasHandlers(): void {
  ipcMain.handle("config:getCatalog", () => getConfigCatalog());
  ipcMain.handle("config:getValues", () => getConfigValues());
  ipcMain.handle("config:setValue", async (_e, id: string, value: unknown) => {
    await setConfigValue(id, value);
    return getConfigValues();
  });
  ipcMain.handle("config:getView", () => getConfigView());
  ipcMain.handle("config:generateView", async (_e, userMessage: string, currentSpec?: ConfigViewSpec | null) =>
    generateConfigView(userMessage, currentSpec ?? null),
  );
}
