import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function buildApiKeyGuard(secret: string) {
  return async function apiKeyGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const provided = request.headers["x-api-key"];
    const key = Array.isArray(provided) ? provided[0] : provided;

    if (!key || typeof key !== "string" || !safeEqual(key, secret)) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  };
}
