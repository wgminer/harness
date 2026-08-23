import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONVERSATION_SEARCH_CONTRACT } from "./conversationSearch";

const root = join(__dirname, "../..");

describe("resources/contracts/conversationSearch.json", () => {
  it("parses and matches TS contract export", () => {
    const raw = readFileSync(
      join(root, "resources/contracts/conversationSearch.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.minTokenLength).toBe(CONVERSATION_SEARCH_CONTRACT.minTokenLength);
    expect(parsed.toolResultCap).toBe(CONVERSATION_SEARCH_CONTRACT.toolResultCap);
    expect(parsed.resultKinds).toEqual(["chat", "dictation", "note", "image"]);
    expect(parsed.hrefPrefixes).toEqual(CONVERSATION_SEARCH_CONTRACT.hrefPrefixes);
  });
});
