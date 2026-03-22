import { ipcMain, app, shell, dialog } from "electron";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import OpenAI, { toFile } from "openai";
import { getSettings } from "./settings";

function getRecordingsDir(): string {
  return join(app.getPath("userData"), "recordings");
}

export function registerRecordingHandlers(): void {
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
    const settings = getSettings();
    const apiKey = settings.openai?.apiKey ?? "";
    if (!apiKey) return { error: "No OpenAI API key configured. Add one in Settings." };
    try {
      const client = new OpenAI({ apiKey });
      const file = await toFile(Buffer.from(data), "recording.wav", { type: "audio/wav" });
      const response = await client.audio.transcriptions.create({ file, model: "whisper-1" });
      return { text: response.text };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
