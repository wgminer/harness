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
    const choices = buildDefaultMergeChoices(review, {
      "app-state/local-only.json": Buffer.from('{"local":true}'),
      "app-state/conflict.json": Buffer.from('{"from":"local"}'),
    }, {
      "app-state/remote-only.json": Buffer.from('{"remote":true}'),
      "app-state/conflict.json": Buffer.from('{"from":"remote"}'),
    });
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

    const local = {
      "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
      "app-state/plans.json": Buffer.from('{"old":true}'),
    };
    const remote = {
      "app-state/tasks.json": Buffer.from('{"tasks":[]}'),
      "app-state/plans.json": Buffer.from('{"old":"remote"}'),
    };
    const merged = buildMergedFileMap(
      local,
      remote,
      buildDefaultMergeChoices(review, local, remote),
    );
    expect(merged["app-state/plans.json"]).toBeUndefined();
    expect(merged["app-state/tasks.json"]?.toString("utf-8")).toBe('{"tasks":[]}');
  });

  it("merges image records without resurrecting tombstoned versions", () => {
    const local = Buffer.from(
      JSON.stringify({
        images: [
          {
            id: "img",
            title: "Local",
            prompt: "",
            createdAt: 1,
            updatedAt: 200,
            size: "auto",
            quality: "auto",
            background: "auto",
            outputFormat: "png",
            hasFile: true,
            absolutePath: "/tmp/a2.png",
            activeVersionId: "v2",
            deletedVersionIds: ["v1"],
            versions: [
              {
                id: "v2",
                parentId: null,
                branch: "A",
                indexInBranch: 1,
                fileName: "a2.png",
                prompt: "",
                kind: "generate",
                size: "auto",
                quality: "auto",
                background: "auto",
                outputFormat: "png",
                createdAt: 20,
              },
            ],
          },
        ],
      }),
    );
    const remote = Buffer.from(
      JSON.stringify({
        images: [
          {
            id: "img",
            title: "Remote",
            prompt: "",
            createdAt: 1,
            updatedAt: 100,
            size: "auto",
            quality: "auto",
            background: "auto",
            outputFormat: "png",
            hasFile: true,
            absolutePath: "/tmp/a1.png",
            activeVersionId: "v1",
            versions: [
              {
                id: "v1",
                parentId: null,
                branch: "A",
                indexInBranch: 1,
                fileName: "a1.png",
                prompt: "",
                kind: "generate",
                size: "auto",
                quality: "auto",
                background: "auto",
                outputFormat: "png",
                createdAt: 10,
              },
              {
                id: "v2",
                parentId: "v1",
                branch: "A",
                indexInBranch: 2,
                fileName: "a2.png",
                prompt: "",
                kind: "generate",
                size: "auto",
                quality: "auto",
                background: "auto",
                outputFormat: "png",
                createdAt: 20,
              },
            ],
          },
        ],
      }),
    );
    const merged = mergeFileBytes("app-state/images.json", local, remote);
    const image = (JSON.parse(merged.toString("utf-8")).images as { id: string }[])[0] as {
      versions: { id: string }[];
      deletedVersionIds: string[];
      activeVersionId: string;
    };
    expect(image.versions.map((v) => v.id)).toEqual(["v2"]);
    expect(image.deletedVersionIds).toEqual(["v1"]);
    expect(image.activeVersionId).toBe("v2");
  });

  it("merges images per record and keeps referenced blobs from both sides", () => {
    const localIndex = Buffer.from(
      JSON.stringify({
        images: [
          {
            id: "local-img",
            title: "Local",
            prompt: "x",
            createdAt: 1,
            updatedAt: 200,
            size: "auto",
            quality: "auto",
            background: "auto",
            outputFormat: "png",
            fileName: "local-img.png",
          },
        ],
      }),
    );
    const remoteIndex = Buffer.from(
      JSON.stringify({
        images: [
          {
            id: "remote-img",
            title: "Remote",
            prompt: "y",
            createdAt: 1,
            updatedAt: 100,
            size: "auto",
            quality: "auto",
            background: "auto",
            outputFormat: "png",
            fileName: "remote-img.png",
          },
        ],
      }),
    );
    const local = {
      "app-state/images.json": localIndex,
      "app-state/images/local-img.png": Buffer.from("local-bytes"),
    };
    const remote = {
      "app-state/images.json": remoteIndex,
      "app-state/images/remote-img.png": Buffer.from("remote-bytes"),
    };
    const review = buildSyncConflictReview(local, remote);
    for (const file of review.files.filter((f) => f.path.startsWith("app-state/images"))) {
      expect(file.supportsMerge).toBe(true);
    }
    const choices = buildDefaultMergeChoices(review, local, remote);
    const merged = buildMergedFileMap(local, remote, choices);
    const ids = (JSON.parse(merged["app-state/images.json"]!.toString("utf-8")).images as { id: string }[]).map(
      (img) => img.id,
    );
    expect(ids.sort()).toEqual(["local-img", "remote-img"]);
    expect(merged["app-state/images/local-img.png"]?.toString("utf-8")).toBe("local-bytes");
    expect(merged["app-state/images/remote-img.png"]?.toString("utf-8")).toBe("remote-bytes");
  });

  it("emits canonical JSON for notes merge (golden fixture)", () => {
    const merged = mergeFileBytes(
      "app-state/notes.json",
      Buffer.from(JSON.stringify({ notes: [{ id: "n1", title: "Local", updatedAt: 20 }] })),
      Buffer.from(
        JSON.stringify({
          notes: [
            { id: "n1", title: "Remote", updatedAt: 10 },
            { id: "n2", title: "Only remote", updatedAt: 5 },
          ],
        }),
      ),
    );
    expect(merged.toString("utf-8")).toBe(readFixture("notes-merge.expected.json"));
  });

  it("merges notes by id and prefers newer note body", () => {
    const local = {
      "app-state/notes.json": Buffer.from(
        JSON.stringify({
          notes: [
            { id: "n1", title: "Local", createdAt: 1, updatedAt: 20, wordCount: 1 },
            { id: "n-local", title: "Only local", createdAt: 1, updatedAt: 5, wordCount: 1 },
          ],
        }),
      ),
      "app-state/notes/n1.md": Buffer.from("local body"),
      "app-state/notes/n-local.md": Buffer.from("local only"),
    };
    const remote = {
      "app-state/notes.json": Buffer.from(
        JSON.stringify({
          notes: [
            { id: "n1", title: "Remote", createdAt: 1, updatedAt: 10, wordCount: 1 },
            { id: "n-remote", title: "Only remote", createdAt: 1, updatedAt: 6, wordCount: 1 },
          ],
        }),
      ),
      "app-state/notes/n1.md": Buffer.from("remote body"),
      "app-state/notes/n-remote.md": Buffer.from("remote only"),
    };
    const review = buildSyncConflictReview(local, remote);
    const merged = buildMergedFileMap(local, remote, buildDefaultMergeChoices(review, local, remote));
    const byId = Object.fromEntries(
      (JSON.parse(merged["app-state/notes.json"]!.toString("utf-8")).notes as { id: string; title: string }[]).map(
        (n) => [n.id, n.title],
      ),
    );
    expect(byId).toEqual({
      n1: "Local",
      "n-local": "Only local",
      "n-remote": "Only remote",
    });
    expect(merged["app-state/notes/n1.md"]?.toString("utf-8")).toBe("local body");
    expect(merged["app-state/notes/n-local.md"]?.toString("utf-8")).toBe("local only");
    expect(merged["app-state/notes/n-remote.md"]?.toString("utf-8")).toBe("remote only");
  });
});
