import { spawn } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { access } from "fs/promises";
import type { TranscriptionProvider, TranscriptionResult } from "./types";
import { getParakeetBundleDir, PARAKEET_FILENAMES } from "../parakeetPaths";

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * parakeet.cpp CLI prints status (model load, encoder ms) then a block like:
 * --- Transcription (N tokens) ---
 * actual transcript text
 */
function parseParakeetTranscriptStdout(raw: string): string {
  const s = raw.replace(/\r\n/g, "\n");
  const match = s.match(/---\s*Transcription[^-\n]*---\s*\n([\s\S]*)/);
  if (match?.[1]) {
    return match[1].trim();
  }
  return s.trim();
}

function parseParakeetTokenCount(raw: string): number | null {
  const match = raw.match(/---\s*Transcription\s*\((\d+)\s+tokens?\)\s*---/i);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

function runParakeetCli(exe: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

/** Prefer Metal on Apple Silicon when available. */
function defaultUseGpu(): boolean {
  return process.arch === "arm64" && process.platform === "darwin";
}

/**
 * Local transcription via parakeet.cpp CLI (NVIDIA Parakeet TDT 0.6B — tdt-600m).
 * Bundle layout: resources/parakeet/{parakeet,model.safetensors,vocab.txt}
 */
export function createParakeetTranscriptionProvider(): TranscriptionProvider {
  const useGpu = defaultUseGpu();
  const fp16 = useGpu;

  return {
    id: "parakeet-local",

    async transcribe(audioBuffer: ArrayBuffer): Promise<TranscriptionResult> {
      const base = getParakeetBundleDir();
      const exe = join(base, PARAKEET_FILENAMES.cli);
      const weights = join(base, PARAKEET_FILENAMES.weights);
      const vocab = join(base, PARAKEET_FILENAMES.vocab);

      if (!(await pathExists(exe))) {
        throw new Error(`Parakeet CLI not found at ${exe}. Run npm run parakeet:setup (see BUILD.md).`);
      }
      if (!(await pathExists(weights)) || !(await pathExists(vocab))) {
        throw new Error(
          `Parakeet model files missing under ${base}. Expected ${PARAKEET_FILENAMES.weights} and ${PARAKEET_FILENAMES.vocab}.`
        );
      }

      const wavPath = join(tmpdir(), `harness-parakeet-${randomUUID()}.wav`);
      try {
        await writeFile(wavPath, Buffer.from(audioBuffer));

        const args = [weights, wavPath, "--vocab", vocab, "--model", "tdt-600m"];
        if (useGpu) {
          args.push("--gpu");
          if (fp16) args.push("--fp16");
        }

        const { stdout, stderr, code } = await runParakeetCli(exe, args);
        const tokenCount = parseParakeetTokenCount(stdout);
        const text = parseParakeetTranscriptStdout(stdout);
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
          throw new Error(`Parakeet failed: ${detail}`);
        }
        if (tokenCount === 0) {
          return { text: "", parakeetTokens: 0 };
        }
        if (!text) {
          throw new Error(stderr.trim() || "Parakeet returned no transcript.");
        }
        return { text, parakeetTokens: tokenCount };
      } finally {
        await unlink(wavPath).catch(() => {});
      }
    },
  };
}
