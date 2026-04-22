import { describe, expect, it } from "vitest";
import { mergeCustomTaskTags, normalizeTags, taskIsClearable, toggleCompletedTag } from "./taskTags";

describe("taskTags helpers", () => {
  it("normalizes and deduplicates tags", () => {
    expect(normalizeTags(["  In Progress  ", "in progress", "DONE", "", null])).toEqual([
      "in_progress",
      "done",
    ]);
  });

  it("merges custom tags while preserving status tags", () => {
    expect(mergeCustomTaskTags(["pending", "work"], ["My Tag", "work"])).toEqual(["pending", "my_tag", "work"]);
  });

  it("detects clearable tags and toggles completed", () => {
    expect(taskIsClearable(["cancelled"])).toBe(true);
    expect(taskIsClearable(["in_progress"])).toBe(false);
    expect(toggleCompletedTag(["pending"])).toEqual(["pending", "completed"]);
    expect(toggleCompletedTag(["pending", "completed"])).toEqual(["pending"]);
  });
});
