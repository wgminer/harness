import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_STREAM_BATCH,
  StreamTextBatcher,
  type ChatStreamBatchPolicy,
} from "./chatStreamBatch";

const root = join(__dirname, "../..");

function readContract(): ChatStreamBatchPolicy {
  const raw = readFileSync(join(root, "resources/contracts/chatStreamBatch.json"), "utf8");
  return JSON.parse(raw) as ChatStreamBatchPolicy;
}

describe("resources/contracts/chatStreamBatch.json", () => {
  it("exports positive thresholds", () => {
    const c = readContract();
    expect(c.minChars).toBeGreaterThan(0);
    expect(c.maxHoldMs).toBeGreaterThan(0);
    expect(c.newlineMinChars).toBeGreaterThan(0);
    expect(c.newlineMinChars).toBeLessThan(c.minChars);
  });

  it("matches TS imports from the same file", () => {
    const c = readContract();
    expect(CHAT_STREAM_BATCH).toEqual(c);
  });

  it("is include_str!'d by Rust (stream_batch.rs)", () => {
    const rust = readFileSync(join(root, "src-tauri/src/chat/stream_batch.rs"), "utf8");
    expect(rust).toContain('include_str!("../../../resources/contracts/chatStreamBatch.json")');
  });
});

describe("StreamTextBatcher", () => {
  const policy: ChatStreamBatchPolicy = {
    minChars: 150,
    maxHoldMs: 350,
    newlineMinChars: 40,
  };

  it("holds small deltas until minChars", () => {
    const b = new StreamTextBatcher(policy, () => 0);
    expect(b.push("hello ")).toBeNull();
    expect(b.push("world")).toBeNull();
    expect(b.pending).toBe("hello world");
  });

  it("flushes when minChars is reached", () => {
    const b = new StreamTextBatcher(policy, () => 0);
    const chunk = "a".repeat(150);
    expect(b.push(chunk)).toBe(chunk);
    expect(b.pending).toBe("");
  });

  it("flushes through last newline once newlineMinChars is met", () => {
    const b = new StreamTextBatcher(policy, () => 0);
    const para = `${"x".repeat(38)}\n`;
    expect(b.push(para)).toBeNull();
    expect(b.push("y\ntrailing")).toBe(`${para}y\n`);
    expect(b.pending).toBe("trailing");
  });

  it("flushes on maxHold even under minChars", () => {
    let now = 0;
    const b = new StreamTextBatcher(policy, () => now);
    expect(b.push("short")).toBeNull();
    now = 350;
    expect(b.push("!")).toBe("short!");
  });

  it("force flush returns remainder", () => {
    const b = new StreamTextBatcher(policy, () => 0);
    b.push("partial");
    expect(b.flush()).toBe("partial");
    expect(b.flush()).toBeNull();
  });
});
