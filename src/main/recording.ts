import { ipcMain, app, shell, dialog, clipboard, systemPreferences } from "electron";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { getSettings } from "./settings";
import { getTranscriptionProvider } from "./providers/transcriptionRegistry";
import { HARNESS_E2E_TRANSCRIBE_TEXT, isHarnessE2E } from "./e2eStub";

function getRecordingsDir(): string {
  return join(app.getPath("userData"), "recordings");
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
    const isOpenAI = (settings.transcription?.activeProvider ?? "openai") === "openai";
    if (isOpenAI && !settings.openai?.apiKey) {
      return { error: "No OpenAI API key configured. Add one in Settings." };
    }
    try {
      const provider = getTranscriptionProvider(settings);
      const text = await provider.transcribe(data);
      return { text };
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
