import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { dailyStats, events, groups, heartbeats, monitors } from "@/db/schema";
import { newId, newToken } from "@/lib/ids";
import { assertMonitorUrl } from "@/lib/url-guard";

export const monitorsApi = new Hono<{ Bindings: Env }>();

type Row = typeof monitors.$inferSelect;
type AppContext = Context<{ Bindings: Env }>;

const INTERVALS = [1, 2, 3, 5, 10, 15, 30, 60] as const;
const STATUS_SPEC = /^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/;

// no .default() here: PATCH reuses this shape through .partial(), which would re-apply defaults
const shape = {
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  type: z.enum(["http", "tcp", "heartbeat"]),
  groupId: z.string().min(1).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  body: z.string().max(65_536).nullable().optional(),
  expectedStatus: z.string().max(100).regex(STATUS_SPEC).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
  followRedirects: z.boolean().optional(),
  keyword: z.string().min(1).max(500).nullable().optional(),
  keywordMode: z.enum(["contains", "not_contains"]).optional(),
  host: z.string().min(1).max(255).nullable().optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  intervalMin: z
    .number()
    .refine((n): n is (typeof INTERVALS)[number] => (INTERVALS as readonly number[]).includes(n), {
      message: "intervalMin must be one of 1, 2, 3, 5, 10, 15, 30, 60",
    })
    .optional(),
  confirmations: z.number().int().min(1).max(10).optional(),
  degradedThresholdMs: z.number().int().min(1).nullable().optional(),
  heartbeatPeriodS: z.number().int().min(60).nullable().optional(),
  heartbeatGraceS: z.number().int().min(0).nullable().optional(),
  isPublic: z.boolean().optional(),
  paused: z.boolean().optional(),
  sort: z.number().int().optional(),
};

const DEFAULTS = {
  method: "GET",
  headers: {} as Record<string, string>,
  expectedStatus: "200-399",
  timeoutMs: 10_000,
  // each redirect hop is a subrequest; only keyword checks default to following (see POST)
  followRedirects: false,
  keywordMode: "contains" as const,
  intervalMin: 1,
  confirmations: 2,
  isPublic: true,
  paused: false,
  sort: 0,
};

// Workers cannot open outbound connections to port 25
const BLOCKED_TCP_PORTS = new Set([25]);

const need = (ctx: z.RefinementCtx, path: string, message: string) =>
  ctx.addIssue({ code: "custom", path: [path], message });

const validHeaders = (h: Record<string, string>): boolean => {
  try {
    new Headers(h);
    return true;
  } catch {
    return false;
  }
};

/** Full-record rules: `type`-specific required fields, and configs that could never pass. */
export const monitorInput = z.object(shape).superRefine((v, ctx) => {
  if (v.type === "http") {
    if (!v.url) need(ctx, "url", "url is required for http monitors");
    const method = v.method ?? "GET";
    const bodyless = method === "GET" || method === "HEAD";
    if (bodyless && v.body != null) need(ctx, "body", `${method} requests cannot have a body`);
    if (method === "HEAD" && v.keyword != null) need(ctx, "keyword", "HEAD responses have no body to match a keyword");
    if (v.headers && !validHeaders(v.headers)) need(ctx, "headers", "invalid header name or value");
  }
  if (v.type === "tcp") {
    if (!v.host) need(ctx, "host", "host is required for tcp monitors");
    if (v.port == null) need(ctx, "port", "port is required for tcp monitors");
    else if (BLOCKED_TCP_PORTS.has(v.port)) need(ctx, "port", "port 25 is blocked for outbound connections on Workers");
  }
  if (v.type === "heartbeat") {
    if (v.heartbeatPeriodS == null) need(ctx, "heartbeatPeriodS", "heartbeatPeriodS (>= 60) is required");
    if (v.heartbeatGraceS == null) need(ctx, "heartbeatGraceS", "heartbeatGraceS (>= 0) is required");
  }
});
const patchInput = z.object(shape).partial();

type Input = z.infer<typeof monitorInput>;

const onInvalid = (
  result: { success: boolean; error?: { issues: unknown } },
  c: Context,
) => {
  if (!result.success) return c.json({ error: "validation", issues: result.error?.issues }, 400);
};

const isUnique = (e: unknown): boolean =>
  /UNIQUE constraint/i.test(`${(e as Error)?.message ?? ""} ${String((e as Error)?.cause ?? "")}`);

const parseHeaders = (raw: string): Record<string, string> => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
};

const toApi = (row: Row, origin: string) => {
  const { heartbeatToken, headers, isPublic, paused, followRedirects, ...rest } = row;
  return {
    ...rest,
    headers: parseHeaders(headers),
    isPublic: isPublic === 1,
    paused: paused === 1,
    followRedirects: followRedirects === 1,
    ...(row.type === "heartbeat" && heartbeatToken
      ? { beatUrl: `${origin}/beat/${heartbeatToken}` }
      : {}),
  };
};
type ApiMonitor = ReturnType<typeof toApi>;

const withoutUndefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Normalizes a validated record into row columns; fields foreign to the type are nulled. */
const toColumns = (v: Input & typeof DEFAULTS) => {
  const http = v.type === "http";
  return {
    name: v.name,
    slug: v.slug,
    type: v.type,
    groupId: v.groupId ?? null,
    url: http ? (v.url ?? null) : null,
    method: http ? v.method : "GET",
    headers: JSON.stringify(http ? v.headers : {}),
    body: http ? (v.body ?? null) : null,
    expectedStatus: v.expectedStatus,
    timeoutMs: v.timeoutMs,
    followRedirects: v.followRedirects ? 1 : 0,
    keyword: http ? (v.keyword ?? null) : null,
    keywordMode: v.keywordMode,
    host: v.type === "tcp" ? (v.host ?? null) : null,
    port: v.type === "tcp" ? (v.port ?? null) : null,
    intervalMin: v.intervalMin,
    confirmations: v.confirmations,
    degradedThresholdMs: v.degradedThresholdMs ?? null,
    heartbeatPeriodS: v.type === "heartbeat" ? (v.heartbeatPeriodS ?? null) : null,
    heartbeatGraceS: v.type === "heartbeat" ? (v.heartbeatGraceS ?? null) : null,
    isPublic: v.isPublic ? 1 : 0,
    paused: v.paused ? 1 : 0,
    sort: v.sort,
  };
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

monitorsApi.get("/", async (c) => {
  const rows = await getDb(c.env).select().from(monitors).orderBy(monitors.sort, monitors.name);
  return c.json(rows.map((r) => toApi(r, origin(c))));
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
  return c.json(toApi(row, origin(c)), 201);
});

monitorsApi.get("/:id", async (c) => {
  const row = await findRow(c, c.req.param("id"));
  return row ? c.json(toApi(row, origin(c))) : c.json({ error: "not_found" }, 404);
});

monitorsApi.patch("/:id", zValidator("json", patchInput, onInvalid), async (c) => {
  const row = await findRow(c, c.req.param("id"));
  if (!row) return c.json({ error: "not_found" }, 404);
  const patch = withoutUndefined(c.req.valid("json"));
  if (patch.type !== undefined && patch.type !== row.type) {
    return c.json({ error: "validation", issues: [{ path: ["type"], message: "type is immutable" }] }, 400);
  }
  // merge the stored record with the patch, then validate the whole thing
  const { beatUrl: _b, id: _i, createdAt: _c, updatedAt: _u, ...current } = toApi(row, origin(c)) as ApiMonitor & { beatUrl?: string };
  const merged = monitorInput.safeParse({ ...current, ...patch });
  if (!merged.success) return c.json({ error: "validation", issues: merged.error.issues }, 400);
  const input = { ...DEFAULTS, ...withoutUndefined(merged.data) } as Input & typeof DEFAULTS;
  const bad = await checkReferences(c, input);
  if (bad) return bad;

  const cols = { ...toColumns(input), updatedAt: Date.now() };
  try {
    await getDb(c.env).update(monitors).set(cols).where(eq(monitors.id, row.id));
  } catch (e) {
    if (isUnique(e)) return c.json({ error: "slug_conflict" }, 409);
    throw e;
  }
  return c.json(toApi({ ...row, ...cols }, origin(c)));
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
  return c.json(toApi({ ...row, heartbeatToken: token, updatedAt }, origin(c)));
});
