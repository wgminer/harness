import { describe, expect, it } from "vitest";
import { jsonExtraDataEndIndex, parseJsonUtf8 } from "./jsonFile";

describe("parseJsonUtf8", () => {
  it("parses valid JSON", () => {
    expect(parseJsonUtf8('{"a":1}')).toEqual({ value: { a: 1 }, repaired: false });
  });

  it("recovers when extra bytes follow a complete value", () => {
    const raw = '{"ok":true}\n": "auto"\n  }\n}';
    const result = parseJsonUtf8<Record<string, unknown>>(raw);
    expect(result.repaired).toBe(true);
    expect(result.value).toEqual({ ok: true });
  });

  it("extracts end index from Node extra-data syntax errors", () => {
    try {
      JSON.parse('{}x');
    } catch (err) {
      expect(jsonExtraDataEndIndex(err)).toBe(2);
    }
  });
});
