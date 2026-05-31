import type { ConversationListRow } from "../shared/conversationSession";

export type Conversation = ConversationListRow;

export type View = "chat" | "settings" | "tasks" | "notes" | "clippings";

/** Fully opaque conversations shown before the progressive fade peek rows. */
export const SIDEBAR_PREVIEW_COUNT_DEFAULT = 7;
export const SIDEBAR_PREVIEW_COUNT_MIN = 3;
/** Peek rows after the preview count; each fades further toward zero opacity. */
export const SIDEBAR_FADE_PEEK_COUNT = 5;
export const SIDEBAR_FADE_PEEK_COUNT_MIN = 2;
export const SIDEBAR_FADE_PEEK_COUNT_MAX = 12;
/** Default sidebar list size: preview rows plus fade peek rows. */
export const SIDEBAR_INITIAL_VISIBLE_COUNT =
  SIDEBAR_PREVIEW_COUNT_DEFAULT + SIDEBAR_FADE_PEEK_COUNT;
/** Each "More" click adds this many conversations to the sidebar list. */
export const SIDEBAR_MORE_INCREMENT = 20;

export type SidebarListLayout = {
  previewCount: number;
  fadePeekCount: number;
  initialVisibleCount: number;
};

export type SidebarListLayoutMetrics = {
  listAreaHeightPx: number;
  rowHeightPx: number;
  groupHeaderHeightPx: number;
  expandRowHeightPx: number;
  listPaddingPx: number;
};

export const SIDEBAR_LIST_LAYOUT_DEFAULTS: SidebarListLayoutMetrics = {
  listAreaHeightPx: 0,
  rowHeightPx: 36,
  groupHeaderHeightPx: 28,
  expandRowHeightPx: 40,
  listPaddingPx: 16,
};

/** Opacity for a peek-fade row (level 1 = lightest fade, level N = invisible). */
export function sidebarPeekFadeOpacity(level: number, fadePeekCount: number): number {
  if (fadePeekCount <= 0 || level <= 0) return 1;
  return Math.max(0, (fadePeekCount - level) / fadePeekCount);
}

/**
 * Conversation rows that fit in the sidebar list area (opaque preview + fade peek band).
 * Uses measured chrome when `listAreaHeightPx` is known; otherwise returns the static default.
 */
function mergeSidebarLayoutMetrics(
  metrics: Partial<SidebarListLayoutMetrics>
): SidebarListLayoutMetrics {
  const merged = { ...SIDEBAR_LIST_LAYOUT_DEFAULTS };
  for (const key of Object.keys(metrics) as (keyof SidebarListLayoutMetrics)[]) {
    const value = metrics[key];
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

export function computeSidebarListLayout(
  metrics: Partial<SidebarListLayoutMetrics> = {}
): SidebarListLayout {
  const {
    listAreaHeightPx,
    rowHeightPx,
    groupHeaderHeightPx,
    expandRowHeightPx,
    listPaddingPx,
  } = mergeSidebarLayoutMetrics(metrics);

  const defaultLayout: SidebarListLayout = {
    previewCount: SIDEBAR_PREVIEW_COUNT_DEFAULT,
    fadePeekCount: SIDEBAR_FADE_PEEK_COUNT,
    initialVisibleCount: SIDEBAR_INITIAL_VISIBLE_COUNT,
  };

  if (listAreaHeightPx <= 0 || rowHeightPx <= 0) {
    return defaultLayout;
  }

  const chrome = listPaddingPx + groupHeaderHeightPx + expandRowHeightPx;
  const rowBudget = listAreaHeightPx - chrome;
  const minRows = SIDEBAR_PREVIEW_COUNT_MIN + SIDEBAR_FADE_PEEK_COUNT_MIN;
  if (rowBudget < rowHeightPx * minRows) {
    return {
      previewCount: SIDEBAR_PREVIEW_COUNT_MIN,
      fadePeekCount: SIDEBAR_FADE_PEEK_COUNT_MIN,
      initialVisibleCount: minRows,
    };
  }

  const totalRows = Math.floor(rowBudget / rowHeightPx);
  let fadePeekCount = Math.round(totalRows * 0.35);
  fadePeekCount = Math.min(
    SIDEBAR_FADE_PEEK_COUNT_MAX,
    Math.max(SIDEBAR_FADE_PEEK_COUNT_MIN, fadePeekCount)
  );
  let previewCount = Math.max(SIDEBAR_PREVIEW_COUNT_MIN, totalRows - fadePeekCount);
  if (previewCount + fadePeekCount > totalRows) {
    fadePeekCount = Math.max(SIDEBAR_FADE_PEEK_COUNT_MIN, totalRows - previewCount);
  }

  return {
    previewCount,
    fadePeekCount,
    initialVisibleCount: previewCount + fadePeekCount,
  };
}

/**
 * Peek-fade band for the rows actually on screen. When the viewport fits more rows than
 * there are conversations, shrink the opaque preview band so tail rows still fade.
 */
export function effectiveSidebarPeekLayout(
  layout: SidebarListLayout,
  displayedCount: number
): SidebarListLayout {
  if (displayedCount <= 0) {
    return { previewCount: 0, fadePeekCount: 0, initialVisibleCount: 0 };
  }
  const fadePeekCount = Math.min(
    layout.fadePeekCount,
    Math.max(SIDEBAR_FADE_PEEK_COUNT_MIN, displayedCount - 1)
  );
  const previewCount = Math.min(
    layout.previewCount,
    Math.max(1, displayedCount - fadePeekCount)
  );
  return {
    previewCount,
    fadePeekCount,
    initialVisibleCount: previewCount + fadePeekCount,
  };
}

/** Fade tier for peek rows; null when the row is fully opaque. */
export function sidebarItemPeekFadeLevel(
  flatIndex: number,
  previewCount: number,
  fadePeekCount: number
): number | null {
  if (flatIndex < previewCount) return null;
  const peekIndex = flatIndex - previewCount;
  if (peekIndex >= fadePeekCount) return null;
  return peekIndex + 1;
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

export type SidebarGroup = { key: string; label: string; items: Conversation[] };

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

function groupConversationsByCalendarDay(conversations: Conversation[]): { groups: SidebarGroup[] } {
  const byKey = new Map<string, Conversation[]>();
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
  conversations: Conversation[],
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

  const byKey = new Map<string, Conversation[]>();
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
  conversations: Conversation[],
  activeId: string | null,
  previewCount: number
): Conversation[] {
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
