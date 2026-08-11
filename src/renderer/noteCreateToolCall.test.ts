import { describe, expect, it } from "vitest";
import {
  noteIdFromCreateToolCall,
  toolCallLabel,
  type ToolCallDisplay,
} from "./chatHelpers";

describe("note create tool call helpers", () => {
  it("extracts note id from note_create payload", () => {
    const call: ToolCallDisplay = {
      toolName: "note_create",
      payload: { note: { id: "n1", title: "Weekly plan" } },
    };
    expect(noteIdFromCreateToolCall(call)).toBe("n1");
  });

  it("labels note_create with the note title", () => {
    const call: ToolCallDisplay = {
      toolName: "note_create",
      payload: { note: { id: "n1", title: "Weekly plan" } },
    };
    expect(toolCallLabel(call)).toBe("Created “Weekly plan”");
  });

  it("falls back when title is missing", () => {
    const call: ToolCallDisplay = {
      toolName: "note_create",
      payload: { note: { id: "n1" } },
    };
    expect(toolCallLabel(call)).toBe("Created note");
    expect(noteIdFromCreateToolCall(call)).toBe("n1");
  });

  it("returns null id when create failed", () => {
    const call: ToolCallDisplay = {
      toolName: "note_create",
      payload: { error: "boom" },
    };
    expect(noteIdFromCreateToolCall(call)).toBeNull();
  });
});
