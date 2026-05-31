export type UiSessionView = "chat" | "settings" | "tasks" | "notes" | "clippings";

export interface UiSession {
  view: UiSessionView;
  conversationId: string | null;
  notesOpenNoteId: string | null;
}

export const DEFAULT_UI_SESSION: UiSession = {
  view: "chat",
  conversationId: null,
  notesOpenNoteId: null,
};

const UI_SESSION_VIEWS: UiSessionView[] = ["chat", "settings", "tasks", "notes", "clippings"];

function isUiSessionView(value: unknown): value is UiSessionView {
  return typeof value === "string" && UI_SESSION_VIEWS.includes(value as UiSessionView);
}

function normalizeOptionalId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeUiSession(raw: unknown): UiSession {
  if (raw == null || typeof raw !== "object") return { ...DEFAULT_UI_SESSION };
  const data = raw as Record<string, unknown>;
  return {
    view: isUiSessionView(data.view) ? data.view : DEFAULT_UI_SESSION.view,
    conversationId: normalizeOptionalId(data.conversationId),
    notesOpenNoteId: normalizeOptionalId(data.notesOpenNoteId),
  };
}
