import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OPENAI_CHAT_MODEL,
  OPENAI_TITLE_MODEL,
  OPENAI_TRANSCRIPT_CLEANUP_MODEL,
} from "./openaiModels";
import systemPrompt from "../../resources/contracts/systemPrompt.json";
import tools from "../../resources/contracts/tools.json";

// iOS cannot import TS or Rust, so these values are hand-copied into Swift.
// Read the real sources and fail on drift.

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf-8");

const openAIClient = read("ios/HarnessMobile/Chat/OpenAIClient.swift");
const rustOpenAI = read("src-tauri/src/openai.rs");

function swiftString(source: string, name: string): string {
  const match = source.match(new RegExp(`static let ${name} = "([^"]*)"`));
  if (!match) throw new Error(`Swift constant not found: ${name}`);
  return match[1]!;
}

function swiftStringSet(source: string, name: string): string[] {
  const match = source.match(new RegExp(`static let ${name}: Set<String> = \\[([^\\]]*)\\]`));
  if (!match) throw new Error(`Swift set not found: ${name}`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

describe("iOS parity with desktop", () => {
  it("uses the same OpenAI models", () => {
    expect(swiftString(openAIClient, "chat")).toBe(OPENAI_CHAT_MODEL);
    expect(swiftString(openAIClient, "title")).toBe(OPENAI_TITLE_MODEL);
    expect(swiftString(openAIClient, "transcriptCleanup")).toBe(OPENAI_TRANSCRIPT_CLEANUP_MODEL);
  });

  it("uses the same chat reasoning effort and tool round cap", () => {
    const effort = rustOpenAI.match(/pub const CHAT_REASONING_EFFORT: &str = "([^"]*)"/)?.[1];
    expect(effort).toBeTruthy();
    expect(swiftString(openAIClient, "chatReasoningEffort")).toBe(effort);

    const rounds = rustOpenAI.match(/pub const MAX_TOOL_CALL_ITERATIONS: usize = (\d+)/)?.[1];
    expect(rounds).toBeTruthy();
    expect(openAIClient.match(/static let maxToolCallIterations = (\d+)/)?.[1]).toBe(rounds);
  });

  it("only offers tools that exist in tools.json and are named in the iOS prompt", () => {
    const iosTools = [
      ...swiftStringSet(read("ios/HarnessMobile/Chat/TaskToolExecutor.swift"), "toolNames"),
      ...swiftStringSet(read("ios/HarnessMobile/Chat/ChatToolDefinitions.swift"), "baseToolNames"),
    ];
    expect(iosTools.length).toBeGreaterThan(0);
    const contractNames = new Set(tools.map((t) => t.function.name));
    for (const name of iosTools) {
      expect(contractNames.has(name), `iOS tool missing from tools.json: ${name}`).toBe(true);
      expect(systemPrompt.ios, `iOS prompt does not mention ${name}`).toContain(name);
    }
    // web_search is added to the iOS prompt at runtime when a Tavily key is present.
    const offered = new Set([...iosTools, "web_search"]);
    for (const name of contractNames) {
      if (offered.has(name)) continue;
      expect(systemPrompt.ios, `iOS prompt names a tool iOS cannot run: ${name}`).not.toContain(name);
    }
  });
});
