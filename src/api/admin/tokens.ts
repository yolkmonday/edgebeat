import { zValidator } from "@hono/zod-validator";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { hashToken, newApiToken, tokenPrefix } from "@/lib/api-tokens";
import { newId } from "@/lib/ids";
import type { ApiToken, ApiTokenCreated } from "@/shared/admin-api";

export const tokensApi = new Hono<{ Bindings: Env }>();

const MAX_TOKENS = 20;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(["read", "admin"]),
});

// token_hash is deliberately never selected
const publicColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  scope: apiTokens.scope,
  prefix: apiTokens.prefix,
  createdAt: apiTokens.createdAt,
  lastUsedAt: apiTokens.lastUsedAt,
};

tokensApi.get("/", async (c) => {
  const rows: ApiToken[] = await getDb(c.env).select(publicColumns).from(apiTokens).orderBy(desc(apiTokens.createdAt));
  return c.json(rows);
});

tokensApi.post(
  "/",
  zValidator("json", createSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.issues }, 400);
  }),
  async (c) => {
    const { name, scope } = c.req.valid("json");
    const token = newApiToken();
    const row = {
      id: newId(),
      name,
      scope,
      tokenHash: await hashToken(token),
      prefix: tokenPrefix(token),
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    // insert-if-below-limit in one statement so concurrent creates cannot overshoot the cap
    const result = await getDb(c.env).run(sql`
      INSERT INTO api_tokens (id, name, scope, token_hash, prefix, created_at, last_used_at)
      SELECT ${row.id}, ${row.name}, ${row.scope}, ${row.tokenHash}, ${row.prefix}, ${row.createdAt}, NULL
      WHERE (SELECT count(*) FROM api_tokens) < ${MAX_TOKENS}
    `);
    if ((result.meta.changes ?? 0) === 0) return c.json({ error: "too_many_tokens", max: MAX_TOKENS }, 409);
    const { tokenHash: _hash, ...rest } = row;
    const created: ApiTokenCreated = { ...rest, token };
    return c.json(created, 201);
  },
);

tokensApi.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await getDb(c.env).select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.id, id)).limit(1);
  if (!row) return c.json({ error: "not_found" }, 404);
  await getDb(c.env).delete(apiTokens).where(eq(apiTokens.id, id));
  return c.body(null, 204);
});
