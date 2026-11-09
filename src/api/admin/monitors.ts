import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { dailyStats, events, groups, heartbeats, monitors, snapshot } from "@/db/schema";
import { newId, newToken } from "@/lib/ids";
import { assertMonitorUrl } from "@/lib/url-guard";
import { budgetVerdict, effectiveBudget, type BudgetMonitor } from "@/core/budget";
import { alignBars } from "@/core/public-status";
import { runHttpCheck } from "@/checks/http";
import { runTcpCheck } from "@/checks/tcp";

import { monitorInput, monitorPatch } from "@/shared/monitor-schema";
import type { Monitor, MonitorDetail, TestCheckResult } from "@/shared/admin-api";
import { eventsQuery, toStateEvent } from "@/api/admin/event-rows";
import { readSnapshot, statusOf } from "@/api/admin/monitor-status";
import { readStoredSettings } from "@/api/admin/settings";
import {
  DEFAULTS,
  isUnique,
  parseHeaders,
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
const redactFor = <T extends ApiMonitor>(c: AppContext, m: T): T =>
  c.get("auth")?.scope === "read" ? redactMonitor(m) : m;

const toBudgetMonitor = (r: Pick<Row, "id" | "type" | "intervalMin" | "paused">): BudgetMonitor => ({
  id: r.id,
  type: r.type,
  intervalMin: r.intervalMin,
  paused: r.paused === 1,
});

/** 409 when `after` would raise the peak checks per minute above the plan budget; null otherwise. */
const budgetGuard = async (
  c: AppContext,
  after: (before: BudgetMonitor[]) => BudgetMonitor[],
): Promise<Response | null> => {
  const [rows, stored] = await Promise.all([
    getDb(c.env)
      .select({ id: monitors.id, type: monitors.type, intervalMin: monitors.intervalMin, paused: monitors.paused })
      .from(monitors),
    readStoredSettings(c.env),
  ]);
  const before = rows.map(toBudgetMonitor);
  const verdict = budgetVerdict(before, after(before), effectiveBudget(stored.plan, stored.checkBudget));
  if (verdict.ok) return null;
  return c.json({ error: "budget_exceeded", used: verdict.used, after: verdict.after, budget: verdict.budget }, 409);
};

/** One batch: the monitor, the snapshot and the heartbeat row. Null when the monitor does not exist. */
const loadWithStatus = async (c: AppContext, id: string) => {
  const now = Date.now();
  const db = getDb(c.env);
  const [[row], [snap], [beat]] = await db.batch([
    db.select().from(monitors).where(eq(monitors.id, id)).limit(1),
    db
      .select({ lastTickAt: snapshot.lastTickAt, current: snapshot.current, bars: snapshot.bars })
      .from(snapshot)
      .where(eq(snapshot.id, 1)),
    db.select().from(heartbeats).where(eq(heartbeats.monitorId, id)).limit(1),
  ]);
  if (!row) return null;
  const view = readSnapshot(snap, now);
  const monitor: Monitor = { ...toApiMonitor(row, origin(c)), status: statusOf(row, view, beat, now) };
  return { row, view, monitor, now };
};

monitorsApi.get("/", async (c) => {
  const now = Date.now();
  const db = getDb(c.env);
  const [rows, [snap], beats] = await db.batch([
    db.select().from(monitors).orderBy(monitors.sort, monitors.name),
    db
      .select({ lastTickAt: snapshot.lastTickAt, current: snapshot.current, bars: snapshot.bars })
      .from(snapshot)
      .where(eq(snapshot.id, 1)),
    db.select().from(heartbeats),
  ]);
  const snapView = readSnapshot(snap, now);
  const beatById = new Map(beats.map((h) => [h.monitorId, h]));
  const list: Monitor[] = rows.map((r) => ({
    ...toApiMonitor(r, origin(c)),
    status: statusOf(r, snapView, beatById.get(r.id), now),
  }));
  return c.json(list.map((m) => redactFor(c, m)));
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
  const tooMany = await budgetGuard(c, (before) => [
    ...before,
    { id, type: input.type, intervalMin: input.intervalMin, paused: input.paused },
  ]);
  if (tooMany) return tooMany;

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
  const created: Monitor = {
    ...toApiMonitor(row, origin(c)),
    status: statusOf(row, readSnapshot(undefined, now), undefined, now),
  };
  return c.json(created, 201);
});

const DETAIL_EVENTS = 20;

monitorsApi.get("/:id", async (c) => {
  const found = await loadWithStatus(c, c.req.param("id"));
  if (!found) return c.json({ error: "not_found" }, 404);
  const recent = await eventsQuery(getDb(c.env), { monitorId: found.row.id }, DETAIL_EVENTS);
  const body: MonitorDetail = {
    ...found.monitor,
    bars: alignBars(found.view.bars[found.row.id] ?? [], found.now),
    events: recent.map(toStateEvent),
  };
  return c.json(redactFor(c, body));
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
  const tooMany = await budgetGuard(c, (before) =>
    before.map((m) => (m.id === row.id ? { ...m, intervalMin: input.intervalMin, paused: input.paused } : m)),
  );
  if (tooMany) return tooMany;

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
  const found = await loadWithStatus(c, row.id);
  return found ? c.json(found.monitor) : c.json({ error: "not_found" }, 404);
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
  const found = await loadWithStatus(c, row.id);
  return found ? c.json(found.monitor) : c.json({ error: "not_found" }, 404);
});

// per-isolate fixed window; best effort, resets on isolate recycle
const CHECK_WINDOW_MS = 60_000;
const CHECK_MAX = 6;
const CHECK_SUBREQUESTS = 6;
const CHECK_TIMEOUT_MS = 15_000;
const checkLimiter = { start: 0, count: 0 };

export const resetCheckLimiter = (): void => {
  checkLimiter.start = 0;
  checkLimiter.count = 0;
};

// reserved synchronously so concurrent requests cannot all pass
const reserveCheck = (now: number): boolean => {
  if (now - checkLimiter.start >= CHECK_WINDOW_MS) {
    checkLimiter.start = now;
    checkLimiter.count = 0;
  }
  if (checkLimiter.count >= CHECK_MAX) return false;
  checkLimiter.count += 1;
  return true;
};

const runCheck = (row: Row, timeoutMs: number) => {
  if (row.type === "tcp" && row.host && row.port !== null) {
    return runTcpCheck({ id: row.id, host: row.host, port: row.port }, timeoutMs);
  }
  if (row.type !== "http" || !row.url) return Promise.resolve(null);
  try {
    // same SSRF guard as create; every redirect hop is re-checked inside runHttpCheck
    assertMonitorUrl(row.url);
  } catch {
    return Promise.resolve(null);
  }
  let subrequests = CHECK_SUBREQUESTS;
  return runHttpCheck(
    {
      id: row.id,
      url: row.url,
      method: row.method,
      headers: parseHeaders(row.headers),
      body: row.body,
      expectedStatus: row.expectedStatus,
      timeoutMs,
      followRedirects: row.followRedirects !== 0,
      keyword: row.keyword,
      keywordMode: row.keywordMode,
    },
    timeoutMs,
    () => subrequests-- > 0,
  );
};

/** Runs one check right now. Writes nothing: no state, no event, no stats. */
monitorsApi.post("/:id/check", async (c) => {
  const row = await findRow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.type === "heartbeat") return c.json({ error: "not_checkable" }, 400);
  if (!reserveCheck(Date.now())) return c.json({ error: "too_many_checks" }, 429);

  const at = Date.now();
  const result = await runCheck(row, Math.min(row.timeoutMs, CHECK_TIMEOUT_MS));
  const body: TestCheckResult = result
    ? { ok: result.ok, latencyMs: result.latencyMs, code: result.code, error: result.error, at }
    : { ok: false, latencyMs: null, code: null, error: "other", at };
  return c.json(body);
});
