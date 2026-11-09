import { SELF, env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { expect } from "vitest";
import { resetLoginLimiter } from "@/api/admin/auth";
import { resetCheckLimiter } from "@/api/admin/monitors";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";

export const db = getDb(env);
export const BASE = "https://edgebeat.test";

export const getCookie = async (): Promise<string> => {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(res.status).toBe(204);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
};

export const call = (cookie: string, method: string, path: string, body?: unknown) =>
  SELF.fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: {
      cookie,
      ...(method !== "GET" ? { origin: BASE } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

export const resetAdminDb = async (): Promise<void> => {
  resetLoginLimiter();
  resetCheckLimiter();
  await db.batch([
    db.delete(t.monitorState),
    db.delete(t.heartbeats),
    db.delete(t.events),
    db.delete(t.dailyStats),
    db.delete(t.ticks),
    db.delete(t.snapshot),
    db.delete(t.monitors),
    db.delete(t.groups),
    db.delete(t.settings),
  ]);
};

export const monitorRow = (id: string, extra: Partial<typeof t.monitors.$inferInsert> = {}) => ({
  id,
  slug: id,
  name: id,
  type: "http" as const,
  url: `https://example.com/${id}`,
  intervalMin: 1,
  createdAt: 0,
  updatedAt: 0,
  ...extra,
});

export const seedSnapshot = (
  lastTickAt: number,
  current: Record<string, unknown> = {},
  bars: Record<string, unknown> = {},
) =>
  db
    .insert(t.snapshot)
    .values({ id: 1, lastTickAt, current: JSON.stringify(current), bars: JSON.stringify(bars), lastRollupMinute: 0 });

const TABLES = [
  "monitors", "groups", "monitor_state", "events", "heartbeats", "daily_stats", "ticks", "snapshot", "settings",
] as const;

/** Row count of every table, to prove a request wrote nothing. */
export const rowCounts = async (): Promise<Record<string, number>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (name) => {
        const [row] = await db.all<{ n: number }>(sql.raw(`select count(*) as n from ${name}`));
        return [name, row!.n] as const;
      }),
    ),
  );
