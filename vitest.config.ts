import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Default forks + isolate re-transform every file in a fresh process.
    // This suite is pure unit tests; threads without isolation cuts wall time ~5×.
    pool: "threads",
    isolate: false,
  },
});
