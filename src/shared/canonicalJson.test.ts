import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonCompact, canonicalJsonPretty } from "./canonicalJson";

const FIXTURES = join(import.meta.dirname, "fixtures", "syncMerge");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8").replace(/\n$/, "");
}

describe("canonicalJson", () => {
  it("pretty-prints with sorted keys and no trailing newline", () => {
    const value = { b: 1, a: { z: 1, y: 2 } };
    const text = canonicalJsonPretty(value);
    expect(text.endsWith("\n")).toBe(false);
    expect(text).toBe(
      '{\n  "a": {\n    "y": 2,\n    "z": 1\n  },\n  "b": 1\n}',
    );
  });

  it("compact-stamps with sorted keys", () => {
    expect(canonicalJsonCompact({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(
      canonicalJsonCompact({ id: "m2", role: "assistant", content: "dup", createdAt: 2 }),
    ).toBe(readFixture("message-dedup-stamp.expected.txt"));
  });
});
