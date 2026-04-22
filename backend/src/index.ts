import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { buildApiKeyGuard } from "./auth.js";
import { getConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { conversations, memoryFacts, messages, planConversations, plans, tasks } from "./db/schema.js";

const roleSchema = z.enum(["user", "assistant", "system"]);
const tagsSchema = z.array(z.string().trim().min(1)).default(["pending"]);

function parseJsonField<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function buildServer() {
  const config = getConfig();
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  const { db, sqlite } = createDb(config.dbPath);
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "db", "migrations");
  runMigrations(sqlite, migrationsDir);

  fastify.get("/health", async () => ({ ok: true }));

  fastify.register(async (api) => {
    api.addHook("preHandler", buildApiKeyGuard(config.apiSecretKey));

    api.get("/conversations", async () => {
      const rows = await db.select().from(conversations).orderBy(desc(conversations.createdAt));
      return {
        conversations: rows.map((row) => ({
          id: row.id,
          title: row.title,
          createdAt: row.createdAt,
          source: row.source,
          chatgptId: row.chatgptId,
        })),
      };
    });

    api.post("/conversations", async (request, reply) => {
      const bodySchema = z.object({
        title: z.string().trim().min(1).nullable().optional(),
        source: z.string().trim().min(1).optional(),
        chatgptId: z.string().trim().min(1).optional(),
      });
      const parsed = bodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const now = Date.now();
      const id = randomUUID();
      await db.insert(conversations).values({
        id,
        title: parsed.data.title ?? null,
        source: parsed.data.source ?? "local",
        chatgptId: parsed.data.chatgptId ?? null,
        createdAt: now,
      });

      return reply.code(201).send({
        conversation: {
          id,
          title: parsed.data.title ?? null,
          source: parsed.data.source ?? "local",
          chatgptId: parsed.data.chatgptId ?? null,
          createdAt: now,
        },
      });
    });

    api.get("/conversations/:id/messages", async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid conversation id" });

      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.data.id),
      });
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, params.data.id))
        .orderBy(asc(messages.createdAt));

      return {
        messages: rows.map((row) => ({
          id: row.id,
          conversationId: row.conversationId,
          role: row.role,
          content: row.content,
          toolCalls: parseJsonField(row.toolCallsJson, [] as unknown[]),
          model: row.model,
          createdAt: row.createdAt,
        })),
      };
    });

    api.post("/conversations/:id/messages", async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid conversation id" });

      const bodySchema = z.object({
        role: roleSchema,
        content: z.string().trim().min(1),
        toolCalls: z.array(z.unknown()).optional(),
        model: z.string().trim().min(1).optional(),
      });
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, params.data.id),
      });
      if (!conversation) return reply.code(404).send({ error: "Conversation not found" });

      const now = Date.now();
      const id = randomUUID();
      await db.insert(messages).values({
        id,
        conversationId: params.data.id,
        role: body.data.role,
        content: body.data.content,
        toolCallsJson: body.data.toolCalls ? JSON.stringify(body.data.toolCalls) : null,
        model: body.data.model ?? null,
        createdAt: now,
      });

      return reply.code(201).send({
        message: {
          id,
          conversationId: params.data.id,
          role: body.data.role,
          content: body.data.content,
          toolCalls: body.data.toolCalls ?? [],
          model: body.data.model ?? null,
          createdAt: now,
        },
      });
    });

    api.get("/tasks", async () => {
      const rows = await db.select().from(tasks).orderBy(desc(tasks.updatedAt));
      return {
        tasks: rows.map((row) => ({
          id: row.id,
          title: row.title,
          tags: parseJsonField(row.tagsJson, ["pending"] as string[]),
          metadata: parseJsonField(row.metadataJson, {} as Record<string, unknown>),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      };
    });

    api.post("/tasks", async (request, reply) => {
      const bodySchema = z.object({
        title: z.string().trim().min(1),
        tags: tagsSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      });
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const now = Date.now();
      const id = randomUUID();
      const tags = body.data.tags ?? ["pending"];
      await db.insert(tasks).values({
        id,
        title: body.data.title,
        tagsJson: JSON.stringify(tags),
        metadataJson: body.data.metadata ? JSON.stringify(body.data.metadata) : null,
        createdAt: now,
        updatedAt: now,
      });

      return reply.code(201).send({
        task: {
          id,
          title: body.data.title,
          tags,
          metadata: body.data.metadata ?? {},
          createdAt: now,
          updatedAt: now,
        },
      });
    });

    api.patch("/tasks/:id", async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid task id" });

      const bodySchema = z.object({
        title: z.string().trim().min(1).optional(),
        tags: tagsSchema.optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      });
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const existing = await db.query.tasks.findFirst({ where: eq(tasks.id, params.data.id) });
      if (!existing) return reply.code(404).send({ error: "Task not found" });

      const nextTags = body.data.tags ?? parseJsonField(existing.tagsJson, ["pending"] as string[]);
      const nextMetadata = body.data.metadata ?? parseJsonField(existing.metadataJson, {} as Record<string, unknown>);
      const nextTitle = body.data.title ?? existing.title;
      const now = Date.now();

      await db
        .update(tasks)
        .set({
          title: nextTitle,
          tagsJson: JSON.stringify(nextTags),
          metadataJson: JSON.stringify(nextMetadata),
          updatedAt: now,
        })
        .where(eq(tasks.id, params.data.id));

      return {
        task: {
          id: params.data.id,
          title: nextTitle,
          tags: nextTags,
          metadata: nextMetadata,
          createdAt: existing.createdAt,
          updatedAt: now,
        },
      };
    });

    api.delete("/tasks/:id", async (request, reply) => {
      const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid task id" });

      const result = await db.delete(tasks).where(eq(tasks.id, params.data.id)).returning({ id: tasks.id });
      if (result.length === 0) return reply.code(404).send({ error: "Task not found" });
      return reply.code(204).send();
    });

    api.get("/memory", async () => {
      const rows = await db.select().from(memoryFacts).orderBy(asc(memoryFacts.key));
      return {
        memory: Object.fromEntries(rows.map((row) => [row.key, row.value])),
      };
    });

    api.put("/memory/:key", async (request, reply) => {
      const params = z.object({ key: z.string().trim().min(1) }).safeParse(request.params);
      const body = z.object({ value: z.string() }).safeParse(request.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid memory payload" });

      const updatedAt = Date.now();
      await db
        .insert(memoryFacts)
        .values({ key: params.data.key, value: body.data.value, updatedAt })
        .onConflictDoUpdate({
          target: memoryFacts.key,
          set: { value: body.data.value, updatedAt },
        });

      return {
        fact: {
          key: params.data.key,
          value: body.data.value,
          updatedAt,
        },
      };
    });

    api.delete("/memory/:key", async (request, reply) => {
      const params = z.object({ key: z.string().trim().min(1) }).safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid memory key" });
      await db.delete(memoryFacts).where(eq(memoryFacts.key, params.data.key));
      return reply.code(204).send();
    });

    api.get("/plans", async () => {
      const planRows = await db.select().from(plans).orderBy(desc(plans.createdAt));
      const linkRows = await db.select().from(planConversations);
      const linksByPlan = new Map<string, string[]>();
      for (const link of linkRows) {
        const list = linksByPlan.get(link.planId) ?? [];
        list.push(link.conversationId);
        linksByPlan.set(link.planId, list);
      }
      return {
        plans: planRows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          createdAt: row.createdAt,
          conversationIds: linksByPlan.get(row.id) ?? [],
        })),
      };
    });

    api.post("/plans", async (request, reply) => {
      const bodySchema = z.object({
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        conversationIds: z.array(z.string().trim().min(1)).default([]),
      });
      const body = bodySchema.safeParse(request.body ?? {});
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });

      const id = randomUUID();
      const createdAt = Date.now();
      await db.insert(plans).values({
        id,
        title: body.data.title,
        description: body.data.description,
        createdAt,
      });

      const requestedConversationIds = [...new Set(body.data.conversationIds)];
      let linkedConversationIds: string[] = [];
      if (requestedConversationIds.length > 0) {
        const conversationRows = await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(inArray(conversations.id, requestedConversationIds));
        const validIds = new Set(conversationRows.map((row) => row.id));
        const links = requestedConversationIds
          .filter((conversationId) => validIds.has(conversationId))
          .map((conversationId) => ({ planId: id, conversationId }));
        linkedConversationIds = links.map((link) => link.conversationId);
        if (links.length > 0) {
          await db.insert(planConversations).values(links);
        }
      }

      return reply.code(201).send({
        plan: {
          id,
          title: body.data.title,
          description: body.data.description,
          createdAt,
          conversationIds: linkedConversationIds,
        },
      });
    });
  }, { prefix: "/api" });

  fastify.setErrorHandler(async (error, request, reply) => {
    request.log.error(error);
    if (!reply.sent) {
      await reply.code(500).send({ error: "Internal server error" });
    }
  });

  return { fastify, config };
}

async function start() {
  const { fastify, config } = await buildServer();
  await fastify.listen({ host: "0.0.0.0", port: config.port });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
