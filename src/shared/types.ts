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

export interface Settings {
  version: number;
  activeProvider: "openai" | "ollama";
  openai?: {
    apiKey: string;
    model: string;
  };
  ollama?: {
    baseUrl: string;
    model: string;
  };
  recording?: {
    autoSend: boolean;
  };
  /** Chat UI behavior (renderer). */
  chat?: {
    /** Scroll the transcript as the assistant reply streams in; also jump to bottom when a reply starts. */
    scrollOnStream: boolean;
  };
  transcription?: {
    activeProvider: "openai" | "local";
    /** Parakeet (parakeet.cpp) when activeProvider is "local". */
    parakeet?: {
      /** Metal on Apple Silicon; default applied when loading settings on the main process. */
      useGpu: boolean;
      /** Half precision; only applies with useGpu. */
      fp16: boolean;
    };
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
  density: "compact" | "comfortable";
}

export const DEFAULT_LAYOUT: LayoutOptions = {
  sidebar: "left",
  density: "comfortable",
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  activeProvider: "openai",
  openai: {
    apiKey: "",
    model: "gpt-5.2",
  },
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "llama3",
  },
  recording: {
    autoSend: true,
  },
  chat: {
    scrollOnStream: true,
  },
  transcription: {
    activeProvider: "openai",
    parakeet: {
      useGpu: false,
      fp16: false,
    },
  },
};
