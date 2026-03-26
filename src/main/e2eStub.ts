/** Fixed assistant text when `HARNESS_E2E=1` so Playwright can assert without calling LLM APIs. */
export const HARNESS_E2E_ASSISTANT_REPLY = "Harness E2E assistant reply.";

export const HARNESS_E2E_TRANSCRIBE_TEXT = "Harness E2E transcribed text.";

export function isHarnessE2E(): boolean {
  return process.env.HARNESS_E2E === "1";
}
