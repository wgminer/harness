export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; percent: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export const IDLE_UPDATE_STATUS: UpdateStatus = { status: "idle" };
