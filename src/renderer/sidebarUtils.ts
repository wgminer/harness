export type Conversation = { id: string; title: string | null; createdAt: number };

export type View = "chat" | "settings" | "tasks";

export const SIDEBAR_PREVIEW_COUNT_DEFAULT = 7;
export const SIDEBAR_PREVIEW_COUNT_MIN = 3;
export const SIDEBAR_PREVIEW_COUNT_MAX = 50;
/** Pixels of vertical drag per ±1 preview item (larger = less sensitive). */
export const SIDEBAR_PREVIEW_ROW_PX = 35;
export const SIDEBAR_PREVIEW_STORAGE_KEY = "harness.sidebarConversationPreviewCount";

export function clampSidebarPreviewCount(n: number): number {
  return Math.min(SIDEBAR_PREVIEW_COUNT_MAX, Math.max(SIDEBAR_PREVIEW_COUNT_MIN, Math.round(n)));
}

export function loadSidebarPreviewCount(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_PREVIEW_STORAGE_KEY);
    if (raw == null) return SIDEBAR_PREVIEW_COUNT_DEFAULT;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return SIDEBAR_PREVIEW_COUNT_DEFAULT;
    return clampSidebarPreviewCount(parsed);
  } catch {
    return SIDEBAR_PREVIEW_COUNT_DEFAULT;
  }
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
 * - earlier-in:YYYY-MM for the rest of the current calendar month
 * - month:YYYY-MM for prior full months
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
  const sameMonth =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (sameMonth && daysAgo >= 9) {
    return `earlier-in:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
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
  if (key.startsWith("earlier-in:")) {
    const ym = key.slice("earlier-in:".length);
    const [yStr, mStr] = ym.split("-");
    const d = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, 1);
    const monthName = d.toLocaleDateString(undefined, { month: "long" });
    return `Earlier in ${monthName}`;
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

export function groupConversations(conversations: Conversation[]): { groups: SidebarGroup[] } {
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
  const cy = now.getFullYear();
  const cm = String(now.getMonth() + 1).padStart(2, "0");
  keyOrder.push(`earlier-in:${cy}-${cm}`);

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

/** Sidebar list: newest N by default; always includes the active conversation when collapsed. */
export function pickSidebarConversationsForList(
  conversations: Conversation[],
  listExpanded: boolean,
  activeId: string | null,
  previewCount: number
): Conversation[] {
  if (listExpanded || conversations.length <= previewCount) {
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
