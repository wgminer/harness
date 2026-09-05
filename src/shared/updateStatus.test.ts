import { describe, expect, it } from "vitest";
import {
  canStartUpdate,
  isUpdateButtonDisabled,
  shouldShowUpdateButton,
  updateButtonLabel,
  updateButtonTitle,
} from "./updateStatus";

describe("update button presentation", () => {
  it("labels available, progress, ready, and error states", () => {
    expect(updateButtonLabel({ status: "available", version: "1.2.3" })).toBe("Update to v1.2.3");
    expect(updateButtonLabel({ status: "downloading", percent: 42 })).toBe("Updating… 42%");
    expect(updateButtonLabel({ status: "ready" })).toBe("Restarting…");
    expect(updateButtonLabel({ status: "error", message: "signature mismatch" })).toBe(
      "Update failed",
    );
  });

  it("puts the error message on the tooltip so a failed install can be retried", () => {
    expect(updateButtonTitle({ status: "error", message: "No update available" })).toBe(
      "No update available",
    );
    expect(updateButtonTitle({ status: "available", version: "1.2.3" })).toBe("Update to v1.2.3");
  });

  it("shows the button for in-flight and failed installs, and allows retry after error", () => {
    expect(shouldShowUpdateButton({ status: "available", version: "1.0.0" })).toBe(true);
    expect(shouldShowUpdateButton({ status: "error", message: "network" })).toBe(true);
    expect(shouldShowUpdateButton({ status: "idle" })).toBe(false);
    expect(isUpdateButtonDisabled({ status: "downloading", percent: 10 })).toBe(true);
    expect(isUpdateButtonDisabled({ status: "error", message: "network" })).toBe(false);
    expect(canStartUpdate({ status: "available", version: "1.0.0" })).toBe(true);
    expect(canStartUpdate({ status: "error", message: "network" })).toBe(true);
    expect(canStartUpdate({ status: "checking" })).toBe(false);
  });
});
