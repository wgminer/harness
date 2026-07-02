import { app } from "electron";
import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import type { ParakeetInstalledMarker } from "../shared/parakeetModel";
import { PARAKEET_FILENAMES } from "./parakeetPaths";

export const PARAKEET_MODEL_DIR_NAME = "parakeet-model";
export const INSTALLED_MARKER = "installed.json";

export function getParakeetModelDir(): string {
  return join(app.getPath("userData"), PARAKEET_MODEL_DIR_NAME);
}

export function getParakeetModelWeightsPath(): string {
  return join(getParakeetModelDir(), PARAKEET_FILENAMES.weights);
}

export function getParakeetModelVocabPath(): string {
  return join(getParakeetModelDir(), PARAKEET_FILENAMES.vocab);
}

export function getInstalledMarkerPath(): string {
  return join(getParakeetModelDir(), INSTALLED_MARKER);
}

export function getDevParakeetResourceDir(): string {
  return join(app.getAppPath(), "resources", "parakeet");
}

/** Dev: use resources/parakeet when weights exist there. Packaged: userData only. */
export function resolveParakeetModelDir(): string {
  const devDir = getDevParakeetResourceDir();
  const devWeights = join(devDir, PARAKEET_FILENAMES.weights);
  const devVocab = join(devDir, PARAKEET_FILENAMES.vocab);
  if (!app.isPackaged && existsSync(devWeights) && existsSync(devVocab)) {
    return devDir;
  }
  return getParakeetModelDir();
}

/** Cheap existsSync fallback for bundled weights in legacy fat builds. */
export function getBundledModelDirIfPresent(): string | null {
  if (!app.isPackaged || !process.resourcesPath) return null;
  const bundled = join(process.resourcesPath, "parakeet");
  const weights = join(bundled, PARAKEET_FILENAMES.weights);
  const vocab = join(bundled, PARAKEET_FILENAMES.vocab);
  if (existsSync(weights) && existsSync(vocab)) {
    return bundled;
  }
  return null;
}

export function resolveParakeetModelDirWithBundledFallback(): string {
  const bundled = getBundledModelDirIfPresent();
  if (bundled) return bundled;
  return resolveParakeetModelDir();
}

export async function readInstalledMarker(): Promise<ParakeetInstalledMarker | null> {
  const markerPath = getInstalledMarkerPath();
  if (!existsSync(markerPath)) return null;
  try {
    const raw = JSON.parse(await readFile(markerPath, "utf8")) as Partial<ParakeetInstalledMarker>;
    if (
      typeof raw.version === "string" &&
      typeof raw.weightsSha256 === "string" &&
      typeof raw.vocabSha256 === "string" &&
      typeof raw.weightsBytes === "number" &&
      typeof raw.vocabBytes === "number"
    ) {
      return raw as ParakeetInstalledMarker;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function fileSizeIfExists(filePath: string): number | null {
  try {
    if (!existsSync(filePath)) return null;
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

export async function isParakeetModelInstalled(): Promise<boolean> {
  const bundled = getBundledModelDirIfPresent();
  if (bundled) return true;

  const devDir = getDevParakeetResourceDir();
  if (!app.isPackaged) {
    const devWeights = join(devDir, PARAKEET_FILENAMES.weights);
    const devVocab = join(devDir, PARAKEET_FILENAMES.vocab);
    if (existsSync(devWeights) && existsSync(devVocab)) return true;
  }

  const marker = await readInstalledMarker();
  if (!marker) return false;

  const weightsPath = getParakeetModelWeightsPath();
  const vocabPath = getParakeetModelVocabPath();
  const weightsSize = fileSizeIfExists(weightsPath);
  const vocabSize = fileSizeIfExists(vocabPath);
  if (weightsSize === null || vocabSize === null) return false;
  return weightsSize === marker.weightsBytes && vocabSize === marker.vocabBytes;
}
