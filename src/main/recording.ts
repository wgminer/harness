import { ipcMain, app, shell, dialog, clipboard, systemPreferences } from "electron";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import OpenAI from "openai";
import { getSettings } from "./settings";
import { getTranscriptionProvider } from "./providers/transcriptionRegistry";
import { HARNESS_E2E_TRANSCRIBE_TEXT, isHarnessE2E } from "./e2eStub";
import { OPENAI_TRANSCRIPT_CLEANUP_MODEL } from "../shared/openaiModels";
import { recordOpenAIUsage, recordParakeetTranscription } from "./usageStats";

const DEFAULT_TRANSCRIPT_CLEANUP_INSTRUCTIONS =
  "Clean up this transcript for dictation output. Remove filler words (like um/uh), false starts, and repeated fragments. Keep the original meaning and tone. Fix punctuation and capitalization. Keep proper nouns and technical terms unchanged. Do not add new information.";

function getRecordingsDir(): string {
  return join(app.getPath("userData"), "recordings");
}

async function runTranscriptCleanup(text: string, apiKey: string): Promise<string> {
  const systemPrompt =
    "You are an expert transcript editor for dictation text. Rewrite the transcript to remove filler words, verbal stumbles, and false starts while preserving meaning. Improve punctuation and readability. Do not add new facts. Keep proper nouns and technical terms intact. Return only the cleaned transcript text.\n\nAdditional user instructions:\n" +
    DEFAULT_TRANSCRIPT_CLEANUP_INSTRUCTIONS;

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create(
    {
      model: OPENAI_TRANSCRIPT_CLEANUP_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    },
    { signal: AbortSignal.timeout(8_000) }
  );
  if (completion.usage) {
    recordOpenAIUsage(completion.usage);
  }

  const cleaned = completion.choices[0]?.message?.content?.trim() ?? "";
  return cleaned || text;
}

export function registerRecordingHandlers(): void {
  /** macOS: TCC requires this main-process call before getUserMedia will receive mic audio. */
  ipcMain.handle("recording:requestMicrophoneAccess", async (): Promise<boolean> => {
    if (process.platform !== "darwin") {
      return true;
    }
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") {
      return true;
    }
    if (status === "denied" || status === "restricted") {
      return false;
    }
    return systemPreferences.askForMediaAccess("microphone");
  });

  ipcMain.handle("recording:saveWav", async (_e, data: ArrayBuffer) => {
    const dir = getRecordingsDir();
    await mkdir(dir, { recursive: true });
    const path = join(dir, `rec_${Date.now()}.wav`);
    await writeFile(path, Buffer.from(data));
    return { path };
  });

  ipcMain.handle("recording:showInFolder", (_e, path: string) => {
    shell.showItemInFolder(path);
  });

  ipcMain.handle("recording:exportWav", async (_e, data: ArrayBuffer, suggestedName?: string) => {
    const name = suggestedName ?? `harness-recording-${Date.now()}.wav`;
    const result = await dialog.showSaveDialog({
      defaultPath: join(app.getPath("downloads"), name),
      filters: [{ name: "WAV Audio", extensions: ["wav"] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await writeFile(result.filePath, Buffer.from(data));
    return { path: result.filePath };
  });

  ipcMain.handle("recording:openFolder", async () => {
    const dir = getRecordingsDir();
    await mkdir(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle("recording:transcribe", async (_e, data: ArrayBuffer) => {
    if (isHarnessE2E()) {
      void data;
      return { text: HARNESS_E2E_TRANSCRIBE_TEXT };
    }
    const settings = await getSettings();
    try {
      const provider = getTranscriptionProvider();
      const { text, parakeetTokens } = await provider.transcribe(data);
      recordParakeetTranscription(text, parakeetTokens ?? undefined);
      const shouldCleanup = settings.transcription?.cleanup?.enabled ?? false;
      if (!shouldCleanup || !text.trim()) {
        return { text };
      }
      const key = settings.openai?.apiKey?.trim() ?? "";
      if (!key) {
        return { text };
      }
      try {
        const cleaned = await runTranscriptCleanup(text, key);
        return { text: cleaned };
      } catch (err) {
        console.warn("Transcript cleanup failed; returning original transcript.", err);
        return { text };
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("recording:pasteText", async (_e, text: string) => {
    clipboard.writeText(text);
    if (process.platform === "darwin") {
      await new Promise<void>((resolve) => {
        exec(
          `osascript -e 'tell application "System Events" to keystroke "v" using command down'`,
          () => resolve()
        );
      });
    }
  });
}
