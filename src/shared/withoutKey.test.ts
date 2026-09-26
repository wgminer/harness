import { describe, expect, it } from "vitest";
import { withoutKey } from "./withoutKey";

describe("withoutKey", () => {
  it("returns the same object when the key is absent", () => {
    const record = { a: 1 };
    expect(withoutKey(record, "b")).toBe(record);
  });

  it("drops the key without mutating the input", () => {
    const record = { a: 1, b: 2 };
    expect(withoutKey(record, "a")).toEqual({ b: 2 });
    expect(record).toEqual({ a: 1, b: 2 });
  });
});
