import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { dailyStats, events, groups, heartbeats, monitors, settings } from "@/db/schema";
import { budgetVerdict, effectiveBudget, type BudgetMonitor } from "@/core/budget";
import { newId, newToken } from "@/lib/ids";
import { assertMonitorUrl } from "@/lib/url-guard";
import { chunkRows, MAX_PARAMS, runBatch } from "@/tick/batch";
import {
  DEFAULTS,
  parseHeaders,
  pauseLifecycle,
  redactHeaders,
  toColumns,
  withoutUndefined,
  type Input,
  type Row,
} from "@/api/admin/monitor-columns";
import { monitorInput, SLUG_RE, type MonitorInput } from "@/shared/monitor-schema";
import type { ExportFile, ImportSummary, Issue, Plan } from "@/shared/admin-api";

export const transferApi = new Hono<{ Bindings: Env }>();

const MAX_STATEMENTS = 45;
const MAX_MONITORS_PARSED = 1000; // cheap guard before per-monitor validation
const MAX_GROUPS = 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const MONITOR_COLUMNS = 27;

type Db = ReturnType<typeof getDb>;
type SettingsValues = { siteName: string; plan: Plan; checkBudget: number | null };

const readSettings = async (db: Db): Promise<SettingsValues> => {
  const rows = await db.select().from(settings);
  const get = (key: string): unknown => {
    const row = rows.find((r) => r.key === key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  };
  const siteName = get("siteName");
  const budget = get("checkBudget");
  return {
    siteName: typeof siteName === "string" && siteName !== "" ? siteName : "Status",
    plan: get("plan") === "paid" ? "paid" : "free",
    checkBudget: typeof budget === "number" && Number.isInteger(budget) && budget > 0 ? budget : null,
  };
};

// ---------- export ----------

transferApi.get("/export", async (c) => {
  const db = getDb(c.env);
  const readOnly = c.get("auth")?.scope === "read";
  const [current, groupRows, monitorRows] = await Promise.all([
    readSettings(db),
    db.select().from(groups).orderBy(groups.sort, groups.name),
    db.select().from(monitors).orderBy(monitors.sort, monitors.name),
  ]);
  const slugById = new Map(groupRows.map((g) => [g.id, g.slug]));
  const file: ExportFile = {
    edgebeat: 1,
    exportedAt: new Date().toISOString(),
    settings: current,
    groups: groupRows.map((g) => ({ slug: g.slug, name: g.name, sort: g.sort })),
    monitors: monitorRows.map((row) => {
      const { groupId: _g, ...rest } = toExportMonitor(row);
      if (readOnly && rest.headers) rest.headers = redactHeaders(rest.headers);
      return { ...rest, group: row.groupId ? (slugById.get(row.groupId) ?? null) : null };
    }),
  };
  const day = file.exportedAt.slice(0, 10);
  c.header("Content-Disposition", `attachment; filename="edgebeat-config-${day}.json"`);
  return c.json(file);
});

/** Row -> input shape, passed through the schema so a re-import round-trips; no id, token or timestamps. */
const toExportMonitor = (row: Row): MonitorInput => {
  const raw = {
    name: row.name,
    slug: row.slug,
    type: row.type,
    groupId: row.groupId,
    url: row.url,
    method: row.method,
    headers: parseHeaders(row.headers),
    body: row.body,
    expectedStatus: row.expectedStatus,
    timeoutMs: row.timeoutMs,
    followRedirects: row.followRedirects === 1,
    keyword: row.keyword,
    keywordMode: row.keywordMode,
    host: row.host,
    port: row.port,
    intervalMin: row.intervalMin,
    confirmations: row.confirmations,
    degradedThresholdMs: row.degradedThresholdMs,
    heartbeatPeriodS: row.heartbeatPeriodS,
    heartbeatGraceS: row.heartbeatGraceS,
    isPublic: row.isPublic === 1,
    paused: row.paused === 1,
    sort: row.sort,
  };
  const parsed = monitorInput.safeParse(raw);
  return parsed.success ? parsed.data : (raw as MonitorInput);
};

// ---------- import ----------

const fileShape = z.object({
  edgebeat: z.literal(1),
  settings: z
    .object({
      siteName: z.string().trim().min(1).max(80).optional(),
      plan: z.enum(["free", "paid"]).optional(),
      checkBudget: z.number().int().min(1).max(10_000).nullable().optional(),
    })
    .optional(),
  groups: z.array(z.object({ slug: z.string().regex(SLUG_RE), name: z.string().min(1).max(80), sort: z.number().int().default(0) })).max(MAX_GROUPS),
  monitors: z.array(z.record(z.string(), z.unknown())),
});

const issue = (path: (string | number)[], message: string): Issue => ({ path, message });

const bool = (c: Context, name: string): boolean => c.req.query(name) === "true";

type PlannedMonitor = { input: Input & typeof DEFAULTS; groupSlug: string | null };

const dupes = (slugs: string[]): Set<string> => {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of slugs) (seen.has(s) ? dup : seen).add(s);
  return dup;
};

/** Reads the JSON body with a hard size cap; "too_large" when over, null when not valid JSON. */
const readJsonCapped = async (c: Context): Promise<unknown | "too_large"> => {
  const declared = Number(c.req.header("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "too_large";
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) return "too_large";
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as unknown;
  } catch {
    return null;
  }
};

transferApi.post("/import", async (c) => {
  const prune = bool(c, "prune");
  const dryRun = bool(c, "dryRun");
  const bad = (issues: Issue[]) => c.json({ error: "validation", issues }, 400);

  const body = await readJsonCapped(c);
  if (body === "too_large") return c.json({ error: "too_large" }, 413);
  const top = fileShape.safeParse(body);
  if (!top.success) return bad(top.error.issues.map((i) => issue(i.path as (string | number)[], i.message)));
  const file = top.data;
  if (file.monitors.length > MAX_MONITORS_PARSED) return c.json({ error: "too_large" }, 413);

  const db = getDb(c.env);
  const [currentSettings, groupRows, monitorRows] = await Promise.all([
    readSettings(db),
    db.select().from(groups),
    db.select().from(monitors),
  ]);
  const groupBySlug = new Map(groupRows.map((g) => [g.slug, g]));
  const monitorBySlug = new Map(monitorRows.map((m) => [m.slug, m]));

  // ----- validate everything before touching anything
  const issues: Issue[] = [];
  const dupGroups = dupes(file.groups.map((g) => g.slug));
  file.groups.forEach((g, i) => {
    if (dupGroups.has(g.slug)) issues.push(issue(["groups", i, "slug"], "duplicate slug"));
  });
  const fileGroupSlugs = new Set(file.groups.map((g) => g.slug));
  const knownGroup = (slug: string) => fileGroupSlugs.has(slug) || (!prune && groupBySlug.has(slug));

  const planned: PlannedMonitor[] = [];
  const dupMonitors = dupes(file.monitors.map((m) => (typeof m.slug === "string" ? m.slug : "")));
  file.monitors.forEach((raw, i) => {
    const { group, ...rest } = raw;
    const parsed = monitorInput.safeParse(rest);
    if (!parsed.success) {
      for (const p of parsed.error.issues) issues.push(issue(["monitors", i, ...(p.path as (string | number)[])], p.message));
      return;
    }
    const v = parsed.data;
    if (dupMonitors.has(v.slug)) issues.push(issue(["monitors", i, "slug"], "duplicate slug"));
    if (group != null && (typeof group !== "string" || !knownGroup(group))) {
      issues.push(issue(["monitors", i, "group"], "unknown group"));
    }
    if (v.groupId != null) issues.push(issue(["monitors", i, "groupId"], "use group (slug) instead of groupId"));
    const existing = monitorBySlug.get(v.slug);
    if (existing && existing.type !== v.type) issues.push(issue(["monitors", i, "type"], "type is immutable"));
    if (v.type === "http") {
      try {
        assertMonitorUrl(v.url ?? "");
      } catch {
        issues.push(issue(["monitors", i, "url"], "invalid_url"));
      }
    }
    planned.push({
      input: { ...DEFAULTS, followRedirects: v.keyword != null, ...withoutUndefined(v), groupId: null } as Input & typeof DEFAULTS,
      groupSlug: typeof group === "string" ? group : null,
    });
  });
  if (issues.length > 0) return bad(issues);

  // ----- plan
  const now = Date.now();
  const groupIdBySlug = new Map<string, string>();
  const groupRowsOut = file.groups.map((g) => {
    const existing = groupBySlug.get(g.slug);
    const id = existing?.id ?? newId();
    groupIdBySlug.set(g.slug, id);
    return { id, slug: g.slug, name: g.name, sort: g.sort };
  });
  if (!prune) for (const g of groupRows) if (!groupIdBySlug.has(g.slug)) groupIdBySlug.set(g.slug, g.id);

  const monitorRowsOut: Row[] = planned.map(({ input, groupSlug }) => {
    const existing = monitorBySlug.get(input.slug);
    const type = input.type;
    return {
      id: existing?.id ?? newId(),
      ...toColumns({ ...input, groupId: groupSlug ? (groupIdBySlug.get(groupSlug) ?? null) : null }),
      heartbeatToken: existing ? existing.heartbeatToken : type === "heartbeat" ? newToken() : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  });

  const fileMonitorSlugs = new Set(planned.map((p) => p.input.slug));
  const prunedMonitors = prune ? monitorRows.filter((m) => !fileMonitorSlugs.has(m.slug)) : [];
  const prunedGroups = prune ? groupRows.filter((g) => !fileGroupSlugs.has(g.slug)) : [];

  // budget: peak of what the database will hold afterwards vs. what it holds now
  const asBudget = (m: Pick<Row, "id" | "type" | "intervalMin" | "paused">): BudgetMonitor => ({
    id: m.id,
    type: m.type,
    intervalMin: m.intervalMin,
    paused: m.paused === 1,
  });
  const resulting = [
    ...(prune ? [] : monitorRows.filter((m) => !fileMonitorSlugs.has(m.slug))),
    ...monitorRowsOut,
  ].map(asBudget);
  const plan = file.settings?.plan ?? currentSettings.plan;
  const override = file.settings?.checkBudget !== undefined ? file.settings.checkBudget : currentSettings.checkBudget;
  const verdict = budgetVerdict(monitorRows.map(asBudget), resulting, effectiveBudget(plan, override));
  if (!verdict.ok) return c.json({ error: "budget_exceeded", used: verdict.used, after: verdict.after, budget: verdict.budget }, 409);

  // ----- statements
  const stmts: Parameters<typeof runBatch>[1] = [];

  const settingEntries = Object.entries(file.settings ?? {}).filter(
    ([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify(currentSettings[k as keyof SettingsValues]),
  );
  for (const chunk of chunkRows(settingEntries, 2)) {
    stmts.push(
      db
        .insert(settings)
        .values(chunk.map(([key, v]) => ({ key, value: JSON.stringify(v) })))
        .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } }),
    );
  }

  for (const chunk of chunkRows(groupRowsOut, 4)) {
    stmts.push(
      db
        .insert(groups)
        .values(chunk)
        .onConflictDoUpdate({ target: groups.slug, set: { name: sql`excluded.name`, sort: sql`excluded.sort` } }),
    );
  }

  for (const chunk of chunkRows(monitorRowsOut, MONITOR_COLUMNS)) {
    stmts.push(
      db.insert(monitors).values(chunk).onConflictDoUpdate({
        target: monitors.slug,
        // id, heartbeat_token and created_at are never overwritten
        set: UPSERT_SET as never,
      }),
    );
  }
  const newHeartbeats = monitorRowsOut.filter((m) => m.type === "heartbeat" && !monitorBySlug.has(m.slug));
  for (const chunk of chunkRows(newHeartbeats, 1)) {
    stmts.push(db.insert(heartbeats).values(chunk.map((m) => ({ monitorId: m.id }))).onConflictDoNothing());
  }

  // paused flips go through the same lifecycle as PATCH
  for (const row of monitorRowsOut) {
    const existing = monitorBySlug.get(row.slug);
    if (existing && existing.paused !== row.paused) {
      stmts.push(...(await pauseLifecycle(db, existing, row.paused === 1, now)));
    }
  }

  const idChunks = <T,>(items: T[]): T[][] => {
    const size = MAX_PARAMS - 1;
    return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
  };
  for (const chunk of idChunks(prunedMonitors.map((m) => m.id))) {
    stmts.push(db.delete(events).where(inArray(events.monitorId, chunk)));
    stmts.push(db.delete(dailyStats).where(inArray(dailyStats.monitorId, chunk)));
    stmts.push(db.delete(monitors).where(inArray(monitors.id, chunk)));
  }
  for (const chunk of idChunks(prunedGroups.map((g) => g.id))) {
    stmts.push(db.update(monitors).set({ groupId: null }).where(and(isNotNull(monitors.groupId), inArray(monitors.groupId, chunk))));
    stmts.push(db.delete(groups).where(inArray(groups.id, chunk)));
  }

  if (stmts.length > MAX_STATEMENTS) {
    return c.json({ error: "too_large", statements: stmts.length, max: MAX_STATEMENTS }, 413);
  }

  const summary: ImportSummary = {
    dryRun,
    prune,
    settingsChanged: settingEntries.length > 0,
    groups: {
      created: file.groups.filter((g) => !groupBySlug.has(g.slug)).map((g) => g.slug),
      updated: file.groups.filter((g) => groupBySlug.has(g.slug)).map((g) => g.slug),
      deleted: prunedGroups.map((g) => g.slug),
    },
    monitors: {
      created: monitorRowsOut.filter((m) => !monitorBySlug.has(m.slug)).map((m) => m.slug),
      updated: monitorRowsOut.filter((m) => monitorBySlug.has(m.slug)).map((m) => m.slug),
      deleted: prunedMonitors.map((m) => m.slug),
    },
  };
  if (!dryRun) await runBatch(db, stmts);
  return c.json(summary);
});

const COLUMN_NAMES: Record<string, string> = {
  name: "name",
  type: "type",
  groupId: "group_id",
  url: "url",
  method: "method",
  headers: "headers",
  body: "body",
  expectedStatus: "expected_status",
  timeoutMs: "timeout_ms",
  followRedirects: "follow_redirects",
  keyword: "keyword",
  keywordMode: "keyword_mode",
  host: "host",
  port: "port",
  intervalMin: "interval_min",
  confirmations: "confirmations",
  degradedThresholdMs: "degraded_threshold_ms",
  heartbeatPeriodS: "heartbeat_period_s",
  heartbeatGraceS: "heartbeat_grace_s",
  isPublic: "is_public",
  paused: "paused",
  sort: "sort",
  updatedAt: "updated_at",
};

const UPSERT_SET = Object.fromEntries(Object.entries(COLUMN_NAMES).map(([key, column]) => [key, sql.raw(`excluded.${column}`)]));
