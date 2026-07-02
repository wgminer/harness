export type ParakeetStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; percent: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export const IDLE_PARAKEET_STATUS: ParakeetStatus = { status: "idle" };

export function parakeetModelIsReady(status: ParakeetStatus): boolean {
  return status.status === "ready";
}
