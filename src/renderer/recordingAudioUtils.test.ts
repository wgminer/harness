import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  countSamples,
  isSilentAudio,
  MICROPHONE_PERMISSION_DENIED_MESSAGE,
  NO_AUDIO_CAPTURED_MESSAGE,
  peakAmplitude,
  silenceCaptureErrorMessage,
  SILENT_AUDIO_PEAK_THRESHOLD,
} from "./recordingAudioUtils";

const root = join(__dirname, "../..");

function rustConst(file: string, name: string): string {
  const src = readFileSync(join(root, file), "utf8");
  const re = new RegExp(
    `pub const ${name}: &str =\\s*"((?:\\\\.|[^"\\\\])*)"`,
  );
  const match = src.match(re);
  if (!match) throw new Error(`${name} not found in ${file}`);
  return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
}

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

  it("maps silence errors by microphone authorization", () => {
    expect(silenceCaptureErrorMessage(false)).toBe(MICROPHONE_PERMISSION_DENIED_MESSAGE);
    expect(silenceCaptureErrorMessage(true)).toBe(NO_AUDIO_CAPTURED_MESSAGE);
    expect(MICROPHONE_PERMISSION_DENIED_MESSAGE).toMatch(/Microphone access is required/);
    expect(NO_AUDIO_CAPTURED_MESSAGE).toMatch(/not muted/);
  });

  it("keeps mic error strings in sync with Rust", () => {
    expect(NO_AUDIO_CAPTURED_MESSAGE).toBe(
      rustConst("src-tauri/src/global_recording_capture.rs", "NO_AUDIO_CAPTURED_MESSAGE"),
    );
    expect(MICROPHONE_PERMISSION_DENIED_MESSAGE).toBe(
      rustConst("src-tauri/src/mic_permission.rs", "MICROPHONE_PERMISSION_DENIED_MESSAGE"),
    );
  });
});
