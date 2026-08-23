import { DEFAULT_NOTE_TEMPLATES, DEFAULT_NOTE_TEMPLATE_ID } from "./writing";
import { DEFAULT_ACCENT } from "./accent";

export type MessageRole = "user" | "assistant" | "system";

export interface ContextPreviewMemory {
  key: string;
  value: string;
}

export interface ContextPreviewMessage {
  role: string;
  content: string;
}

export interface ContextPreviewTool {
  name: string;
  description: string;
}

export interface ContextPreview {
  selectedMemories: ContextPreviewMemory[];
  systemPrompt: string;
  temporalContext: string;
  memoryBlock: string;
  messages: ContextPreviewMessage[];
  tools: ContextPreviewTool[];
}

export interface RecordingLink {
  path: string;
  filename: string;
  exists: boolean;
  /** File size in bytes when the recording exists on disk. */
  byteSize?: number | null;
  /** Approximate duration from WAV header when available. */
  durationMs?: number | null;
}

export interface ToolCallRecord {
  toolName: string;
  payload?: unknown;
}

export interface SystemPromptPreviewMemory {
  key: string;
  value: string;
}

export interface SystemPromptPreview {
  platform: "desktop" | "ios";
  /** Shared instructions from resources/contracts/systemPrompt.json. */
  shared: string;
  /** Platform overlay from the same contract (desktop | ios). */
  platformOverlay: string;
  /** shared + platform overlay (static portion before runtime blocks). */
  staticPrompt: string;
  /** Desktop chat-mode overlay; empty for chat / iOS. */
  modeOverlay: string;
  /** Mode used when assembling this preview. */
  chatMode: string;
  memoryBlock: string;
  recentConversationsBlock: string;
  temporalContext: string;
  assembledPrompt: string;
  selectedMemories: SystemPromptPreviewMemory[];
  /** Tool schemas on the chat request — sibling to the system prompt, not inside it. */
  tools: SystemPromptPreviewTool[];
}

export interface SystemPromptPreviewTool {
  name: string;
  description: string;
}

export interface MessageAttachment {
  id: string;
  mimeType: string;
  /** Path relative to the app data root (e.g. app-state/chat-attachments/...). */
  relativePath: string;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallRecord[];
  /** When the message was created (ms since epoch). */
  timestamp?: number;
  /** Chat model used for assistant messages; omitted for user/system. */
  model?: string;
  /** Optional image (or other) attachments; preserved across sync rewrites. */
  attachments?: MessageAttachment[];
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
    /** When Fn dictation starts while Harness is unfocused, raise/activate the main window. */
    bringToFrontOnBackgroundDictation: boolean;
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
  notes?: {
    templates: import("./writing").NoteTemplateConfig[];
    /** Template id applied when creating a new note. Defaults to Blank. */
    defaultTemplateId?: string;
  };
  /** Cloudflare R2 remote backup (S3-compatible). Non-secret fields only — secret access key lives in the OS credential store. */
  sync?: {
    accountId: string;
    bucket: string;
    /** Object key prefix, e.g. `harness/`. */
    prefix: string;
    accessKeyId: string;
  };
  chat?: {
    /** When true, app launch opens the centered compose splash instead of restoring the last session. */
    openToComposeOnLaunch: boolean;
    /** When true, selecting text in chat looks up a Tavily image popover. */
    selectionImageLookup: boolean;
  };
  /** Desktop appearance (accent drives derived CSS tokens). */
  appearance?: {
    /** Accent hex (`#rrggbb`). */
    accent?: string;
  };
  /** Defaults for compose ambient weather (US ZIP → Open-Meteo). */
  weather?: {
    /** US ZIP used for compose-corner temperature. */
    defaultZip: string;
  };
}

export interface SearchResult {
  id: string;
  kind: import("./conversationSearch").SearchResultKind;
  title: string | null;
  createdAt: number;
  titleMatched: boolean;
  titleMatchRange: [number, number] | undefined;
  snippet: string;
  snippetMatchRange: [number, number];
  score: number;
}

export type { MemorySearchHit, SearchResultKind } from "./conversationSearch";

export interface LayoutOptions {
  sidebar: "left" | "right";
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  sidebar: "left",
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  openai: {
    apiKey: "",
  },
  recording: {
    autoSend: true,
    globalFnHotkey: true,
    bringToFrontOnBackgroundDictation: false,
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
  notes: {
    templates: DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t })),
    defaultTemplateId: DEFAULT_NOTE_TEMPLATE_ID,
  },
  sync: {
    accountId: "",
    bucket: "",
    prefix: "harness/",
    accessKeyId: "",
  },
  chat: {
    openToComposeOnLaunch: true,
    selectionImageLookup: false,
  },
  appearance: {
    accent: DEFAULT_ACCENT,
  },
  weather: {
    defaultZip: "12528",
  },
};
