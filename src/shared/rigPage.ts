/**
 * User-facing name for the workspace configuration page (theme, tools, voice, data, etc.).
 * The persisted view id remains `"settings"` for UI session and IPC.
 */
export const RIG_PAGE_TITLE = "System";

/** Tab label for notes windows and editor templates (`notes` tab id). */
export const RIG_NOTES_TAB_LABEL = "Notes";

/** Reference a section tab in errors and hints, e.g. "System → Tools". */
export function rigSection(section: string): string {
  return `${RIG_PAGE_TITLE} → ${section}`;
}
