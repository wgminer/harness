/** App shell views that affect whether in-app Fn dictation is allowed. */
export type HarnessAppView = "chat" | "settings" | "tasks" | "notes" | "clippings";

/** Global Fn dictation is only active while the chat view is showing. */
export function isGlobalFnRecordingEnabledForView(view: HarnessAppView): boolean {
  return view === "chat";
}
