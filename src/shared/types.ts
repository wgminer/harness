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
  openai?: {
    apiKey: string;
  };
  recording?: {
    autoSend: boolean;
  };
  transcription?: {
    cleanup?: {
      /** Optional post-transcription cleanup pass via OpenAI (separate from chat model). */
      enabled: boolean;
    };
  };
  /** Optional Tavily API key for the `web_search` assistant tool. */
  search?: {
    tavilyApiKey: string;
  };
  /** Defaults for the `get_weather` assistant tool. */
  weather?: {
    /** US ZIP used when the model does not pass one explicitly. */
    defaultZip: string;
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
  openai: {
    apiKey: "",
  },
  recording: {
    autoSend: true,
  },
  transcription: {
    cleanup: {
      enabled: false,
    },
  },
  search: {
    tavilyApiKey: "",
  },
  weather: {
    defaultZip: "12528",
  },
};
