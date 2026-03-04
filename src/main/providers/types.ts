import type { ChatMessage } from "../../shared/types";

export interface SendMessageOptions {
  stream?: boolean;
}

export interface ChatProvider {
  id: string;
  sendMessage(messages: ChatMessage[], options?: SendMessageOptions): Promise<AsyncIterable<string> | string>;
}

export interface ToolCallResult {
  toolCallId: string;
  result: string;
}
