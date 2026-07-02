import { app } from "electron";
import { join } from "path";

export const HARNESS_SPEECH_BINARY = "HarnessSpeech";

/** Bundled HarnessSpeech CLI (see scripts/build-speech-helper.sh, electron-builder extraResources). */
export function getHarnessSpeechPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, HARNESS_SPEECH_BINARY);
  }
  return join(app.getAppPath(), "resources", HARNESS_SPEECH_BINARY);
}
