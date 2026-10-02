import type { ChatMessage } from "../../shared/types";
import type { UiSession } from "../../shared/uiSession";
import { BROWSER_STORAGE_KEY } from "../browser/browserStore";
import demoData from "./demoData.json";

/** Recordings pin the page clock here so the time, date, and home quote never drift. */
export const DEMO_NOW = new Date("2026-09-14T09:41:00").getTime();

type DemoData = {
  conversations: Array<{
    id: string;
    title: string;
    ageMinutes: number;
    chatMode?: string;
    messages: ChatMessage[];
  }>;
  notes: Array<{ id: string; title: string; ageMinutes: number; content: string }>;
  tasks: Array<{ id: string; title: string; status: string; tags: string[]; ageMinutes: number }>;
};

const data = demoData as DemoData;

/** Write the demo library into the browser store before the app reads it. */
export function seedDemoStore(session: Partial<UiSession>): void {
  const now = Date.now();
  const at = (ageMinutes: number) => now - ageMinutes * 60_000;
  const compose = (session.view ?? "chat") === "chat" && session.conversationId == null;
  const state = {
    settings: { chat: { openToComposeOnLaunch: compose } },
    // Any key routes chat through the demo's scripted `/openai` responses.
    secrets: { openaiApiKey: "sk-demo" },
    uiSession: { view: "chat", conversationId: null, setupNoticeDismissed: true, ...session },
    layout: { sidebar: "left" },
    conversations: data.conversations.map(({ ageMinutes, ...c }) => ({
      ...c,
      createdAt: at(ageMinutes),
      sessionKind: "chat",
      hasMessages: c.messages.length > 0,
      hasAssistantReply: c.messages.some((m) => m.role === "assistant"),
    })),
    userMemory: {},
    notes: data.notes.map(({ ageMinutes, ...n }) => ({
      ...n,
      createdAt: at(ageMinutes),
      updatedAt: at(ageMinutes),
      wordCount: n.content.trim().split(/\s+/).length,
    })),
    tasks: data.tasks.map(({ ageMinutes, ...t }) => ({
      ...t,
      createdAt: at(ageMinutes),
      updatedAt: at(ageMinutes),
    })),
  };
  localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));
}
