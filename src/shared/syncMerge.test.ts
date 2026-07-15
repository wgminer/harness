import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDefaultMergeChoices,
  buildMergedFileMap,
  buildSyncConflictReview,
  mergeFileBytes,
} from "./syncMerge";

const FIXTURES = join(import.meta.dirname, "fixtures", "syncMerge");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8").replace(/\n$/, "");
}

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
  it("emits canonical JSON for conversations merge (golden fixture)", () => {
    const merged = mergeFileBytes(
      "app-state/conversations.json",
      Buffer.from(JSON.stringify({ a: { title: "A", createdAt: 1 } })),
      Buffer.from(JSON.stringify({ b: { title: "B", createdAt: 2 } })),
    );
    expect(merged.toString("utf-8")).toBe(readFixture("conversations-merge.expected.json"));
  });

  it("emits canonical JSON for tasks merge (golden fixture)", () => {
    const merged = mergeFileBytes(
      "app-state/tasks.json",
      Buffer.from(JSON.stringify({ tasks: [{ id: "t1", title: "Local", updatedAt: 20 }] })),
      Buffer.from(
        JSON.stringify({
          tasks: [
            { id: "t1", title: "Remote", updatedAt: 10 },
            { id: "t2", title: "Only remote", updatedAt: 5 },
          ],
        }),
      ),
    );
    expect(merged.toString("utf-8")).toBe(readFixture("tasks-merge.expected.json"));
  });

  it("emits canonical JSON for messages merge with sorted-key dedup stamps (golden fixture)", () => {
    const merged = mergeFileBytes(
      "app-state/messages_abc.json",
      Buffer.from(
        JSON.stringify([
          { id: "m1", role: "user", content: "hi", createdAt: 1 },
          { id: "m2", role: "assistant", content: "dup", createdAt: 2 },
        ]),
      ),
      Buffer.from(
        JSON.stringify([
          { role: "assistant", content: "dup", createdAt: 2, id: "m2" },
          { id: "m3", role: "user", content: "new", createdAt: 3 },
        ]),
      ),
    );
    expect(merged.toString("utf-8")).toBe(readFixture("messages-merge.expected.json"));
  });

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

  it("never merges remote api keys in settings.json", () => {
    const merged = mergeFileBytes(
      "settings/settings.json",
      Buffer.from(JSON.stringify({ version: 1, openai: { apiKey: "local" }, sync: { bucket: "local-b" } })),
      Buffer.from(JSON.stringify({ version: 1, openai: { apiKey: "remote" }, sync: { bucket: "remote-b" } })),
    );
    const parsed = JSON.parse(merged.toString("utf-8")) as Record<string, unknown>;
    expect((parsed.openai as Record<string, unknown> | undefined)?.apiKey).toBeUndefined();
    expect((parsed.sync as { bucket: string }).bucket).toBe("local-b");
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

  it("ignores legacy plans.json without failing", () => {
    const review = buildSyncConflictReview(
      {
        "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
        "app-state/plans.json": Buffer.from('{"old":true}'),
      },
      {
        "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
        "app-state/plans.json": Buffer.from('{"old":"remote"}'),
      },
    );
    expect(review.files.find((f) => f.path === "app-state/plans.json")).toBeUndefined();
    expect(review.summary.conflict).toBe(0);

    const merged = buildMergedFileMap(
      {
        "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
        "app-state/plans.json": Buffer.from('{"old":true}'),
      },
      {
        "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
        "app-state/plans.json": Buffer.from('{"old":"remote"}'),
      },
      buildDefaultMergeChoices(review),
    );
    expect(merged["app-state/plans.json"]).toBeUndefined();
    expect(merged["app-state/tasks.json"]?.toString("utf-8")).toBe('{"tasks":[]}');
  });
});
