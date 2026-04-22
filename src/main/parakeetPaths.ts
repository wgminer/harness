import { app } from "electron";
import { join } from "path";

/** Bundled parakeet binary + model files (see scripts/setup-parakeet.js, electron-builder extraResources). */
export function getParakeetBundleDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "parakeet");
  }
  return join(app.getAppPath(), "resources", "parakeet");
}

export const PARAKEET_FILENAMES = {
  cli: "parakeet",
  weights: "model.safetensors",
  vocab: "vocab.txt",
} as const;
