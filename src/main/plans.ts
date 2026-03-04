import { ipcMain } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { Plan } from "../shared/types";

const MEMORY_DIR = "memory";
const PLANS_FILE = "plans.json";

function getPlansPath(): string {
  const dir = join(app.getPath("userData"), MEMORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, PLANS_FILE);
}

function loadPlans(): Record<string, Plan> {
  const path = getPlansPath();
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

function savePlans(plans: Record<string, Plan>): void {
  writeFileSync(getPlansPath(), JSON.stringify(plans, null, 2), "utf-8");
}

function listPlans(): Plan[] {
  const plans = loadPlans();
  return Object.values(plans).sort((a, b) => b.createdAt - a.createdAt);
}

function createPlan(title: string, description: string): Plan {
  const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const plan: Plan = {
    id,
    title,
    description,
    conversationIds: [],
    createdAt: Date.now(),
  };
  const plans = loadPlans();
  plans[id] = plan;
  savePlans(plans);
  return plan;
}

function updatePlan(planId: string, updates: { title?: string; description?: string }): Plan | null {
  const plans = loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  if (updates.title !== undefined) plan.title = updates.title;
  if (updates.description !== undefined) plan.description = updates.description;
  savePlans(plans);
  return plan;
}

function deletePlan(planId: string): void {
  const plans = loadPlans();
  if (planId in plans) {
    delete plans[planId];
    savePlans(plans);
  }
}

function addConversationToPlan(planId: string, conversationId: string): Plan | null {
  const plans = loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  if (!plan.conversationIds.includes(conversationId)) {
    plan.conversationIds.push(conversationId);
    savePlans(plans);
  }
  return plan;
}

function removeConversationFromPlan(planId: string, conversationId: string): Plan | null {
  const plans = loadPlans();
  const plan = plans[planId];
  if (!plan) return null;
  plan.conversationIds = plan.conversationIds.filter((id) => id !== conversationId);
  savePlans(plans);
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
