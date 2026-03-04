export type MessageRole = "user" | "assistant" | "system";

export interface ToolCallRecord {
  toolName: string;
  payload?: unknown;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCallRecord[];
}

export interface Conversation {
  id: string;
  title?: string;
  createdAt: number;
}

export interface Settings {
  version: number;
  activeProvider: string;
  openai?: {
    apiKey: string;
    model: string;
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
};
