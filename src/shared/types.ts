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
      /** User-editable prompt that guides transcript cleanup behavior. */
      prompt: string;
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
  notes?: {
    templates: import("./writing").NoteTemplateConfig[];
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
      prompt:
        "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.",
    },
  },
  search: {
    tavilyApiKey: "",
  },
  weather: {
    defaultZip: "12528",
  },
  notes: {
    templates: [
      {
        id: "blank",
        title: "Blank",
        description: "Empty",
        content: "# Note\n",
      },
      {
        id: "one-on-one",
        title: "1:1",
        description: "Sync",
        content: [
          "# 1:1",
          "",
          "## Wins",
          "- ",
          "",
          "## Updates",
          "- ",
          "",
          "## Feedback",
          "- ",
          "",
          "## Blockers",
          "- ",
          "",
          "## Next steps",
          "- [ ] ",
        ].join("\n"),
      },
      {
        id: "daily-log",
        title: "Daily log",
        description: "Reflective",
        content: [
          "# Daily Log",
          "",
          "## Wins",
          "- ",
          "",
          "## Focus",
          "- ",
          "",
          "## Blockers",
          "- ",
          "",
          "## Tomorrow",
          "- ",
        ].join("\n"),
      },
    ],
  },
};
