import { describe, expect, it } from "vitest";
import {
  buildMemorySearchHits,
  extractSnippet,
  libraryHref,
  libraryRefFallbackLabel,
  parseLibraryHref,
  searchConversations,
  searchTitleOnly,
  tokenizeQuery,
} from "./conversationSearch";

describe("conversationSearch", () => {
  it("tokenizes and drops stopwords", () => {
    expect(tokenizeQuery("the kitchen renovation")).toEqual(["kitchen", "renovation"]);
  });

  it("matches tokens across words in conversation body", () => {
    const results = searchConversations(
      [
        {
          id: "c1",
          title: "Home project",
          createdAt: 500,
          hasMessages: true,
          messages: [
            { role: "user", content: "We are renovating the kitchen this month." },
            { role: "assistant", content: "Sounds good." },
          ],
        },
      ],
      "kitchen renovation",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("c1");
    expect(results[0]?.snippet.toLowerCase()).toContain("kitchen");
  });

  it("classifies dictation sessions", () => {
    const results = searchConversations(
      [
        {
          id: "d1",
          title: "Dictation @ 3:45 PM",
          createdAt: 300,
          sessionKind: "dictation",
          hasMessages: true,
          messages: [{ role: "user", content: "Budget meeting notes for Q3" }],
        },
      ],
      "budget",
    );
    expect(results[0]?.kind).toBe("dictation");
  });

  it("searches note titles only", () => {
    const results = searchTitleOnly(
      [{ id: "n1", title: "Kitchen remodel plan", activityAt: 100 }],
      "kitchen",
      "note",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe("note");
  });

  it("buildMemorySearchHits caps and mixes kinds", () => {
    const hits = buildMemorySearchHits(
      [
        {
          id: "c1",
          title: "Alpha",
          createdAt: 100,
          hasMessages: true,
          messages: [{ role: "user", content: "alpha thread" }],
        },
        {
          id: "c2",
          title: "Beta",
          createdAt: 200,
          hasMessages: true,
          messages: [{ role: "user", content: "beta thread" }],
        },
      ],
      [{ id: "n1", title: "Alpha note", activityAt: 150 }],
      [{ id: "i1", title: "Alpha image", activityAt: 160 }],
      "alpha",
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.kind === "note")).toBe(true);
    expect(hits.some((h) => h.kind === "image")).toBe(true);
    const chat = hits.find((h) => h.kind === "chat");
    expect(chat?.href).toBe(libraryHref("chat", chat!.id));
  });

  it("parses library hrefs from model citations", () => {
    expect(parseLibraryHref("/c/conv_1784081263054_a0ae74f7")).toEqual({
      target: "conversation",
      id: "conv_1784081263054_a0ae74f7",
    });
    expect(parseLibraryHref("`/n/note_1`")).toEqual({ target: "note", id: "note_1" });
    expect(parseLibraryHref("/i/img_9")).toEqual({ target: "image", id: "img_9" });
    expect(parseLibraryHref("conv_1784081263054_a0ae74f7")).toEqual({
      target: "conversation",
      id: "conv_1784081263054_a0ae74f7",
    });
    expect(parseLibraryHref("https://app.local/c/conv_1")).toEqual({
      target: "conversation",
      id: "conv_1",
    });
    expect(parseLibraryHref("/etc/passwd")).toBeNull();
    expect(libraryRefFallbackLabel("conversation")).toBe("Open chat");
  });

  it("extractSnippet clamps match range", () => {
    const { snippet, snippetMatchRange } = extractSnippet("abc def ghi", 4, 3);
    expect(snippet).toContain("def");
    expect(snippetMatchRange).toEqual([4, 7]);
  });
});
