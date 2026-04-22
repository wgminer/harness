import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { Plan } from "../shared/types";
import { getMemoryDir, PLANS_FILE } from "./memory";
import { generateId, fileExists } from "./utils";

function getPlansPath(): string {
  return join(getMemoryDir(), PLANS_FILE);
}

function getPlansPathIn(memoryDir: string): string {
  return join(memoryDir, PLANS_FILE);
}

export async function loadPlansIn(memoryDir: string): Promise<Record<string, Plan>> {
  const path = getPlansPathIn(memoryDir);
  if (!(await fileExists(path))) return {};
  const data = JSON.parse(await readFile(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

async function loadPlans(): Promise<Record<string, Plan>> {
  return loadPlansIn(getMemoryDir());
}

export async function savePlansIn(memoryDir: string, plans: Record<string, Plan>): Promise<void> {
  await writeFile(getPlansPathIn(memoryDir), JSON.stringify(plans, null, 2), "utf-8");
}

async function savePlans(plans: Record<string, Plan>): Promise<void> {
  await savePlansIn(getMemoryDir(), plans);
}

export async function listPlansIn(memoryDir: string): Promise<Plan[]> {
  const plans = await loadPlansIn(memoryDir);
  return Object.values(plans).sort((a, b) => b.createdAt - a.createdAt);
}

async function listPlans(): Promise<Plan[]> {
  return listPlansIn(getMemoryDir());
}

export async function createPlanIn(memoryDir: string, title: string, description: string): Promise<Plan> {
  const id = generateId("plan");
  const plan: Plan = {
    id,
    title,
    description,
    conversationIds: [],
    createdAt: Date.now(),
  };
  const plans = await loadPlansIn(memoryDir);
  plans[id] = plan;
  await savePlansIn(memoryDir, plans);
  return plan;
}

async function createPlan(title: string, description: string): Promise<Plan> {
  return createPlanIn(getMemoryDir(), title, description);
}

export async function updatePlanIn(
  memoryDir: string,
  planId: string,
  updates: { title?: string; description?: string }
): Promise<Plan | null> {
  const plans = await loadPlansIn(memoryDir);
  const plan = plans[planId];
  if (!plan) return null;
  if (updates.title !== undefined) plan.title = updates.title;
  if (updates.description !== undefined) plan.description = updates.description;
  await savePlansIn(memoryDir, plans);
  return plan;
}

async function updatePlan(planId: string, updates: { title?: string; description?: string }): Promise<Plan | null> {
  return updatePlanIn(getMemoryDir(), planId, updates);
}

export async function deletePlanIn(memoryDir: string, planId: string): Promise<void> {
  const plans = await loadPlansIn(memoryDir);
  if (planId in plans) {
    delete plans[planId];
    await savePlansIn(memoryDir, plans);
  }
}

async function deletePlan(planId: string): Promise<void> {
  return deletePlanIn(getMemoryDir(), planId);
}

export async function addConversationToPlanIn(
  memoryDir: string,
  planId: string,
  conversationId: string
): Promise<Plan | null> {
  const plans = await loadPlansIn(memoryDir);
  const plan = plans[planId];
  if (!plan) return null;
  if (!plan.conversationIds.includes(conversationId)) {
    plan.conversationIds.push(conversationId);
    await savePlansIn(memoryDir, plans);
  }
  return plan;
}

async function addConversationToPlan(planId: string, conversationId: string): Promise<Plan | null> {
  return addConversationToPlanIn(getMemoryDir(), planId, conversationId);
}

export async function removeConversationFromPlanIn(
  memoryDir: string,
  planId: string,
  conversationId: string
): Promise<Plan | null> {
  const plans = await loadPlansIn(memoryDir);
  const plan = plans[planId];
  if (!plan) return null;
  plan.conversationIds = plan.conversationIds.filter((id) => id !== conversationId);
  await savePlansIn(memoryDir, plans);
  return plan;
}

async function removeConversationFromPlan(planId: string, conversationId: string): Promise<Plan | null> {
  return removeConversationFromPlanIn(getMemoryDir(), planId, conversationId);
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
