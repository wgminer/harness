import { defineConfig } from "vitest/config";

/**
 * Advisory size ceilings (desktop renderer + iOS app). Run via `npm run budget`.
 * Kept out of `npm test` so growing a feature never fails the correctness suite —
 * these numbers are a prompt to ratchet or refactor, not a build gate.
 */
export default defineConfig({
  test: {
    include: ["src/shared/*AppBudget.test.ts"],
    environment: "node",
    pool: "threads",
    isolate: false,
  },
});
