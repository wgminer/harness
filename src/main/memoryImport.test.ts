import { describe, expect, it } from "vitest";
import {
  importLlmContextIn,
  parseImportSource,
  truncateExportForImport,
} from "./memoryImport";
import type { MemoryCompileLLM } from "./memoryCompile";
import { createTempDir } from "./__tests__/tempDir";
import { getUserMemoryIn } from "./memory";

function fakeImportLLM(facts: Array<{ key: string; value: string }>): MemoryCompileLLM {
  return {
    async distill() {
      return facts;
    },
  };
}

describe("parseImportSource", () => {
  it("reads the source from the final line", () => {
    const text = "1. Demographics\n* The user lives in Boston.\n\nImported from: Claude";
    expect(parseImportSource(text)).toBe("Claude");
  });

  it("returns null when the final line is missing", () => {
    expect(parseImportSource("Some facts only.")).toBeNull();
  });
});

describe("truncateExportForImport", () => {
  it("does not truncate short exports", () => {
    const { text, truncated } = truncateExportForImport("hello");
    expect(text).toBe("hello");
    expect(truncated).toBe(false);
  });
});

describe("importLlmContextIn", () => {
  it("merges distilled facts and records import source", async () => {
    const { path: dir, cleanup } = await createTempDir("memimport-test-");
    try {
    const llm = fakeImportLLM([
      { key: "preferred_name", value: "Alex" },
      { key: "profession", value: "Engineer" },
    ]);
    const exportText = [
      "1. Demographics Information",
      "* The user's preferred name is Alex.",
      "",
      "Imported from: ChatGPT",
    ].join("\n");

    const result = await importLlmContextIn(dir, llm, exportText);

    expect(result.added).toBe(3);
    expect(result.updated).toBe(0);
    expect(result.importSource).toBe("ChatGPT");

    const memory = await getUserMemoryIn(dir);
    expect(memory.preferred_name).toBe("Alex");
    expect(memory.profession).toBe("Engineer");
    expect(memory.context_import_source).toBe("ChatGPT");
    } finally {
      await cleanup();
    }
  });
});
