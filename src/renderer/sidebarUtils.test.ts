import { describe, expect, it } from "vitest";
import {
  computeSidebarListLayout,
  effectiveSidebarPeekLayout,
  groupConversations,
  nextSidebarListSortMode,
  pickSidebarConversationsForList,
  sidebarItemPeekFadeLevel,
  sidebarPeekFadeOpacity,
  SIDEBAR_FADE_PEEK_COUNT,
  SIDEBAR_PREVIEW_COUNT_DEFAULT,
} from "./sidebarUtils";

describe("sidebarUtils", () => {
  it("groups conversations into a flat Recent list when requested", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: "older", title: "o", createdAt: now - 40 * day },
      { id: "today", title: "t", createdAt: now },
      { id: "yesterday", title: "y", createdAt: now - day },
    ];
    const grouped = groupConversations(conversations, "recent").groups;
    expect(grouped).toHaveLength(1);
    expect(grouped[0].label).toBe("Recent");
    expect(grouped[0].items.map((c) => c.id)).toEqual(["today", "yesterday", "older"]);
  });

  it("groups conversations by calendar day with weekday and numeric date labels", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: "older", title: "o", createdAt: now - 40 * day },
      { id: "today", title: "t", createdAt: now },
      { id: "yesterday", title: "y", createdAt: now - day },
    ];
    const grouped = groupConversations(conversations, "day").groups;
    expect(grouped).toHaveLength(3);
    expect(grouped[0].items.map((c) => c.id)).toEqual(["today"]);
    expect(grouped[1].items.map((c) => c.id)).toEqual(["yesterday"]);
    expect(grouped[2].items.map((c) => c.id)).toEqual(["older"]);
    for (const group of grouped) {
      expect(group.label).toMatch(/^[A-Za-z]+, \d{1,2}\/\d{1,2}\/\d{4}$/);
    }
  });

  it("cycles sidebar list sort modes", () => {
    expect(nextSidebarListSortMode("date")).toBe("recent");
    expect(nextSidebarListSortMode("recent")).toBe("day");
    expect(nextSidebarListSortMode("day")).toBe("date");
  });

  it("groups conversations by recency buckets", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: "today", title: "t", createdAt: now },
      { id: "yesterday", title: "y", createdAt: now - day },
      { id: "older", title: "o", createdAt: now - 40 * day },
    ];
    const grouped = groupConversations(conversations, "date").groups;
    expect(grouped[0].key).toBe("today");
    expect(grouped[1].key).toBe("yesterday");
    expect(grouped.some((g) => g.key.startsWith("month:"))).toBe(true);
  });

  it("groups items into weeks-ago buckets before months", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: "w1-early", title: "w1e", createdAt: now - 10 * day },
      { id: "w1-late", title: "w1l", createdAt: now - 15 * day },
      { id: "w2-early", title: "w2e", createdAt: now - 17 * day },
      { id: "w2-late", title: "w2l", createdAt: now - 22 * day },
      { id: "monthish", title: "m", createdAt: now - 23 * day },
    ];
    const groups = groupConversations(conversations, "date").groups;
    const labels = groups.map((g) => g.label);
    const oneWeek = groups.find((g) => g.key === "weeks-ago:1");
    const twoWeeks = groups.find((g) => g.key === "weeks-ago:2");
    expect(oneWeek?.label).toBe("1 week ago");
    expect(twoWeeks?.label).toBe("2 weeks ago");
    expect(oneWeek?.items.map((c) => c.id)).toEqual(["w1-early", "w1-late"]);
    expect(twoWeeks?.items.map((c) => c.id)).toEqual(["w2-early", "w2-late"]);
    expect(labels.indexOf("1 week ago")).toBeLessThan(labels.indexOf("2 weeks ago"));
    const monthIdx = groups.findIndex((g) => g.key.startsWith("month:"));
    expect(monthIdx).toBeGreaterThan(labels.indexOf("2 weeks ago"));
    expect(groups[monthIdx].items.map((c) => c.id)).toEqual(["monthish"]);
  });

  it("always includes active conversation in preview", () => {
    const list = [
      { id: "a", title: "a", createdAt: 300 },
      { id: "b", title: "b", createdAt: 200 },
      { id: "c", title: "c", createdAt: 100 },
    ];
    const picked = pickSidebarConversationsForList(list, "c", 2);
    expect(picked.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("assigns progressive peek fade levels for tail rows", () => {
    const preview = SIDEBAR_PREVIEW_COUNT_DEFAULT;
    const fade = SIDEBAR_FADE_PEEK_COUNT;
    expect(sidebarItemPeekFadeLevel(6, preview, fade)).toBeNull();
    expect(sidebarItemPeekFadeLevel(7, preview, fade)).toBe(1);
    expect(sidebarItemPeekFadeLevel(8, preview, fade)).toBe(2);
    expect(sidebarItemPeekFadeLevel(11, preview, fade)).toBe(5);
    expect(sidebarItemPeekFadeLevel(12, preview, fade)).toBeNull();
  });

  it("keeps a peek band when the viewport fits more rows than conversations", () => {
    const tall = computeSidebarListLayout({
      listAreaHeightPx: 800,
      rowHeightPx: 36,
      groupHeaderHeightPx: 28,
      expandRowHeightPx: 40,
      listPaddingPx: 16,
    });
    const peek = effectiveSidebarPeekLayout(tall, 8);
    expect(peek.previewCount).toBeLessThan(tall.previewCount);
    expect(peek.fadePeekCount).toBeGreaterThan(0);
    expect(sidebarItemPeekFadeLevel(7, peek.previewCount, peek.fadePeekCount)).toBeGreaterThan(0);
  });

  it("computes layout from list area height", () => {
    const tall = computeSidebarListLayout({
      listAreaHeightPx: 800,
      rowHeightPx: 36,
      groupHeaderHeightPx: 28,
      expandRowHeightPx: 40,
      listPaddingPx: 16,
    });
    expect(tall.initialVisibleCount).toBeGreaterThan(12);
    expect(tall.previewCount + tall.fadePeekCount).toBe(tall.initialVisibleCount);

    const short = computeSidebarListLayout({
      listAreaHeightPx: 200,
      rowHeightPx: 36,
      groupHeaderHeightPx: 28,
      expandRowHeightPx: 40,
      listPaddingPx: 16,
    });
    expect(short.initialVisibleCount).toBeLessThan(tall.initialVisibleCount);
  });

  it("steps peek fade opacity toward zero", () => {
    expect(sidebarPeekFadeOpacity(1, 5)).toBeCloseTo(0.8);
    expect(sidebarPeekFadeOpacity(5, 5)).toBe(0);
  });
});
