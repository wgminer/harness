import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetEventHubsForTests, subscribeToWire } from "./tauriEventHub";

describe("subscribeToWire", () => {
  beforeEach(() => {
    resetEventHubsForTests();
  });

  it("registers a single Tauri listener across subscribe/unsubscribe cycles", async () => {
    const handlers: Array<(e: { payload: string }) => void> = [];
    const listenFn = vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
      handlers.push(cb);
      return vi.fn();
    });

    const unsub1 = subscribeToWire("chat-stream-chunk", vi.fn(), listenFn as never);
    unsub1();
    const received: string[] = [];
    const unsub2 = subscribeToWire(
      "chat-stream-chunk",
      (chunk) => {
        received.push(chunk);
      },
      listenFn as never,
    );

    await Promise.resolve();
    expect(listenFn).toHaveBeenCalledTimes(1);

    for (const cb of handlers) {
      cb({ payload: "hi" });
    }
    expect(received).toEqual(["hi"]);

    unsub2();
  });

  it("does not double-deliver after Strict Mode remount (unsub then immediate resub)", async () => {
    const tauriHandlers: Array<(e: { payload: string }) => void> = [];
    const listenFn = vi.fn(async (_name: string, cb: (e: { payload: string }) => void) => {
      tauriHandlers.push(cb);
      return vi.fn();
    });

    // Mount #1
    const a: string[] = [];
    const unsubA = subscribeToWire("chat-stream-chunk", (c) => a.push(c), listenFn as never);
    // Strict Mode cleanup
    unsubA();
    // Mount #2
    const b: string[] = [];
    const unsubB = subscribeToWire("chat-stream-chunk", (c) => b.push(c), listenFn as never);

    await Promise.resolve();
    expect(listenFn).toHaveBeenCalledTimes(1);

    tauriHandlers[0]!({ payload: "chunk" });
    expect(a).toEqual([]);
    expect(b).toEqual(["chunk"]);

    // Leave chat and return: another unsub/resub must still be single-delivery
    unsubB();
    const c: string[] = [];
    subscribeToWire("chat-stream-chunk", (x) => c.push(x), listenFn as never);
    await Promise.resolve();
    expect(listenFn).toHaveBeenCalledTimes(1);

    tauriHandlers[0]!({ payload: "again" });
    expect(c).toEqual(["again"]);
  });
});
