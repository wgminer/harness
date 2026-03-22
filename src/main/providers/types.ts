import type { ChatMessage } from "../../shared/types";

export interface LLMProvider {
  id: string;
  sendMessageWithTools(
    messages: ChatMessage[],
    executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
    signal?: AbortSignal
  ): Promise<AsyncIterable<string>>;
  generateTitle(
    previousTitle: string | null,
    context: string,
    model: string
  ): Promise<string | null>;
}

export interface TranscriptionProvider {
  id: string;
  transcribe(audioBuffer: ArrayBuffer): Promise<string>;
}
