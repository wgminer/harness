import {
  conversationSidebarIconKind,
  type ConversationListRow,
} from "../../shared/conversationSession";

export type Conversation = ConversationListRow;

export type View =
  | "chat"
  | "settings"
  | "tasks"
  | "notes"
  | "images"
  | "dev-chat"
  | "dev-dictation"
  | "dev-note"
  | "dev-image";

export type DevView = "dev-chat" | "dev-dictation" | "dev-note" | "dev-image";

export function isDevView(view: View): view is DevView {
  return (
    view === "dev-chat" ||
    view === "dev-dictation" ||
    view === "dev-note" ||
    view === "dev-image"
  );
}

export type LibraryItemKind = "conversation" | "note" | "image";

/** A sidebar row — either a conversation or a note, sharing the same sort/group shape. */
export type LibraryRow = ConversationListRow & { itemKind?: LibraryItemKind };

/** Sidebar "Show" filter: everything, or one kind of library item. */
export type SidebarLibraryFilter = "all" | "chat" | "dictation" | "note" | "image";

export const SIDEBAR_LIBRARY_FILTERS: { value: SidebarLibraryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chats" },
  { value: "dictation", label: "Dictations" },
  { value: "note", label: "Notes" },
  { value: "image", label: "Images" },
];

export function sidebarLibraryFilterLabel(filter: SidebarLibraryFilter): string {
  return SIDEBAR_LIBRARY_FILTERS.find((f) => f.value === filter)?.label ?? "All";
}

/** Chats vs dictations follow the sidebar icon (a dictation with a reply reads as a chat). */
export function libraryRowMatchesFilter(row: LibraryRow, filter: SidebarLibraryFilter): boolean {
  if (filter === "all") return true;
  const kind = row.itemKind ?? "conversation";
  if (filter === "note" || filter === "image") return kind === filter;
  if (kind !== "conversation") return false;
  return conversationSidebarIconKind(row) === filter;
}

/** New notes start as "# Note"; show that (or an empty title) as untitled. */
export const UNTITLED_NOTE_LABEL = "Untitled note";

export function isUntitledNoteTitle(displayTitle: string): boolean {
  const t = displayTitle.trim();
  return t === "" || t === "Note";
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns a sortable key:
 * - today | yesterday
 * - YYYY-MM-DD for each of the 7 calendar days 2–8 days ago (labeled by weekday in the UI)
 * - weeks-ago:1 for days 9–15 ago
 * - weeks-ago:2 for days 16–22 ago
 * - month:YYYY-MM for anything older
 */
function getDateGroupKey(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - MS_PER_DAY;
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (dateStart >= todayStart) return "today";
  if (dateStart >= yesterdayStart) return "yesterday";
  const daysAgo = Math.floor((todayStart - dateStart) / MS_PER_DAY);
  if (daysAgo >= 2 && daysAgo <= 8) {
    return localDateKey(date);
  }
  if (daysAgo >= 9 && daysAgo <= 15) {
    return "weeks-ago:1";
  }
  if (daysAgo >= 16 && daysAgo <= 22) {
    return "weeks-ago:2";
  }
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  return `month:${y}-${mo}`;
}

function getDateGroupLabel(key: string): string {
  if (key === "today") return "Today";
  if (key === "yesterday") return "Yesterday";
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(key + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (key.startsWith("weeks-ago:")) {
    const n = parseInt(key.slice("weeks-ago:".length), 10);
    return `${n} ${n === 1 ? "week" : "weeks"} ago`;
  }
  if (key.startsWith("month:")) {
    const ym = key.slice("month:".length);
    const [yStr, mStr] = ym.split("-");
    const y = parseInt(yStr, 10);
    const d = new Date(y, parseInt(mStr, 10) - 1, 1);
    const now = new Date();
    return d.toLocaleDateString(undefined, {
      month: "long",
      year: y !== now.getFullYear() ? "numeric" : undefined,
    });
  }
  return key;
}

export type SidebarGroup = { key: string; label: string; weekday?: string; items: LibraryRow[] };

/** Sidebar list grouping: relative date buckets, flat recent, or calendar days. */
export type SidebarListSortMode = "date" | "recent" | "day";

export const SIDEBAR_LIST_SORT_MODES: { value: SidebarListSortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "date", label: "Time ago" },
  { value: "day", label: "Calendar day" },
];

export function sidebarListSortModeLabel(mode: SidebarListSortMode): string {
  return SIDEBAR_LIST_SORT_MODES.find((m) => m.value === mode)?.label ?? "Recent";
}

function getCalendarDayParts(key: string): { label: string; weekday: string } {
  const d = new Date(key + "T12:00:00");
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
    label: `${d.getMonth() + 1}·${d.getDate()}·${d.getFullYear()}`,
  };
}

function groupConversationsByCalendarDay(conversations: LibraryRow[]): { groups: SidebarGroup[] } {
  const byKey = new Map<string, LibraryRow[]>();
  for (const c of conversations) {
    const key = localDateKey(new Date(c.createdAt));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(c);
  }
  for (const items of byKey.values()) {
    items.sort((a, b) => b.createdAt - a.createdAt);
  }

  const groups: SidebarGroup[] = [];
  for (const key of Array.from(byKey.keys()).sort((a, b) => b.localeCompare(a))) {
    const items = byKey.get(key);
    if (items?.length) {
      groups.push({ key, ...getCalendarDayParts(key), items });
    }
  }

  return { groups };
}

/**
 * Group library rows by sort mode:
 * - date: Today / Yesterday / weekday / weeks ago / month
 * - recent: single flat Recent list
 * - day: one group per calendar day
 */
export function groupConversations(
  conversations: LibraryRow[],
  sortMode: SidebarListSortMode = "recent",
): { groups: SidebarGroup[] } {
  if (sortMode === "recent") {
    const items = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
    if (items.length === 0) return { groups: [] };
    return { groups: [{ key: "recent", label: "Recent", items }] };
  }

  if (sortMode === "day") {
    return groupConversationsByCalendarDay(conversations);
  }

  const byKey = new Map<string, LibraryRow[]>();
  for (const c of conversations) {
    const key = getDateGroupKey(c.createdAt);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(c);
  }
  for (const items of byKey.values()) {
    items.sort((a, b) => b.createdAt - a.createdAt);
  }

  const now = new Date();
  const keyOrder: string[] = ["today", "yesterday"];
  for (let d = 2; d <= 8; d++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    t.setDate(t.getDate() - d);
    keyOrder.push(localDateKey(t));
  }
  keyOrder.push("weeks-ago:1", "weeks-ago:2");

  const monthKeys = Array.from(byKey.keys())
    .filter((k) => k.startsWith("month:"))
    .sort((a, b) => b.localeCompare(a));
  keyOrder.push(...monthKeys);

  const groups: SidebarGroup[] = [];
  for (const key of keyOrder) {
    const items = byKey.get(key);
    if (items?.length) {
      groups.push({ key, label: getDateGroupLabel(key), items });
    }
  }

  return { groups };
}
