/** Short-lived Mac→phone sync pairing payload (`harness-pair` v1). */

export const PAIRING_PREFIX = "harness-pair:1:";
export const PAIRING_TTL_SECONDS = 10 * 60;

export interface PairingPayloadV1 {
  v: 1;
  /** Unix seconds expiry. */
  exp: number;
  accountId: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** May be empty if Mac has no OpenAI key yet. */
  openaiApiKey: string;
}

export type PairingEncodeInput = Omit<PairingPayloadV1, "v" | "exp"> & {
  /** Override expiry (unix seconds). Defaults to now + PAIRING_TTL_SECONDS. */
  exp?: number;
  /** Override "now" for tests (unix seconds). */
  now?: number;
};

export type PairingDecodeError =
  | "bad_prefix"
  | "bad_encoding"
  | "bad_json"
  | "bad_version"
  | "missing_fields"
  | "expired";

export class PairingPayloadError extends Error {
  constructor(readonly code: PairingDecodeError, message?: string) {
    super(message ?? code);
    this.name = "PairingPayloadError";
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const b64 = padded + "=".repeat(padLen);
  if (typeof atob === "function") {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PairingPayloadError("missing_fields", `Missing ${field}`);
  }
  return value.trim();
}

/**
 * Encode a pairing string. OpenAI key may be empty; R2 fields must be present.
 */
export function encodePairingPayload(input: PairingEncodeInput): string {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const payload: PairingPayloadV1 = {
    v: 1,
    exp: input.exp ?? now + PAIRING_TTL_SECONDS,
    accountId: requireNonEmpty(input.accountId, "accountId"),
    bucket: requireNonEmpty(input.bucket, "bucket"),
    prefix: typeof input.prefix === "string" && input.prefix.trim()
      ? input.prefix.trim()
      : "harness/",
    accessKeyId: requireNonEmpty(input.accessKeyId, "accessKeyId"),
    secretAccessKey: requireNonEmpty(input.secretAccessKey, "secretAccessKey"),
    openaiApiKey: typeof input.openaiApiKey === "string" ? input.openaiApiKey.trim() : "",
  };
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  return `${PAIRING_PREFIX}${toBase64Url(bytes)}`;
}

/**
 * Decode and validate a pairing string. Throws PairingPayloadError on failure.
 */
export function decodePairingPayload(
  raw: string,
  opts?: { now?: number }
): PairingPayloadV1 {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed.startsWith(PAIRING_PREFIX)) {
    throw new PairingPayloadError("bad_prefix");
  }
  const b64 = trimmed.slice(PAIRING_PREFIX.length);
  let json: string;
  try {
    json = new TextDecoder().decode(fromBase64Url(b64));
  } catch {
    throw new PairingPayloadError("bad_encoding");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new PairingPayloadError("bad_json");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new PairingPayloadError("bad_json");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new PairingPayloadError("bad_version");
  }
  const exp = obj.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    throw new PairingPayloadError("missing_fields", "Missing exp");
  }
  const now = opts?.now ?? Math.floor(Date.now() / 1000);
  if (exp < now) {
    throw new PairingPayloadError("expired");
  }
  return {
    v: 1,
    exp,
    accountId: requireNonEmpty(obj.accountId, "accountId"),
    bucket: requireNonEmpty(obj.bucket, "bucket"),
    prefix:
      typeof obj.prefix === "string" && obj.prefix.trim()
        ? obj.prefix.trim()
        : "harness/",
    accessKeyId: requireNonEmpty(obj.accessKeyId, "accessKeyId"),
    secretAccessKey: requireNonEmpty(obj.secretAccessKey, "secretAccessKey"),
    openaiApiKey: typeof obj.openaiApiKey === "string" ? obj.openaiApiKey.trim() : "",
  };
}

export function pairingSecondsRemaining(
  payload: Pick<PairingPayloadV1, "exp">,
  now = Math.floor(Date.now() / 1000)
): number {
  return Math.max(0, Math.floor(payload.exp - now));
}
