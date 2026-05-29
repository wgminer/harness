import { describe, expect, it } from "vitest";
import { searchWebTavily } from "./webSearch";

describe("searchWebTavily", () => {
  it("returns an error payload for an empty query", async () => {
    const result = await searchWebTavily("tvly-test", "   ", 5);
    expect(result.results).toEqual([]);
    expect(result.error).toMatch(/query is required/i);
  });

  it("returns an error payload when the API key is missing", async () => {
    const result = await searchWebTavily("", "harness electron", 5);
    expect(result.results).toEqual([]);
    expect(result.error).toMatch(/Tavily API key is not set/i);
    expect(result.query).toBe("harness electron");
  });
});
