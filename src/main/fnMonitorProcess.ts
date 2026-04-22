import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export function resolveFnMonitorPath(): string | null {
  if (process.platform !== "darwin") return null;
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, "HarnessFnMonitor"));
  }
  candidates.push(join(app.getAppPath(), "resources", "HarnessFnMonitor"));
  candidates.push(join(process.cwd(), "resources", "HarnessFnMonitor"));
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  console.warn("HarnessFnMonitor: binary not found. Tried:", candidates.join(", "));
  return null;
}

export interface FnMonitorCallbacks {
  onEdge: (phase: "down" | "up", ms: number) => void;
  /** Called when the process exits (before optional auto-restart). */
  onExit: (code: number | null) => void;
}

const RESTART_BACKOFF_MS = [1000, 3000, 10_000];

/**
 * Spawns the Swift HarnessFnMonitor helper and parses JSON lines from stdout.
 * Restarts with backoff on exit until {@link dispose} is called.
 */
export class FnMonitorProcess {
  private child: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private restartAttempt = 0;
  private disposed = false;

  constructor(
    private readonly binaryPath: string,
    private readonly callbacks: FnMonitorCallbacks
  ) {}

  start(): void {
    this.disposed = false;
    this.spawnOnce();
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.killChild();
  }

  private killChild(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.child) {
      this.child.kill("SIGTERM");
      this.child = null;
    }
  }

  private spawnOnce(): void {
    if (this.disposed) return;
    this.killChild();

    const child = spawn(this.binaryPath, [], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stderr?.on("data", (buf: Buffer) => {
      console.warn("[HarnessFnMonitor]", buf.toString());
    });

    const rl = createInterface({ input: child.stdout });
    this.rl = rl;
    rl.on("line", (line) => {
      this.restartAttempt = 0;
      try {
        const parsed = JSON.parse(line) as { t?: string; phase?: string; ms?: number };
        if (
          parsed.t !== "fn" ||
          (parsed.phase !== "down" && parsed.phase !== "up") ||
          typeof parsed.ms !== "number"
        ) {
          return;
        }
        this.callbacks.onEdge(parsed.phase, parsed.ms);
      } catch {
        /* ignore malformed */
      }
    });

    child.on("exit", (code) => {
      this.rl = null;
      this.child = null;
      this.callbacks.onExit(code);
      if (this.disposed) return;
      const delay = RESTART_BACKOFF_MS[Math.min(this.restartAttempt, RESTART_BACKOFF_MS.length - 1)];
      this.restartAttempt += 1;
      this.restartTimer = setTimeout(() => this.spawnOnce(), delay);
    });
  }
}
