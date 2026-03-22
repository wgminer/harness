import OpenAI, { toFile } from "openai";
import type { TranscriptionProvider } from "./types";

/**
 * Creates a transcription provider backed by any local Whisper-compatible server.
 * Compatible with whisper.cpp (--server flag) and faster-whisper-server,
 * both of which expose a /v1/audio/transcriptions endpoint.
 */
export function createLocalTranscriptionProvider(
  baseUrl: string,
  model = "whisper-1"
): TranscriptionProvider {
  return {
    id: "local-whisper",
    async transcribe(audioBuffer: ArrayBuffer): Promise<string> {
      const client = new OpenAI({
        apiKey: "local",
        baseURL: `${baseUrl.replace(/\/$/, "")}/v1`,
      });
      const file = await toFile(Buffer.from(audioBuffer), "recording.wav", { type: "audio/wav" });
      const response = await client.audio.transcriptions.create({ file, model });
      return response.text;
    },
  };
}
