import { describe, expect, it } from "vitest";
import {
  groupConversations,
  nextSidebarListSortMode,
  pickSidebarConversationsForList,
  SIDEBAR_INITIAL_VISIBLE_COUNT,
  SIDEBAR_MORE_INCREMENT,
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

  it("defaults to 20 visible conversations with 20 more per click", () => {
    expect(SIDEBAR_INITIAL_VISIBLE_COUNT).toBe(20);
    expect(SIDEBAR_MORE_INCREMENT).toBe(20);
  });
});
