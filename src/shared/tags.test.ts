import { describe, expect, it } from "vitest";
import { addTags, applyTagPatch, normalizeTags, removeTags } from "./tags";

describe("tags helpers", () => {
  it("normalizes and deduplicates tags", () => {
    expect(normalizeTags(["  In Progress  ", "in progress", "DONE", "", null])).toEqual([
      "in_progress",
      "done",
    ]);
  });

  it("adds and removes tags", () => {
    expect(addTags(["work"], ["My Tag", "work"])).toEqual(["work", "my_tag"]);
    expect(removeTags(["work", "urgent"], ["urgent", "missing"])).toEqual(["work"]);
  });

  it("applies replace, add, and remove patches", () => {
    expect(applyTagPatch(["a"], { tags: ["b"] })).toEqual(["b"]);
    expect(applyTagPatch(["a"], { add_tags: ["c"] })).toEqual(["a", "c"]);
    expect(applyTagPatch(["a", "b"], { remove_tags: ["a"] })).toEqual(["b"]);
    expect(applyTagPatch(["a"], {})).toBeUndefined();
  });
});
