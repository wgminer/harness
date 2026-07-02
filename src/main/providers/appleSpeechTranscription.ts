import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { access } from "fs/promises";
import type { TranscriptionProvider, TranscriptionResult } from "./types";
import { getHarnessSpeechPath } from "../appleSpeechPaths";

/** Exit codes from native/HarnessSpeech (see README). */
const EXIT_PERMISSION_DENIED = 2;
const EXIT_RECOGNIZER_UNAVAILABLE = 3;
const EXIT_EMPTY_TRANSCRIPT = 4;
const EXIT_AUDIO_NOT_READY = 5;

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function mapExitCode(code: number | null, stderr: string): string {
  switch (code) {
    case EXIT_PERMISSION_DENIED:
      return (
        stderr.trim() ||
        "Speech recognition access is required. Enable it in System Settings → Privacy & Security → Speech Recognition."
      );
    case EXIT_RECOGNIZER_UNAVAILABLE:
      return (
        stderr.trim() ||
        "On-device speech recognition is not available for this language. Install the dictation language in System Settings → Keyboard → Dictation."
      );
    case EXIT_EMPTY_TRANSCRIPT:
      return stderr.trim() || "No speech was detected in the recording.";
    case EXIT_AUDIO_NOT_READY:
      return stderr.trim() || "The recording file is not ready yet. Try again in a moment.";
    default:
      return stderr.trim() || `Speech transcription failed (exit ${code ?? "unknown"}).`;
  }
}

function runHarnessSpeech(
  exe: string,
  args: string[],
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finalize = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finalize(() => reject(new Error("Transcription cancelled.")));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      finalize(() => reject(err));
    });
    child.on("close", (code) => {
      finalize(() => resolve({ stdout, stderr, code }));
    });
    child.on("exit", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    });
  });
}

/**
 * Local transcription via HarnessSpeech CLI (Apple SpeechAnalyzer / SFSpeechRecognizer).
 * Runtime: resources/HarnessSpeech. No model download required.
 */
export function createAppleSpeechTranscriptionProvider(): TranscriptionProvider {
  return {
    id: "apple-speech-local",

    async transcribe(audioBuffer: ArrayBuffer, signal?: AbortSignal): Promise<TranscriptionResult> {
      if (process.platform !== "darwin") {
        throw new Error("On-device Apple speech transcription is only available on macOS.");
      }

      const exe = getHarnessSpeechPath();
      if (!(await pathExists(exe))) {
        throw new Error(
          `HarnessSpeech helper not found at ${exe}. Run npm run build:speech-helper (see BUILD.md).`
        );
      }

      const wavPath = join(tmpdir(), `harness-speech-${randomUUID()}.wav`);
      try {
        await writeFile(wavPath, Buffer.from(audioBuffer));

        const args = [wavPath];
        const { stdout, stderr, code } = await runHarnessSpeech(exe, args, signal);
        const text = stdout.trim();
        if (code === EXIT_EMPTY_TRANSCRIPT) {
          return { text: "" };
        }
        if (code !== 0) {
          throw new Error(mapExitCode(code, stderr));
        }
        if (!text) {
          throw new Error(stderr.trim() || "Speech transcription returned no transcript.");
        }
        return { text };
      } finally {
        await unlink(wavPath).catch(() => {});
      }
    },
  };
}
