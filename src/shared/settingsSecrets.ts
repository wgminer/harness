/** Secret fields that must never ride the sync bundle or merge from remote. */
export const SETTINGS_SECRET_PATHS = [
  ["openai", "apiKey"],
  ["search", "tavilyApiKey"],
] as const;

export function stripSettingsSecrets(raw: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const openai = out.openai;
  if (openai && typeof openai === "object") {
    delete (openai as Record<string, unknown>).apiKey;
    if (Object.keys(openai as object).length === 0) delete out.openai;
  }
  const search = out.search;
  if (search && typeof search === "object") {
    delete (search as Record<string, unknown>).tavilyApiKey;
    if (Object.keys(search as object).length === 0) delete out.search;
  }
  return out;
}

export function redactSettingsJsonBytes(bytes: Buffer): Buffer {
  try {
    const parsed = JSON.parse(bytes.toString("utf-8")) as Record<string, unknown>;
    return Buffer.from(JSON.stringify(stripSettingsSecrets(parsed), null, 2), "utf-8");
  } catch {
    return bytes;
  }
}

export function extractSettingsSecrets(raw: Record<string, unknown>): {
  openaiApiKey: string | null;
  tavilyApiKey: string | null;
} {
  const openaiRaw = raw.openai as Record<string, unknown> | undefined;
  const searchRaw = raw.search as Record<string, unknown> | undefined;
  const openaiApiKey =
    typeof openaiRaw?.apiKey === "string" && openaiRaw.apiKey.trim() ? openaiRaw.apiKey.trim() : null;
  const tavilyApiKey =
    typeof searchRaw?.tavilyApiKey === "string" && searchRaw.tavilyApiKey.trim()
      ? searchRaw.tavilyApiKey.trim()
      : null;
  return { openaiApiKey, tavilyApiKey };
}
