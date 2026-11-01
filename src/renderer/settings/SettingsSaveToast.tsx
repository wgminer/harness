import { createPortal } from "react-dom";
import type { SaveStatus } from "./useSettingsForm";

export function SettingsSaveToast({
  status,
}: {
  status: SaveStatus;
}) {
  const open = status !== "idle";
  const label =
    status === "saving" ? "Saving…" : status === "error" ? "Could not save settings" : "Saved";
  return createPortal(
    <div
      className="settings-toast"
      data-testid="settings-toast"
      data-status={status}
      role="status"
      aria-live="polite"
      aria-hidden={!open}
      style={{ display: open ? "block" : "none" }}
    >
      {label}
    </div>,
    document.body,
  );
}
