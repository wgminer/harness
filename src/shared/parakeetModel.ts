/** Parakeet TDT 0.6B model pack hosted on Hugging Face (converted safetensors + vocab). */
export const PARAKEET_MODEL_VERSION = "1";

export const PARAKEET_HF_REPO = "wgminer/harness-parakeet-tdt-0.6b";

export const DEFAULT_PARAKEET_MANIFEST_URL = `https://huggingface.co/${PARAKEET_HF_REPO}/resolve/main/manifest.json`;

/** ~2.3 GB weights + small vocab; used in UI copy. */
export const PARAKEET_MODEL_DOWNLOAD_LABEL = "~2.3 GB";

export interface ParakeetModelFileEntry {
  sha256: string;
  bytes: number;
  url: string;
}

export interface ParakeetModelManifest {
  version: string;
  model: string;
  files: {
    weights: ParakeetModelFileEntry;
    vocab: ParakeetModelFileEntry;
  };
}

export interface ParakeetInstalledMarker {
  version: string;
  weightsSha256: string;
  vocabSha256: string;
  weightsBytes: number;
  vocabBytes: number;
  installedAt: number;
}

/** Production manifest URL; tests override via `PARAKEET_MANIFEST_URL`. */
export function getParakeetManifestUrl(): string {
  const override = process.env.PARAKEET_MANIFEST_URL?.trim();
  if (override) return override;
  return DEFAULT_PARAKEET_MANIFEST_URL;
}

export function parseParakeetManifest(raw: unknown): ParakeetModelManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid Parakeet manifest: not an object.");
  }
  const m = raw as Record<string, unknown>;
  const version = String(m.version ?? "").trim();
  const model = String(m.model ?? "").trim();
  if (!version || !model) {
    throw new Error("Invalid Parakeet manifest: missing version or model.");
  }
  const files = m.files as Record<string, unknown> | undefined;
  const weights = parseFileEntry(files?.weights, "weights");
  const vocab = parseFileEntry(files?.vocab, "vocab");
  return { version, model, files: { weights, vocab } };
}

function parseFileEntry(raw: unknown, label: string): ParakeetModelFileEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid Parakeet manifest: missing files.${label}.`);
  }
  const e = raw as Record<string, unknown>;
  const sha256 = String(e.sha256 ?? "").trim().toLowerCase();
  const bytes = Number(e.bytes);
  const url = String(e.url ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isFinite(bytes) || bytes < 0 || !url) {
    throw new Error(`Invalid Parakeet manifest: bad files.${label} entry.`);
  }
  return { sha256, bytes, url };
}
