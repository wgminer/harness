import { describe, expect, it } from "vitest";
import {
  PAIRING_PREFIX,
  PAIRING_TTL_SECONDS,
  PairingPayloadError,
  decodePairingPayload,
  encodePairingPayload,
  pairingSecondsRemaining,
} from "./pairingPayload";

const base = {
  accountId: "acct123",
  bucket: "harness-sync",
  prefix: "harness/",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-value",
  openaiApiKey: "sk-test",
};

describe("pairingPayload", () => {
  it("round-trips a complete payload", () => {
    const now = 1_700_000_000;
    const encoded = encodePairingPayload({ ...base, now });
    expect(encoded.startsWith(PAIRING_PREFIX)).toBe(true);
    const decoded = decodePairingPayload(encoded, { now });
    expect(decoded).toEqual({
      v: 1,
      exp: now + PAIRING_TTL_SECONDS,
      ...base,
    });
  });

  it("allows empty openaiApiKey", () => {
    const encoded = encodePairingPayload({ ...base, openaiApiKey: "", now: 100 });
    const decoded = decodePairingPayload(encoded, { now: 100 });
    expect(decoded.openaiApiKey).toBe("");
  });

  it("rejects expired payloads", () => {
    const encoded = encodePairingPayload({ ...base, exp: 50, now: 100 });
    expect(() => decodePairingPayload(encoded, { now: 100 })).toThrow(PairingPayloadError);
    try {
      decodePairingPayload(encoded, { now: 100 });
    } catch (e) {
      expect((e as PairingPayloadError).code).toBe("expired");
    }
  });

  it("rejects bad version and bad prefix", () => {
    expect(() => decodePairingPayload("nope")).toThrowError(/bad_prefix/);
    const encoded = encodePairingPayload({ ...base, now: 10 });
    const body = encoded.slice(PAIRING_PREFIX.length);
    // Corrupt: rewrite JSON with v:2 inside base64 — easier to re-encode manually
    const bad = PAIRING_PREFIX + Buffer.from(JSON.stringify({ v: 2, exp: 999, ...base })).toString(
      "base64"
    );
    expect(() => decodePairingPayload(bad, { now: 1 })).toThrow(PairingPayloadError);
    expect(body.length).toBeGreaterThan(0);
  });

  it("rejects missing R2 fields", () => {
    expect(() =>
      encodePairingPayload({ ...base, accountId: "", now: 1 })
    ).toThrow(PairingPayloadError);
  });

  it("computes remaining seconds", () => {
    expect(pairingSecondsRemaining({ exp: 110 }, 100)).toBe(10);
    expect(pairingSecondsRemaining({ exp: 90 }, 100)).toBe(0);
  });
});
