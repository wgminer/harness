import type { ConversationListRow } from "../shared/conversationSession";

export type Conversation = ConversationListRow;

export type View = "chat" | "settings" | "tasks" | "notes" | "images";

export type LibraryItemKind = "conversation" | "note" | "image";

/** A sidebar row — either a conversation or a note, sharing the same sort/group shape. */
export type LibraryRow = ConversationListRow & { itemKind?: LibraryItemKind };

/** Default number of conversations shown in the sidebar before "More". */
export const SIDEBAR_INITIAL_VISIBLE_COUNT = 20;
/** Each "More" click adds this many conversations to the sidebar list. */
export const SIDEBAR_MORE_INCREMENT = 20;

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

export type SidebarGroup = { key: string; label: string; items: LibraryRow[] };

export type SidebarListSortMode = "date" | "recent" | "day";

export const SIDEBAR_LIST_SORT_MODES: SidebarListSortMode[] = ["date", "recent", "day"];

export function nextSidebarListSortMode(mode: SidebarListSortMode): SidebarListSortMode {
  const index = SIDEBAR_LIST_SORT_MODES.indexOf(mode);
  return SIDEBAR_LIST_SORT_MODES[(index + 1) % SIDEBAR_LIST_SORT_MODES.length];
}

function getCalendarDayLabel(key: string): string {
  const d = new Date(key + "T12:00:00");
  const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
  const numericDate = d.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });
  return `${weekday}, ${numericDate}`;
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
      groups.push({ key, label: getCalendarDayLabel(key), items });
    }
  }

  return { groups };
}

export function groupConversations(
  conversations: LibraryRow[],
  sortMode: SidebarListSortMode = "recent"
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

/** Sidebar list: newest N by default; always includes the active conversation when not showing all. */
export function pickSidebarConversationsForList(
  conversations: LibraryRow[],
  activeId: string | null,
  previewCount: number
): LibraryRow[] {
  if (conversations.length <= previewCount) {
    return conversations;
  }
  const sorted = [...conversations].sort((a, b) => b.createdAt - a.createdAt);
  const top = sorted.slice(0, previewCount);
  if (!activeId) return top;
  if (top.some((c) => c.id === activeId)) return top;
  const active = conversations.find((c) => c.id === activeId);
  if (!active) return top;
  return [...sorted.slice(0, previewCount - 1), active];
}
