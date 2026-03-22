import OpenAI, { toFile } from "openai";
import type { TranscriptionProvider } from "./types";

export function createOpenAITranscriptionProvider(
  apiKey: string,
  model = "whisper-1"
): TranscriptionProvider {
  return {
    id: "openai-whisper",
    async transcribe(audioBuffer: ArrayBuffer): Promise<string> {
      const client = new OpenAI({ apiKey });
      const file = await toFile(Buffer.from(audioBuffer), "recording.wav", { type: "audio/wav" });
      const response = await client.audio.transcriptions.create({ file, model });
      return response.text;
    },
  };
}
