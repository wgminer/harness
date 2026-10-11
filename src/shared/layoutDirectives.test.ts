import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/layoutDirectives.json";
import { stripLayoutDirectives } from "./layoutDirectives";

describe("stripLayoutDirectives", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      expect(stripLayoutDirectives(fixture.input)).toBe(fixture.output);
    });
  }
});
