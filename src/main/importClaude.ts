import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getExistingClaudeIds, importConversations, type ImportConversationItem } from "./memory";

type MessageRole = "user" | "assistant" | "system";

interface ParsedConversation {
  id: string;
  title: string | null;
  createdAt: number;
  messages: Array<{ role: MessageRole; content: string }>;
}

/**
 * Maps Claude.ai's export sender labels to our internal roles.
 *
 * Claude exports use `sender: "human" | "assistant"`. Older variants and tool
 * calls also surface `"tool"` / `"system"` — we drop those to keep transcripts
 * focused on the conversation the user actually saw.
 */
function mapSender(sender: unknown): MessageRole | null {
  if (sender === "human" || sender === "user") return "user";
  if (sender === "assistant") return "assistant";
  return null;
}

/**
 * Anthropic switched message bodies from a flat `text` field to a `content`
 * array of blocks (`{ type: "text", text }`, `{ type: "tool_use", ... }`, etc.).
 * Real exports often include both for backwards compatibility, so we prefer
 * the structured array but fall back to `text`.
 */
function extractText(message: Record<string, unknown>): string {
  const content = message.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;
      if (b.type === "text" && typeof b.text === "string") {
        parts.push(b.text);
      }
    }
    if (parts.length > 0) return parts.join("\n").trim();
  }
  const text = message.text;
  if (typeof text === "string") return text.trim();
  return "";
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value === "string" && value) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function parseClaudeConversation(conv: unknown): ParsedConversation | null {
  if (conv == null || typeof conv !== "object") return null;
  const o = conv as Record<string, unknown>;
  const id = (o.uuid ?? o.id ?? o.conversation_uuid) as string | undefined;
  if (typeof id !== "string" || !id) return null;
  const rawTitle = o.name ?? o.title;
  const title = typeof rawTitle === "string" && rawTitle ? rawTitle : null;
  const createdAt = parseTimestamp(o.created_at) ?? Date.now();

  const rawMessages = o.chat_messages ?? o.messages;
  if (!Array.isArray(rawMessages)) return { id, title, createdAt, messages: [] };

  const messages: Array<{ role: MessageRole; content: string }> = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, unknown>;
    const role = mapSender(msg.sender ?? msg.role ?? (msg as { author?: { role?: unknown } }).author?.role);
    if (role == null) continue;
    const content = extractText(msg);
    if (!content) continue;
    messages.push({ role, content });
  }

  return { id, title, createdAt, messages };
}

export function parseClaudeFile(buffer: string): ParsedConversation[] {
  let data: unknown;
  try {
    data = JSON.parse(buffer);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: ParsedConversation[] = [];
  for (const item of data) {
    const parsed = parseClaudeConversation(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/**
 * The official Anthropic "Export data" archive places all conversations in a
 * single `conversations.json` array at the root. Older variants split into
 * per-conversation files; we accept both.
 */
const SINGLE_FILE_CANDIDATES = ["conversations.json", "data.json"];
const PER_FILE_PATTERN = /^conversation[s]?[-_]?.+\.json$/;

export async function importFromFolder(folderPath: string): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(folderPath);
  } catch (e) {
    errors.push(folderPath + ": " + (e instanceof Error ? e.message : String(e)));
    return { imported: 0, errors };
  }

  const lower = new Set(entries.map((e) => e.toLowerCase()));
  const byId = new Map<string, ParsedConversation>();

  const singleFile = SINGLE_FILE_CANDIDATES.find((name) => lower.has(name));
  if (singleFile) {
    const path = join(folderPath, singleFile);
    try {
      const raw = readFileSync(path, "utf-8");
      for (const c of parseClaudeFile(raw)) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    } catch (e) {
      errors.push(`${singleFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (byId.size === 0) {
    const perFiles = entries.filter((f) => PER_FILE_PATTERN.test(f) && !SINGLE_FILE_CANDIDATES.includes(f.toLowerCase()));
    for (const file of perFiles) {
      const path = join(folderPath, file);
      let raw: string;
      try {
        raw = readFileSync(path, "utf-8");
      } catch (e) {
        errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const list = parseClaudeFile(raw);
      if (list.length === 0) {
        // The file might be a single conversation object, not an array.
        try {
          const single = parseClaudeConversation(JSON.parse(raw));
          if (single && !byId.has(single.id)) byId.set(single.id, single);
        } catch {
          // ignore — already collected as parse error if relevant
        }
        continue;
      }
      for (const c of list) {
        if (!byId.has(c.id)) byId.set(c.id, c);
      }
    }
  }

  if (byId.size === 0 && errors.length === 0) {
    errors.push(`No Claude conversations found in ${folderPath}. Expected conversations.json from the Claude.ai "Export data" archive.`);
    return { imported: 0, errors };
  }

  const existingIds = new Set(await getExistingClaudeIds());
  const items: ImportConversationItem[] = [];
  // Sort by createdAt ascending so the sidebar surfaces in chronological order
  // after import (newest-first sort applies on top, but stable input helps).
  const sorted = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  for (const c of sorted) {
    if (existingIds.has(c.id)) continue;
    items.push({
      title: c.title,
      createdAt: c.createdAt,
      messages: c.messages,
      claudeId: c.id,
    });
  }

  const { imported } = await importConversations(items);
  return { imported, errors };
}
