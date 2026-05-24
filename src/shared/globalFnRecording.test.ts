import { describe, expect, it } from "vitest";
import { isGlobalFnRecordingEnabledForView } from "./globalFnRecording";

describe("isGlobalFnRecordingEnabledForView", () => {
  it("enables only on chat", () => {
    expect(isGlobalFnRecordingEnabledForView("chat")).toBe(true);
    expect(isGlobalFnRecordingEnabledForView("notes")).toBe(false);
    expect(isGlobalFnRecordingEnabledForView("settings")).toBe(false);
    expect(isGlobalFnRecordingEnabledForView("tasks")).toBe(false);
  });
});
