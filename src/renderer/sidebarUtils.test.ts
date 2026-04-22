import { describe, expect, it } from "vitest";
import { groupConversations, pickSidebarConversationsForList } from "./sidebarUtils";

describe("sidebarUtils", () => {
  it("groups conversations by recency buckets", () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const conversations = [
      { id: "today", title: "t", createdAt: now },
      { id: "yesterday", title: "y", createdAt: now - day },
      { id: "older", title: "o", createdAt: now - 40 * day },
    ];
    const grouped = groupConversations(conversations).groups;
    expect(grouped[0].key).toBe("today");
    expect(grouped[1].key).toBe("yesterday");
    expect(grouped.some((g) => g.key.startsWith("month:"))).toBe(true);
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
});
