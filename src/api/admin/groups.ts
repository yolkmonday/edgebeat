import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { groups, monitors } from "@/db/schema";
import { newId } from "@/lib/ids";

export const groupsApi = new Hono<{ Bindings: Env }>();

const shape = {
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  name: z.string().min(1).max(80),
  sort: z.number().int(),
};
const createSchema = z.object({ ...shape, sort: shape.sort.default(0) });
const patchSchema = z.object({
  slug: shape.slug.optional(),
  name: shape.name.optional(),
  sort: shape.sort.optional(),
});

const onInvalid = (
  result: { success: boolean; error?: { issues: unknown } },
  c: import("hono").Context,
) => {
  if (!result.success) return c.json({ error: "validation", issues: result.error?.issues }, 400);
};

const isUnique = (e: unknown): boolean =>
  /UNIQUE constraint/i.test(`${(e as Error)?.message ?? ""} ${String((e as Error)?.cause ?? "")}`);

const countFor = async (env: Env, id: string): Promise<number> => {
  const [r] = await getDb(env).select({ n: sql<number>`count(*)` }).from(monitors).where(eq(monitors.groupId, id));
  return r?.n ?? 0;
};

groupsApi.get("/", async (c) => {
  const db = getDb(c.env);
  const [rows, counts] = await db.batch([
    db.select().from(groups).orderBy(groups.sort, groups.name),
    db
      .select({ groupId: monitors.groupId, n: sql<number>`count(*)` })
      .from(monitors)
      .where(sql`${monitors.groupId} is not null`)
      .groupBy(monitors.groupId),
  ]);
  const byGroup = new Map(counts.map((r) => [r.groupId, r.n]));
  return c.json(rows.map((g) => ({ ...g, monitorCount: byGroup.get(g.id) ?? 0 })));
});

groupsApi.post("/", zValidator("json", createSchema, onInvalid), async (c) => {
  const row = { id: newId(), ...c.req.valid("json") };
  try {
    await getDb(c.env).insert(groups).values(row);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "slug_conflict" }, 409);
    throw e;
  }
  return c.json({ ...row, monitorCount: 0 }, 201);
});

groupsApi.patch("/:id", zValidator("json", patchSchema, onInvalid), async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const patch = Object.fromEntries(
    Object.entries(c.req.valid("json")).filter(([, v]) => v !== undefined),
  );
  const [existing] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  try {
    if (Object.keys(patch).length > 0) await db.update(groups).set(patch).where(eq(groups.id, id));
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "slug_conflict" }, 409);
    throw e;
  }
  return c.json({ ...existing, ...patch, monitorCount: await countFor(c.env, id) });
});

groupsApi.delete("/:id", async (c) => {
  const db = getDb(c.env);
  const id = c.req.param("id");
  const [existing] = await db.select().from(groups).where(eq(groups.id, id)).limit(1);
  if (!existing) return c.json({ error: "not_found" }, 404);
  await db.batch([
    db.update(monitors).set({ groupId: null }).where(eq(monitors.groupId, id)),
    db.delete(groups).where(eq(groups.id, id)),
  ]);
  return c.body(null, 204);
});
