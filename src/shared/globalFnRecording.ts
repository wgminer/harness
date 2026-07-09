/**
 * Global Fn dictation gating (desktop):
 *
 * 1. User setting `recording.globalFnHotkey` — starts/stops tray + HarnessFnMonitor (Rust).
 * 2. View gate — `setGlobalEnabled(view === "chat")` when Harness is focused; unfocused dictation always runs if (1) is on.
 * 3. Reducer `Processing` phase — ignores further Fn taps until `recording.done()` (Rust).
 */

export type HarnessAppView = "chat" | "settings" | "tasks" | "notes";

/** Global Fn dictation is only active while the chat view is showing (when app is focused). */
export function isGlobalFnRecordingEnabledForView(view: HarnessAppView): boolean {
  return view === "chat";
}
