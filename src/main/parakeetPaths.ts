import { app } from "electron";
import { join } from "path";

/** Bundled parakeet CLI + dylib (see scripts/setup-parakeet.js, electron-builder extraResources). */
export function getParakeetRuntimeDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "parakeet");
  }
  return join(app.getAppPath(), "resources", "parakeet");
}

/** @deprecated Use getParakeetRuntimeDir — kept for gradual migration in tests. */
export function getParakeetBundleDir(): string {
  return getParakeetRuntimeDir();
}

export const PARAKEET_FILENAMES = {
  cli: "parakeet",
  axiom: "libaxiom.0.dylib",
  weights: "model.safetensors",
  vocab: "vocab.txt",
} as const;

export const PARAKEET_RUNTIME_FILENAMES = [PARAKEET_FILENAMES.cli, PARAKEET_FILENAMES.axiom] as const;

export const WEIGHTS_PART = "model.safetensors.part";
export const WEIGHTS_PART_META = "model.safetensors.part.json";
