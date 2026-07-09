import { describe, expect, it } from "vitest";
import {
  countSamples,
  isSilentAudio,
  peakAmplitude,
  SILENT_AUDIO_PEAK_THRESHOLD,
} from "./recordingAudioUtils";

describe("recordingAudioUtils", () => {
  it("detects empty buffers as silent", () => {
    expect(isSilentAudio([])).toBe(true);
    expect(countSamples([])).toBe(0);
  });

  it("detects near-zero audio as silent", () => {
    const buffers = [new Float32Array([0, SILENT_AUDIO_PEAK_THRESHOLD / 2, -0])];
    expect(peakAmplitude(buffers)).toBeLessThan(SILENT_AUDIO_PEAK_THRESHOLD);
    expect(isSilentAudio(buffers)).toBe(true);
  });

  it("accepts audible samples", () => {
    const buffers = [new Float32Array([0, 0.05, -0.03])];
    expect(isSilentAudio(buffers)).toBe(false);
  });
});
