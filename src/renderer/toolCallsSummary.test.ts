import { describe, expect, it } from "vitest";
import { summarizeToolCalls, type ToolCallDisplay } from "./chatHelpers";

function calls(...names: string[]): ToolCallDisplay[] {
  return names.map((toolName) => ({ toolName }));
}

describe("summarizeToolCalls", () => {
  it("returns empty for no calls", () => {
    expect(summarizeToolCalls([])).toBe("");
  });

  it("labels a single call", () => {
    expect(summarizeToolCalls(calls("note_read"))).toBe("Read note");
  });

  it("groups duplicates with counts", () => {
    expect(summarizeToolCalls(calls("note_read", "note_read", "task_list"))).toBe(
      "Read note (2), Reviewed tasks"
    );
  });

  it("falls back to action count when many distinct tools", () => {
    const many = calls(
      "note_list",
      "note_read",
      "note_create",
      "task_list",
      "task_create",
      "memory_list_facts"
    );
    expect(summarizeToolCalls(many)).toBe("6 actions");
  });
});
