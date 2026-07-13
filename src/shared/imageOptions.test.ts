import { describe, expect, it } from "vitest";
import {
  IMAGE_DEFAULTS,
  backgroundAllowedForFormat,
  formatImageSize,
  parseImageSize,
  sizeFromLegacyAspect,
  validateImageSize,
} from "./imageOptions";
import { getDisplayImageTitle, titleFromImagePrompt } from "./images";

describe("imageOptions", () => {
  it("maps legacy aspect presets to sizes", () => {
    expect(sizeFromLegacyAspect("square")).toBe("1024x1024");
    expect(sizeFromLegacyAspect("landscape")).toBe("1536x1024");
    expect(sizeFromLegacyAspect("portrait")).toBe("1024x1536");
    expect(sizeFromLegacyAspect("auto")).toBe("auto");
  });

  it("parses and formats WxH sizes", () => {
    expect(parseImageSize("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(formatImageSize(1280, 720)).toBe("1280x720");
    expect(parseImageSize("auto")).toBeNull();
  });

  it("validates custom sizes", () => {
    expect(validateImageSize("auto")).toBeNull();
    expect(validateImageSize("1024x1024")).toBeNull();
    expect(validateImageSize("1280x720")).toBeNull();
    expect(validateImageSize("640x640")).toMatch(/pixels/i);
    expect(validateImageSize("1025x1024")).toMatch(/multiples of 16/i);
    expect(validateImageSize("nope")).toMatch(/WIDTHxHEIGHT/i);
  });

  it("disallows transparent JPEG", () => {
    expect(backgroundAllowedForFormat("jpeg", "transparent")).toBe("opaque");
    expect(backgroundAllowedForFormat("png", "transparent")).toBe("transparent");
  });

  it("has auto defaults", () => {
    expect(IMAGE_DEFAULTS.size).toBe("auto");
    expect(IMAGE_DEFAULTS.outputFormat).toBe("png");
  });
});

describe("titleFromImagePrompt", () => {
  it("uses untitled when empty", () => {
    expect(titleFromImagePrompt("")).toBe("Untitled image");
    expect(getDisplayImageTitle("")).toBe("Untitled image");
  });

  it("truncates long prompts", () => {
    const long = "a".repeat(80);
    expect(titleFromImagePrompt(long).endsWith("…")).toBe(true);
    expect(titleFromImagePrompt(long).length).toBeLessThanOrEqual(61);
  });
});
