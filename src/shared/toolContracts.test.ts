import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

interface ToolDefinition {
  type: string;
  function: { name: string; description: string; parameters: unknown };
}

function readToolDefinitions(): ToolDefinition[] {
  const raw = readFileSync(join(root, "resources/contracts/tools.json"), "utf8");
  return JSON.parse(raw) as ToolDefinition[];
}

// Drift guard for the shared `resources/contracts/tools.json`: desktop (`src-tauri/src/openai.rs`)
// `include_str!`s this file verbatim, and iOS (`SharedToolDefinitions.swift`) loads it as a bundled
// resource and filters by name. This test only checks the file itself parses and both platforms'
// expected tool names are present — it does not (yet) verify the Rust/Swift consumers stay wired up.
describe("resources/contracts/tools.json", () => {
  it("parses as an array of OpenAI function tool definitions", () => {
    const defs = readToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.type).toBe("function");
      expect(typeof def.function.name).toBe("string");
      expect(def.function.name.length).toBeGreaterThan(0);
      expect(typeof def.function.description).toBe("string");
    }
  });

  it("has no duplicate tool names", () => {
    const names = readToolDefinitions().map((d) => d.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("contains the desktop-only tools (file, layout, notes)", () => {
    const names = new Set(readToolDefinitions().map((d) => d.function.name));
    for (const expected of [
      "list_directory",
      "read_file",
      "write_file",
      "delete_file",
      "create_directory",
      "set_layout",
      "note_list",
      "note_create",
      "note_read",
      "note_save",
      "note_delete",
    ]) {
      expect(names.has(expected), `missing desktop-only tool: ${expected}`).toBe(true);
    }
  });

  it("contains the tools iOS also loads (tasks, memory, web search, datetime)", () => {
    const names = new Set(readToolDefinitions().map((d) => d.function.name));
    for (const expected of [
      "task_list",
      "task_create",
      "task_update",
      "task_delete",
      "task_clear_completed",
      "memory_set_fact",
      "memory_list_facts",
      "memory_search_conversations",
      "web_search",
      "get_datetime",
    ]) {
      expect(names.has(expected), `missing shared (also-iOS) tool: ${expected}`).toBe(true);
    }
  });
});
