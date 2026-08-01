/**
 * User-facing name for the workspace configuration page (theme, tools, voice, data, etc.).
 * The persisted view id remains `"settings"` for UI session and IPC.
 */
export const SETTINGS_PAGE_TITLE = "System";

/** Tab label for notes windows and editor templates (`notes` tab id). */
export const SETTINGS_NOTES_TAB_LABEL = "Notes";

/** Reference a section tab in errors and hints, e.g. "System → Data". */
export function settingsSection(section: string): string {
  return `${SETTINGS_PAGE_TITLE} → ${section}`;
}
