import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { Plan } from "../shared/types";
import { getMemoryDir, PLANS_FILE } from "./memory";
import { generateId, fileExists } from "./utils";

function getPlansPath(): string {
  return join(getMemoryDir(), PLANS_FILE);
}

async function loadPlans(): Promise<Record<string, Plan>> {
  const path = getPlansPath();
  if (!(await fileExists(path))) return {};
  const data = JSON.parse(await readFile(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

async function savePlans(plans: Record<string, Plan>): Promise<void> {
  await writeFile(getPlansPath(), JSON.stringify(plans, null, 2), "utf-8");
}

async function listPlans(): Promise<Plan[]> {
  const plans = await loadPlans();
  return Object.values(plans).sort((a, b) => b.createdAt - a.createdAt);
}

async function createPlan(title: string, description: string): Promise<Plan> {
  const id = generateId("plan");
  const plan: Plan = {
    id,
    title,
    description,
    conversationIds: [],
    createdAt: Date.now(),
  };
  const plans = await loadPlans();
  plans[id] = plan;
  await savePlans(plans);
  return plan;
}

async function updatePlan(planId: string, updates: { title?: string; description?: string }): Promise<Plan | null> {
  const plans = await loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  if (updates.title !== undefined) plan.title = updates.title;
  if (updates.description !== undefined) plan.description = updates.description;
  await savePlans(plans);
  return plan;
}

async function deletePlan(planId: string): Promise<void> {
  const plans = await loadPlans();
  if (planId in plans) {
    delete plans[planId];
    await savePlans(plans);
  }
}

async function addConversationToPlan(planId: string, conversationId: string): Promise<Plan | null> {
  const plans = await loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  if (!plan.conversationIds.includes(conversationId)) {
    plan.conversationIds.push(conversationId);
    await savePlans(plans);
  }
  return plan;
}

async function removeConversationFromPlan(planId: string, conversationId: string): Promise<Plan | null> {
  const plans = await loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  plan.conversationIds = plan.conversationIds.filter((id) => id !== conversationId);
  await savePlans(plans);
  return plan;
}

export function registerPlansHandlers(): void {
  ipcMain.handle("plans:list", () => listPlans());
  ipcMain.handle("plans:create", (_e, title: string, description: string) => createPlan(title, description));
  ipcMain.handle("plans:update", (_e, planId: string, updates: { title?: string; description?: string }) =>
    updatePlan(planId, updates)
  );
  ipcMain.handle("plans:delete", (_e, planId: string) => deletePlan(planId));
  ipcMain.handle("plans:addConversation", (_e, planId: string, conversationId: string) =>
    addConversationToPlan(planId, conversationId)
  );
  ipcMain.handle("plans:removeConversation", (_e, planId: string, conversationId: string) =>
    removeConversationFromPlan(planId, conversationId)
  );
}
