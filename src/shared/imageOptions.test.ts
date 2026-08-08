import { describe, expect, it } from "vitest";
import {
  IMAGE_DEFAULTS,
  IMAGE_MODE_PRESETS,
  aspectPresetFromSize,
  backgroundAllowedForFormat,
  formatImageSize,
  imageRenderModeFromSettings,
  parseImageSize,
  settingsForRenderMode,
  sizeFromLegacyAspect,
  validateImageSize,
} from "./imageOptions";
import { getDisplayImageTitle, titleFromImagePrompt } from "./images";

describe("imageOptions", () => {
  it("maps legacy aspect presets to sizes", () => {
    expect(sizeFromLegacyAspect("square")).toBe("1024x1024");
    expect(sizeFromLegacyAspect("landscape")).toBe("1536x1024");
    expect(sizeFromLegacyAspect("portrait")).toBe("1024x1536");
    expect(sizeFromLegacyAspect("auto")).toBe("1024x1024");
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

  it("defaults to draft mode settings", () => {
    expect(IMAGE_DEFAULTS.mode).toBe("draft");
    expect(IMAGE_DEFAULTS.size).toBe("1024x1024");
    expect(IMAGE_DEFAULTS.quality).toBe("low");
    expect(IMAGE_DEFAULTS.outputFormat).toBe("png");
    expect(IMAGE_DEFAULTS.background).toBe("opaque");
    expect(settingsForRenderMode("draft").quality).toBe(IMAGE_MODE_PRESETS.draft.quality);
    expect(settingsForRenderMode("final").quality).toBe(IMAGE_MODE_PRESETS.final.quality);
  });

  it("snaps stored sizes to aspect presets", () => {
    expect(aspectPresetFromSize("1024x1024")).toBe("1024x1024");
    expect(aspectPresetFromSize("1536x1024")).toBe("1536x1024");
    expect(aspectPresetFromSize("auto")).toBe("1024x1024");
    expect(aspectPresetFromSize("1280x720")).toBe("1536x1024");
    expect(aspectPresetFromSize("720x1280")).toBe("1024x1536");
    expect(aspectPresetFromSize("square")).toBe("1024x1024");
  });

  it("infers draft vs final from quality", () => {
    expect(imageRenderModeFromSettings("low")).toBe("draft");
    expect(imageRenderModeFromSettings("auto")).toBe("draft");
    expect(imageRenderModeFromSettings("medium")).toBe("draft");
    expect(imageRenderModeFromSettings("high")).toBe("final");
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
