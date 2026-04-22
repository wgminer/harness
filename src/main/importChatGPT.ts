import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getExistingChatgptIds, importConversations, type ImportConversationItem } from "./memory";

type MessageRole = "user" | "assistant" | "system";

interface ParsedConversation {
  id: string;
  title: string | null;
  createdAt: number;
  messages: Array<{ role: MessageRole; content: string }>;
}

function isValidRole(r: unknown): r is MessageRole {
  return r === "user" || r === "assistant" || r === "system";
}

function parseChatGPTConversation(conv: unknown): ParsedConversation | null {
  if (conv == null || typeof conv !== "object") return null;
  const o = conv as Record<string, unknown>;
  const id = (o.id ?? o.conversation_id) as string | undefined;
  if (typeof id !== "string" || !id) return null;
  const rawTitle = o.title;
  const title = typeof rawTitle === "string" && rawTitle ? rawTitle : null;
  const createTime = o.create_time;
  const createdAt =
    typeof createTime === "number" && Number.isFinite(createTime)
      ? Math.round(createTime * 1000)
      : Date.now();
  const mapping = o.mapping;
  if (mapping == null || typeof mapping !== "object") return { id, title, createdAt, messages: [] };

  const map = mapping as Record<string, { parent?: string | null; children?: string[]; message?: unknown }>;
  let rootId: string | null = null;
  for (const [nodeId, node] of Object.entries(map)) {
    if (node && (node.parent === null || node.parent === undefined)) {
      rootId = nodeId;
      break;
    }
  }
  if (rootId == null) return { id, title, createdAt, messages: [] };

  // When present, current_node is the leaf of the path the user actually saw (avoids branches/regenerations)
  const currentLeafId = typeof o.current_node === "string" && o.current_node && map[o.current_node] ? o.current_node : null;

  /** Build root -> leaf path when we have a known leaf (current_node), else null. */
  function buildLinearPath(): string[] | null {
    if (currentLeafId == null) return null;
    const path: string[] = [];
    let id: string | null = currentLeafId;
    while (id != null) {
      path.unshift(id);
      const node = map[id];
      id = node?.parent != null ? String(node.parent) : null;
    }
    // Path should start at root
    return path[0] === rootId ? path : null;
  }

  const linearPath = buildLinearPath();

  function extractMessage(nodeId: string): { role: MessageRole; content: string } | null {
    const node = map[nodeId];
    if (!node?.message || typeof node.message !== "object") return null;
    const msg = node.message as {
      role?: unknown;
      author?: { role?: unknown };
      content?: { content_type?: string; parts?: unknown };
      metadata?: { is_visually_hidden_from_conversation?: boolean };
    };
    if (msg.metadata?.is_visually_hidden_from_conversation === true) return null;
    const role = msg.author?.role ?? msg.role;
    const r = isValidRole(role) ? role : "user";
    const parts = msg.content?.parts;
    const content = Array.isArray(parts)
      ? parts.map((p) => (typeof p === "string" ? p : String(p))).join("\n")
      : "";
    if (content.trim().length === 0) return null;
    return { role: r, content: content.trim() };
  }

  const messages: Array<{ role: MessageRole; content: string }> = [];

  if (linearPath != null) {
    // Single branch: emit messages in path order (root -> current_node)
    for (const nodeId of linearPath) {
      const m = extractMessage(nodeId);
      if (m) messages.push(m);
    }
  } else {
    // No current_node: DFS from root, skip empty messages (may include multiple branches)
    const visited = new Set<string>();
    function walk(nodeId: string): void {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const m = extractMessage(nodeId);
      if (m) messages.push(m);
      const node = map[nodeId];
      const children = node?.children;
      if (Array.isArray(children)) {
        for (const childId of children) {
          if (typeof childId === "string") walk(childId);
        }
      }
    }
    walk(rootId);
  }

  return { id, title, createdAt, messages };
}

function parseChatGPTFile(buffer: string): ParsedConversation[] {
  let data: unknown;
  try {
    data = JSON.parse(buffer);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: ParsedConversation[] = [];
  for (const item of data) {
    const parsed = parseChatGPTConversation(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Matches ChatGPT export conversation files (e.g. conversations-000.json). Raw unzipped folder has these plus shared_conversations.json, user.json, etc. */
const CONVERSATIONS_FILE_PATTERN = /^conversations-.+\.json$/;

interface SharedConversationEntry {
  conversation_id?: string;
  title?: string | null;
}

/** Load shared_conversations.json from the folder if present (raw unzipped ChatGPT export). Returns map of conversation_id -> { title, orderIndex }. */
function loadSharedConversations(folderPath: string): Map<string, { title: string | null; orderIndex: number }> {
  const path = join(folderPath, "shared_conversations.json");
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return new Map();
    const map = new Map<string, { title: string | null; orderIndex: number }>();
    data.forEach((entry: SharedConversationEntry, index: number) => {
      const id = entry.conversation_id;
      if (typeof id === "string" && id) {
        const title = typeof entry.title === "string" ? entry.title : null;
        map.set(id, { title, orderIndex: index });
      }
    });
    return map;
  } catch {
    return new Map();
  }
}

export async function importFromFolder(folderPath: string): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(folderPath);
  } catch (e) {
    errors.push(folderPath + ": " + (e instanceof Error ? e.message : String(e)));
    return { imported: 0, errors };
  }

  const conversationFiles = entries.filter((f) => CONVERSATIONS_FILE_PATTERN.test(f));
  const sharedMap = loadSharedConversations(folderPath);

  const byId = new Map<string, ParsedConversation>();
  for (const file of conversationFiles) {
    const path = join(folderPath, file);
    let raw: string;
    try {
      raw = readFileSync(path, "utf-8");
    } catch (e) {
      errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const list = parseChatGPTFile(raw);
    for (const c of list) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
  }

  const existingIds = new Set(await getExistingChatgptIds());
  const withOrder: { item: ImportConversationItem; orderIndex: number }[] = [];
  for (const c of byId.values()) {
    if (existingIds.has(c.id)) continue;
    const shared = sharedMap.get(c.id);
    const rawTitle = shared?.title ?? c.title;
    const title = typeof rawTitle === "string" && rawTitle ? rawTitle : null;
    const orderIndex = shared?.orderIndex ?? Number.MAX_SAFE_INTEGER;
    withOrder.push({
      item: {
        title,
        createdAt: c.createdAt,
        messages: c.messages,
        chatgptId: c.id,
      },
      orderIndex,
    });
  }
  withOrder.sort((a, b) => a.orderIndex - b.orderIndex);
  const toImport = withOrder.map((x) => x.item);

  const { imported } = await importConversations(toImport);
  return { imported, errors };
}
