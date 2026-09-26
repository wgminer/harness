import { describe, expect, it } from "vitest";
import { scheduleAfterStreamEndSync } from "./streamEndScheduling";

describe("streamEndScheduling", () => {
  it("runs deferred work after synchronous work in the same tick", async () => {
    const order: string[] = [];
    order.push("sync");
    scheduleAfterStreamEndSync(() => order.push("deferred"));
    order.push("sync2");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["sync", "sync2", "deferred"]);
  });

  it("allows other microtasks (e.g. IPC stop) to run before stream-end completion", async () => {
    const order: string[] = [];
    order.push("sync-complete");
    scheduleAfterStreamEndSync(() => order.push("complete-turn"));
    queueMicrotask(() => order.push("ipc-stop"));
    order.push("sync-after-schedule");
    await Promise.resolve();
    expect(order).toEqual(["sync-complete", "sync-after-schedule", "ipc-stop"]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["sync-complete", "sync-after-schedule", "ipc-stop", "complete-turn"]);
  });
});
