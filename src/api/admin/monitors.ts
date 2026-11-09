import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { dailyStats, events, groups, heartbeats, monitors } from "@/db/schema";
import { newId, newToken } from "@/lib/ids";
import { assertMonitorUrl } from "@/lib/url-guard";

import { monitorInput, monitorPatch } from "@/shared/monitor-schema";
import {
  DEFAULTS,
  isUnique,
  pauseLifecycle,
  redactMonitor,
  toApiMonitor,
  toColumns,
  withoutUndefined,
  type ApiMonitor,
  type Input,
  type Row,
} from "@/api/admin/monitor-columns";

export const monitorsApi = new Hono<{ Bindings: Env }>();

type AppContext = Context<{ Bindings: Env }>;

const onInvalid = (
  result: { success: boolean; error?: { issues: unknown } },
  c: Context,
) => {
  if (!result.success) return c.json({ error: "validation", issues: result.error?.issues }, 400);
};

/** Returns an error response, or null when the url passes the SSRF guard / group exists. */
const checkReferences = async (c: AppContext, v: Input): Promise<Response | null> => {
  if (v.type === "http") {
    try {
      assertMonitorUrl(v.url ?? "");
    } catch {
      return c.json({ error: "invalid_url" }, 400);
    }
  }
  if (v.groupId) {
    const [g] = await getDb(c.env).select({ id: groups.id }).from(groups).where(eq(groups.id, v.groupId)).limit(1);
    if (!g) return c.json({ error: "validation", issues: [{ path: ["groupId"], message: "unknown group" }] }, 400);
  }
  return null;
};

const findRow = async (c: AppContext, id: string): Promise<Row | undefined> =>
  (await getDb(c.env).select().from(monitors).where(eq(monitors.id, id)).limit(1))[0];

const origin = (c: AppContext) => new URL(c.req.url).origin;

/** Read-scope tokens never see the beat url or header values. */
const view = (c: AppContext, row: Row) => {
  const m = toApiMonitor(row, origin(c));
  return c.get("auth")?.scope === "read" ? redactMonitor(m) : m;
};

monitorsApi.get("/", async (c) => {
  const rows = await getDb(c.env).select().from(monitors).orderBy(monitors.sort, monitors.name);
  return c.json(rows.map((r) => view(c, r)));
});

monitorsApi.post("/", zValidator("json", monitorInput, onInvalid), async (c) => {
  const valid = c.req.valid("json");
  const input = {
    ...DEFAULTS,
    followRedirects: valid.keyword != null,
    ...withoutUndefined(valid),
  } as Input & typeof DEFAULTS;
  const bad = await checkReferences(c, input);
  if (bad) return bad;

  const db = getDb(c.env);
  const now = Date.now();
  const id = newId();
  const row: Row = {
    id,
    ...toColumns(input),
    heartbeatToken: input.type === "heartbeat" ? newToken() : null,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await db.batch([
      db.insert(monitors).values(row),
      ...(input.type === "heartbeat" ? [db.insert(heartbeats).values({ monitorId: id })] : []),
    ]);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "slug_conflict" }, 409);
    throw e;
  }
  return c.json(toApiMonitor(row, origin(c)), 201);
});

monitorsApi.get("/:id", async (c) => {
  const row = await findRow(c, c.req.param("id"));
  return row ? c.json(view(c, row)) : c.json({ error: "not_found" }, 404);
});

monitorsApi.patch("/:id", zValidator("json", monitorPatch, onInvalid), async (c) => {
  const row = await findRow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const patch = withoutUndefined(c.req.valid("json"));
  if (patch.type !== undefined && patch.type !== row.type) {
    return c.json({ error: "validation", issues: [{ path: ["type"], message: "type is immutable" }] }, 400);
  }
  // merge the stored record with the patch, then validate the whole thing
  const { beatUrl: _b, id: _i, createdAt: _c, updatedAt: _u, ...current } = toApiMonitor(row, origin(c)) as ApiMonitor & { beatUrl?: string };
  const merged = monitorInput.safeParse({ ...current, ...patch });
  if (!merged.success) return c.json({ error: "validation", issues: merged.error.issues }, 400);
  const input = { ...DEFAULTS, ...withoutUndefined(merged.data) } as Input & typeof DEFAULTS;
  const bad = await checkReferences(c, input);
  if (bad) return bad;

  const now = Date.now();
  const cols = { ...toColumns(input), updatedAt: now };
  const db = getDb(c.env);
  const lifecycle = input.paused !== (row.paused === 1) ? await pauseLifecycle(getDb(c.env), row, input.paused, now) : [];
  try {
    await db.batch([db.update(monitors).set(cols).where(eq(monitors.id, row.id)), ...lifecycle]);
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "slug_conflict" }, 409);
    throw e;
  }
  return c.json(toApiMonitor({ ...row, ...cols }, origin(c)));
});

monitorsApi.delete("/:id", async (c) => {
  const row = await findRow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const db = getDb(c.env);
  // events and daily_stats have no FK cascade; monitor_state and heartbeats cascade
  await db.batch([
    db.delete(events).where(eq(events.monitorId, row.id)),
    db.delete(dailyStats).where(eq(dailyStats.monitorId, row.id)),
    db.delete(monitors).where(eq(monitors.id, row.id)),
  ]);
  return c.body(null, 204);
});

monitorsApi.post("/:id/rotate-token", async (c) => {
  const row = await findRow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.type !== "heartbeat") return c.json({ error: "not_heartbeat" }, 400);
  const token = newToken();
  const updatedAt = Date.now();
  await getDb(c.env).update(monitors).set({ heartbeatToken: token, updatedAt }).where(eq(monitors.id, row.id));
  return c.json(toApiMonitor({ ...row, heartbeatToken: token, updatedAt }, origin(c)));
});
