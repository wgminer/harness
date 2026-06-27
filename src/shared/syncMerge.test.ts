import { describe, expect, it } from "vitest";
import {
  buildDefaultMergeChoices,
  buildMergedFileMap,
  buildSyncConflictReview,
  mergeFileBytes,
} from "./syncMerge";

describe("buildSyncConflictReview", () => {
  it("classifies unchanged, local-only, remote-only, and conflict files", () => {
    const review = buildSyncConflictReview(
      {
        "app-state/a.json": Buffer.from('{"local":1}'),
        "app-state/shared.json": Buffer.from('{"same":true}'),
        "app-state/conflict.json": Buffer.from('{"from":"local"}'),
      },
      {
        "app-state/shared.json": Buffer.from('{"same":true}'),
        "app-state/b.json": Buffer.from('{"remote":1}'),
        "app-state/conflict.json": Buffer.from('{"from":"remote"}'),
      },
    );

    expect(review.summary).toEqual({
      unchanged: 1,
      localOnly: 1,
      remoteOnly: 1,
      conflict: 1,
    });
    expect(review.files.find((f) => f.path === "app-state/a.json")?.kind).toBe("local-only");
    expect(review.files.find((f) => f.path === "app-state/b.json")?.kind).toBe("remote-only");
    expect(review.files.find((f) => f.path === "app-state/conflict.json")?.kind).toBe("conflict");
  });
});

describe("mergeFileBytes", () => {
  it("merges conversation records by id", () => {
    const merged = mergeFileBytes(
      "app-state/conversations.json",
      Buffer.from(JSON.stringify({ a: { title: "A", createdAt: 1 } })),
      Buffer.from(JSON.stringify({ b: { title: "B", createdAt: 2 } })),
    );
    expect(JSON.parse(merged.toString("utf-8"))).toEqual({
      a: { title: "A", createdAt: 1 },
      b: { title: "B", createdAt: 2 },
    });
  });

  it("merges tasks by id preferring newer updatedAt", () => {
    const merged = mergeFileBytes(
      "app-state/tasks.json",
      Buffer.from(
        JSON.stringify({
          tasks: [{ id: "t1", title: "Local", updatedAt: 20 }],
        }),
      ),
      Buffer.from(
        JSON.stringify({
          tasks: [{ id: "t1", title: "Remote", updatedAt: 10 }, { id: "t2", title: "Only remote", updatedAt: 5 }],
        }),
      ),
    );
    const parsed = JSON.parse(merged.toString("utf-8")) as { tasks: { id: string; title: string }[] };
    const byId = Object.fromEntries(parsed.tasks.map((t) => [t.id, t.title]));
    expect(byId.t1).toBe("Local");
    expect(byId.t2).toBe("Only remote");
  });

  it("merges theme.json preferring newer updatedAt", () => {
    const merged = mergeFileBytes(
      "themes/theme.json",
      Buffer.from(
        JSON.stringify({
          accent: "#f2ff00",
          fg: "#e6edf3",
          bg: "#0d1117",
          font: "inter",
          fontMono: "sf",
          fontSize: 14,
          updatedAt: 100,
        }),
      ),
      Buffer.from(
        JSON.stringify({
          accent: "#9a7b52",
          fg: "#3d3832",
          bg: "#f4efe6",
          font: "lora",
          fontMono: "fira_code",
          fontSize: 16,
          updatedAt: 200,
        }),
      ),
    );
    const parsed = JSON.parse(merged.toString("utf-8")) as Record<string, unknown>;
    expect(parsed.bg).toBe("#f4efe6");
    expect(parsed.font).toBe("lora");
    expect(parsed.updatedAt).toBe(200);
  });
});

describe("buildMergedFileMap", () => {
  it("applies per-file choices", () => {
    const review = buildSyncConflictReview(
      {
        "app-state/local-only.json": Buffer.from('{"local":true}'),
        "app-state/conflict.json": Buffer.from('{"from":"local"}'),
      },
      {
        "app-state/remote-only.json": Buffer.from('{"remote":true}'),
        "app-state/conflict.json": Buffer.from('{"from":"remote"}'),
      },
    );
    const choices = buildDefaultMergeChoices(review);
    choices["app-state/conflict.json"] = "remote";

    const merged = buildMergedFileMap(
      {
        "app-state/local-only.json": Buffer.from('{"local":true}'),
        "app-state/conflict.json": Buffer.from('{"from":"local"}'),
      },
      {
        "app-state/remote-only.json": Buffer.from('{"remote":true}'),
        "app-state/conflict.json": Buffer.from('{"from":"remote"}'),
      },
      choices,
    );

    expect(merged["app-state/local-only.json"]?.toString("utf-8")).toBe('{"local":true}');
    expect(merged["app-state/remote-only.json"]?.toString("utf-8")).toBe('{"remote":true}');
    expect(merged["app-state/conflict.json"]?.toString("utf-8")).toBe('{"from":"remote"}');
  });
});
