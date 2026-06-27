import type { MemoryInjectionStrategy } from "./memoryInjection";
import { DEFAULT_NOTE_TEMPLATES } from "./writing";

export type MessageRole = "user" | "assistant" | "system";

export interface ToolCallRecord {
  toolName: string;
  payload?: unknown;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallRecord[];
  /** When the message was created (ms since epoch). */
  timestamp?: number;
  /** Chat model used for assistant messages; omitted for user/system. */
  model?: string;
}

/** Optional fields when appending a message via IPC / storage. */
export type AppendMessageMeta = {
  toolCalls?: ToolCallRecord[];
  timestamp?: number;
  model?: string;
};

export interface Conversation {
  id: string;
  title?: string;
  createdAt: number;
}

export interface TranscriptDictionaryEntry {
  from: string;
  to: string;
}

export interface Settings {
  version: number;
  /** Legacy shape — secrets are stored in the OS credential store, not on disk. */
  openai?: {
    apiKey?: string;
  };
  recording?: {
    autoSend: boolean;
    /** macOS menu bar icon + global Fn dictation hotkey. */
    globalFnHotkey: boolean;
  };
  transcription?: {
    cleanup?: {
      /** Optional post-transcription cleanup pass via OpenAI (separate from chat model). */
      enabled: boolean;
      /** User-editable prompt that guides transcript cleanup behavior. */
      prompt: string;
    };
    /** Deterministic replacements applied to transcript output (for repeated mishears). */
    dictionary: TranscriptDictionaryEntry[];
  };
  /** Optional Tavily API key for the `web_search` assistant tool. */
  search?: {
    tavilyApiKey?: string;
  };
  /** Defaults for the `get_weather` assistant tool. */
  weather?: {
    /** US ZIP used when the model does not pass one explicitly. */
    defaultZip: string;
  };
  notes?: {
    templates: import("./writing").NoteTemplateConfig[];
  };
  /** Cloudflare R2 remote backup (S3-compatible). Non-secret fields only — secret access key lives in the OS credential store. */
  sync?: {
    accountId: string;
    bucket: string;
    /** Object key prefix, e.g. `harness/`. */
    prefix: string;
    accessKeyId: string;
  };
  /** How stored user facts are injected into the chat system prompt. */
  memory?: {
    injectionStrategy: MemoryInjectionStrategy;
  };
  chat?: {
    /** When true, app launch opens the centered compose splash instead of restoring the last session. */
    openToComposeOnLaunch: boolean;
  };
}

export interface SearchResult {
  id: string;
  title: string | null;
  createdAt: number;
  titleMatched: boolean;
  titleMatchRange: [number, number] | undefined;
  snippet: string;
  snippetMatchRange: [number, number];
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  conversationIds: string[];
  createdAt: number;
}

export interface LayoutOptions {
  sidebar: "left" | "right";
  gridOverlay: "off" | "4" | "8" | "16";
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  sidebar: "left",
  gridOverlay: "off",
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  openai: {
    apiKey: "",
  },
  recording: {
    autoSend: true,
    globalFnHotkey: true,
  },
  transcription: {
    cleanup: {
      enabled: false,
      prompt:
        "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.",
    },
    dictionary: [],
  },
  search: {
    tavilyApiKey: "",
  },
  weather: {
    defaultZip: "12528",
  },
  notes: {
    templates: DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
  },
  sync: {
    accountId: "",
    bucket: "",
    prefix: "harness/",
    accessKeyId: "",
  },
  memory: {
    injectionStrategy: "all",
  },
  chat: {
    openToComposeOnLaunch: true,
  },
};
