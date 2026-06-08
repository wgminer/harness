export type UiSessionView = "chat" | "settings" | "tasks" | "notes";

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

const UI_SESSION_VIEWS: UiSessionView[] = ["chat", "settings", "tasks", "notes"];

function isUiSessionView(value: unknown): value is UiSessionView {
  return typeof value === "string" && UI_SESSION_VIEWS.includes(value as UiSessionView);
}

function normalizeUiSessionView(value: unknown): UiSessionView {
  if (value === "clippings") return "notes";
  return isUiSessionView(value) ? value : DEFAULT_UI_SESSION.view;
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
    view: normalizeUiSessionView(data.view),
    conversationId: normalizeOptionalId(data.conversationId),
    notesOpenNoteId: normalizeOptionalId(data.notesOpenNoteId),
  };
}
