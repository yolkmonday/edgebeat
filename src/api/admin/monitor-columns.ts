import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { events, heartbeats, monitors, monitorState, snapshot } from "@/db/schema";
import { monitorInput } from "@/shared/monitor-schema";

export type Row = typeof monitors.$inferSelect;
export type Input = z.infer<typeof monitorInput>;
type Db = ReturnType<typeof getDb>;

export const DEFAULTS = {
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

export const isUnique = (e: unknown): boolean =>
  /UNIQUE constraint/i.test(`${(e as Error)?.message ?? ""} ${String((e as Error)?.cause ?? "")}`);

export const parseHeaders = (raw: string): Record<string, string> => {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
};

export const toApiMonitor = (row: Row, origin: string) => {
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
export type ApiMonitor = ReturnType<typeof toApiMonitor>;

export const withoutUndefined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** Normalizes a validated record into row columns; fields foreign to the type are nulled. */
export const toColumns = (v: Input & typeof DEFAULTS) => {
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

/**
 * Statements for a pause flip. Pause: state {paused, 0} + event x→paused (downtime stops).
 * Unpause: state {pending, 0} + event paused→pending, the pre-pause public entry is dropped,
 * and heartbeats forget beats so they stay pending until the next one (none were accepted while paused).
 */
export const pauseLifecycle = async (db: Db, row: Row, paused: boolean, now: number) => {
  const [prev] = await db
    .select({ state: monitorState.state })
    .from(monitorState)
    .where(eq(monitorState.monitorId, row.id))
    .limit(1);
  const from = paused ? (prev?.state ?? "pending") : "paused";
  const to = paused ? "paused" : "pending";
  return [
    db
      .insert(monitorState)
      .values({ monitorId: row.id, state: to, consecutiveFailures: 0, lastChangeAt: now })
      .onConflictDoUpdate({
        target: monitorState.monitorId,
        set: { state: to, consecutiveFailures: 0, lastChangeAt: now },
      }),
    ...(from === to
      ? []
      : [db.insert(events).values({ monitorId: row.id, fromState: from, toState: to, at: now, reason: paused ? "paused" : "unpaused" })]),
    ...(paused
      ? []
      : [
          db
            .update(snapshot)
            .set({ current: sql`json_remove(${snapshot.current}, ${`$."${row.id}"`})` })
            .where(eq(snapshot.id, 1)),
        ]),
    ...(!paused && row.type === "heartbeat"
      ? [db.update(heartbeats).set({ lastBeatAt: null, lastFailAt: null }).where(eq(heartbeats.monitorId, row.id))]
      : []),
  ];
};
