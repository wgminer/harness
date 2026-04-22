/** Fixed assistant text when `HARNESS_E2E=1` so Playwright can assert without calling LLM APIs. */
export const HARNESS_E2E_ASSISTANT_REPLY = "Harness E2E assistant reply.";

export const HARNESS_E2E_TRANSCRIBE_TEXT = "Harness E2E transcribed text.";

export function isHarnessE2E(): boolean {
  return process.env.HARNESS_E2E === "1";
}

/**
 * Optional per-chunk delay used by e2e to exercise abort/persistence behavior.
 * Set `HARNESS_E2E_STREAM_MS` to a positive integer to enable chunked streaming.
 */
export function getHarnessE2EStreamDelayMs(): number {
  const raw = process.env.HARNESS_E2E_STREAM_MS;
  if (!raw) return 0;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
