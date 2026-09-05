import { describe, expect, it } from "vitest";
import {
  arrivedLibraryIds,
  consumeArrivalId,
  conversationArrivalStamp,
  LIBRARY_ARRIVAL_TTL_MS,
  mergeArrivalTimes,
  pruneArrivalTimes,
} from "./libraryArrival";

describe("libraryArrival", () => {
  it("marks new and updated conversations", () => {
    const before = [
      conversationArrivalStamp({
        id: "a",
        title: "Old",
        createdAt: 1,
        hasAssistantReply: false,
        hasMessages: true,
      }),
    ];
    const after = [
      conversationArrivalStamp({
        id: "a",
        title: "New",
        createdAt: 1,
        hasAssistantReply: true,
        hasMessages: true,
      }),
      conversationArrivalStamp({
        id: "b",
        title: "Fresh",
        createdAt: 2,
        hasAssistantReply: false,
        hasMessages: true,
      }),
    ];
    expect(arrivedLibraryIds(before, after).sort()).toEqual(["a", "b"]);
  });

  it("ignores unchanged rows", () => {
    const row = conversationArrivalStamp({
      id: "a",
      title: "Same",
      createdAt: 1,
      hasAssistantReply: true,
      hasMessages: true,
    });
    expect(arrivedLibraryIds([row], [row])).toEqual([]);
  });

  it("prunes expired arrivals and drops consumed ids", () => {
    const now = 1_000_000;
    const merged = mergeArrivalTimes({ stale: now - LIBRARY_ARRIVAL_TTL_MS - 1 }, ["fresh"], now);
    expect(merged.stale).toBeUndefined();
    expect(merged.fresh).toBe(now);
    expect(consumeArrivalId(merged, "fresh")).toEqual({});
  });
});
