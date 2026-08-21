import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Size ceilings are advisory policy, not correctness — they run via `npm run budget`
    // so an unrelated feature never fails the suite on a line count.
    exclude: [...defaultExclude, "src/shared/*AppBudget.test.ts"],
    environment: "node",
    // Default forks + isolate re-transform every file in a fresh process.
    // This suite is pure unit tests; threads without isolation cuts wall time ~5×.
    pool: "threads",
    isolate: false,
  },
});
