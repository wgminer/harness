export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; percent: number }
  | { status: "ready" }
  | { status: "error"; message: string };

export const IDLE_UPDATE_STATUS: UpdateStatus = { status: "idle" };

export function updateButtonLabel(status: UpdateStatus): string {
  switch (status.status) {
    case "available":
      return status.version ? `Update to v${status.version}` : "Update";
    case "downloading":
      return `Updating… ${status.percent}%`;
    case "ready":
      return "Restarting…";
    case "checking":
      return "Checking…";
    case "error":
      return "Update failed";
    default:
      return "Update";
  }
}

export function updateButtonTitle(status: UpdateStatus): string {
  return status.status === "error" ? status.message : updateButtonLabel(status);
}

export function shouldShowUpdateButton(status: UpdateStatus): boolean {
  return (
    status.status === "available" ||
    status.status === "downloading" ||
    status.status === "ready" ||
    status.status === "checking" ||
    status.status === "error"
  );
}

export function isUpdateButtonDisabled(status: UpdateStatus): boolean {
  return (
    status.status === "downloading" ||
    status.status === "ready" ||
    status.status === "checking"
  );
}

export function canStartUpdate(status: UpdateStatus): boolean {
  return status.status === "available" || status.status === "error";
}
