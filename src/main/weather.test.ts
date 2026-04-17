import { describe, expect, it } from "vitest";
import { getWeatherForZip } from "./weather";

describe("getWeatherForZip", () => {
  it("returns an error payload for a non-digit ZIP", async () => {
    const result = await getWeatherForZip("abcde", 3);
    expect(result).toHaveProperty("error");
    expect("zip" in result ? result.zip : undefined).toBe("abcde");
  });

  it("returns an error payload for too-short ZIP input", async () => {
    const result = await getWeatherForZip("123", 3);
    expect(result).toHaveProperty("error");
  });
});
