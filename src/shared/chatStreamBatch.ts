/**
 * Coarse chat stream flushes — thresholds from resources/contracts/chatStreamBatch.json.
 * Token deltas accumulate; UI updates on size, time, or paragraph boundaries.
 */

import contract from "../../resources/contracts/chatStreamBatch.json";

export interface ChatStreamBatchPolicy {
  minChars: number;
  maxHoldMs: number;
  newlineMinChars: number;
}

export const CHAT_STREAM_BATCH: ChatStreamBatchPolicy = {
  minChars: contract.minChars,
  maxHoldMs: contract.maxHoldMs,
  newlineMinChars: contract.newlineMinChars,
};

export type StreamBatchClock = () => number;

/** Pure batcher for assistant/note text UI flushes. */
export class StreamTextBatcher {
  private buffer = "";
  private bufferStartedAt: number | null = null;
  private readonly now: StreamBatchClock;

  constructor(
    private readonly policy: ChatStreamBatchPolicy = CHAT_STREAM_BATCH,
    now: StreamBatchClock = () => Date.now()
  ) {
    this.now = now;
  }

  push(chunk: string): string | null {
    if (!chunk) return null;
    if (this.buffer.length === 0) this.bufferStartedAt = this.now();
    this.buffer += chunk;
    return this.maybeFlush(false);
  }

  /** Force remaining buffer out (stream end, tool boundary). */
  flush(): string | null {
    return this.maybeFlush(true);
  }

  get pending(): string {
    return this.buffer;
  }

  private maybeFlush(force: boolean): string | null {
    if (!this.buffer) return null;
    if (force) return this.takeAll();

    const charLen = [...this.buffer].length;
    const heldLong =
      this.bufferStartedAt != null && this.now() - this.bufferStartedAt >= this.policy.maxHoldMs;

    const lastNl = this.buffer.lastIndexOf("\n");
    if (lastNl >= 0) {
      const prefix = this.buffer.slice(0, lastNl + 1);
      const prefixChars = [...prefix].length;
      if (prefixChars >= this.policy.newlineMinChars) {
        this.buffer = this.buffer.slice(lastNl + 1);
        this.bufferStartedAt = this.buffer ? this.now() : null;
        return prefix;
      }
    }

    if (charLen >= this.policy.minChars || heldLong) {
      return this.takeAll();
    }
    return null;
  }

  private takeAll(): string {
    const out = this.buffer;
    this.buffer = "";
    this.bufferStartedAt = null;
    return out;
  }
}
