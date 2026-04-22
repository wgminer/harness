import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import {
  addConversationToPlanIn,
  createPlanIn,
  deletePlanIn,
  listPlansIn,
  removeConversationFromPlanIn,
  updatePlanIn,
} from "./plans";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("plans-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("plans persistence", () => {
  it("supports create/list/update/delete round-trip", async () => {
    const dir = await makeDir();
    const plan = await createPlanIn(dir, "Launch", "Do thing");
    const listed = await listPlansIn(dir);
    expect(listed[0].id).toBe(plan.id);

    const updated = await updatePlanIn(dir, plan.id, { description: "Do another thing" });
    expect(updated?.description).toBe("Do another thing");

    await deletePlanIn(dir, plan.id);
    expect(await listPlansIn(dir)).toEqual([]);
  });

  it("adds/removes conversations idempotently", async () => {
    const dir = await makeDir();
    const plan = await createPlanIn(dir, "Plan", "Desc");
    await addConversationToPlanIn(dir, plan.id, "c1");
    await addConversationToPlanIn(dir, plan.id, "c1");
    const listed = await listPlansIn(dir);
    expect(listed[0].conversationIds).toEqual(["c1"]);

    const removed = await removeConversationFromPlanIn(dir, plan.id, "missing");
    expect(removed?.conversationIds).toEqual(["c1"]);
    const removed2 = await removeConversationFromPlanIn(dir, plan.id, "c1");
    expect(removed2?.conversationIds).toEqual([]);
  });
});
