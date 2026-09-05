import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_DEBUG_PREFS, parseLayoutDebugPrefs } from "./layoutDebugStorage";

describe("parseLayoutDebugPrefs", () => {
  it("defaults an empty store to an open panel with boxes off", () => {
    expect(parseLayoutDebugPrefs(null)).toEqual(DEFAULT_LAYOUT_DEBUG_PREFS);
  });

  it("reads persisted toggles", () => {
    expect(
      parseLayoutDebugPrefs(
        JSON.stringify({ panelOpen: false, showBoxes: true, hiddenTargetIds: ["scroll"] }),
      ),
    ).toEqual({
      panelOpen: false,
      showBoxes: true,
      hiddenTargetIds: ["scroll"],
    });
  });

  it("ignores invalid JSON", () => {
    expect(parseLayoutDebugPrefs("{")).toEqual(DEFAULT_LAYOUT_DEBUG_PREFS);
  });
});
