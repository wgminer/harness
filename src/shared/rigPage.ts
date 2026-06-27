/**
 * User-facing name for the workspace configuration page (theme, tools, voice, data, etc.).
 * The persisted view id remains `"settings"` for UI session and IPC.
 */
export const RIG_PAGE_TITLE = "System";

/** Tab label for theme and layout controls (`appearance` tab id). */
export const RIG_APPEARANCE_TAB_LABEL = "Appearance";

/** Tab label for user facts and related controls (`memory` tab id). */
export const RIG_MEMORY_TAB_LABEL = "Memory";

/** Reference a section tab in errors and hints, e.g. "System → Tools". */
export function rigSection(section: string): string {
  return `${RIG_PAGE_TITLE} → ${section}`;
}
