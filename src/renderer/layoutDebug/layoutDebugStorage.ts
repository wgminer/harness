export const LAYOUT_DEBUG_STORAGE_KEY = "harness.layout-debug.v1";

export type LayoutDebugPrefs = {
  panelOpen: boolean;
  showBoxes: boolean;
  hiddenTargetIds: string[];
};

export const DEFAULT_LAYOUT_DEBUG_PREFS: LayoutDebugPrefs = {
  panelOpen: true,
  showBoxes: false,
  hiddenTargetIds: [],
};

export function parseLayoutDebugPrefs(raw: string | null): LayoutDebugPrefs {
  if (!raw) return { ...DEFAULT_LAYOUT_DEBUG_PREFS };
  try {
    const parsed = JSON.parse(raw) as Partial<LayoutDebugPrefs>;
    return {
      panelOpen: parsed.panelOpen !== false,
      showBoxes: parsed.showBoxes === true,
      hiddenTargetIds: Array.isArray(parsed.hiddenTargetIds)
        ? parsed.hiddenTargetIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { ...DEFAULT_LAYOUT_DEBUG_PREFS };
  }
}

export function readLayoutDebugPrefs(): LayoutDebugPrefs {
  try {
    return parseLayoutDebugPrefs(window.localStorage.getItem(LAYOUT_DEBUG_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_LAYOUT_DEBUG_PREFS };
  }
}

export function writeLayoutDebugPrefs(prefs: LayoutDebugPrefs): void {
  try {
    window.localStorage.setItem(LAYOUT_DEBUG_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota / private-mode failures.
  }
}
