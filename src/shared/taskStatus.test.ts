import { describe, expect, it } from "vitest";
import {
  migrateTaskFields,
  resolveTaskStatus,
  taskIsActive,
  taskIsClearable,
  taskIsInCompletedSection,
  taskNeedsStatusMigration,
  toggleTaskCompleted,
} from "./taskStatus";

describe("taskStatus helpers", () => {
  it("migrates workflow labels out of tags into status", () => {
    expect(migrateTaskFields({ tags: ["completed", "work"] })).toEqual({
      status: "completed",
      tags: ["work"],
    });
    expect(migrateTaskFields({ status: "in_progress", tags: ["pending", "urgent"] })).toEqual({
      status: "pending",
      tags: ["urgent"],
    });
    expect(migrateTaskFields({ status: "pending", tags: ["completed"] })).toEqual({
      status: "completed",
      tags: [],
    });
  });

  it("resolves status for legacy rows at read time", () => {
    expect(resolveTaskStatus({ tags: ["completed", "work"] })).toBe("completed");
    expect(resolveTaskStatus({ status: "in_progress", tags: [] })).toBe("in_progress");
  });

  it("splits active vs completed section membership", () => {
    expect(taskIsActive("pending")).toBe(true);
    expect(taskIsActive("in_progress")).toBe(true);
    expect(taskIsActive("completed")).toBe(false);
    expect(taskIsInCompletedSection("completed")).toBe(true);
    expect(taskIsInCompletedSection("cancelled")).toBe(true);
    expect(taskIsInCompletedSection("pending")).toBe(false);
  });

  it("detects records that need migration", () => {
    expect(taskNeedsStatusMigration({ tags: ["completed"] })).toBe(true);
    expect(taskNeedsStatusMigration({ status: "pending", tags: ["work"] })).toBe(false);
  });

  it("toggles completed and detects clearable status", () => {
    expect(toggleTaskCompleted("pending")).toBe("completed");
    expect(toggleTaskCompleted("completed")).toBe("pending");
    expect(taskIsClearable("cancelled")).toBe(true);
    expect(taskIsClearable("in_progress")).toBe(false);
  });
});
