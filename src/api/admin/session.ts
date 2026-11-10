import { Hono } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { groups, monitors, settings } from "@/db/schema";
import { parseStored } from "@/api/admin/settings";
import type { Session } from "@/shared/admin-api";
import { VERSION } from "@/version";
import { sql } from "drizzle-orm";

export const sessionApi = new Hono<{ Bindings: Env }>();

const INSTALL_SOURCES = ["cli", "cloud", "git"] as const;


sessionApi.get("/", async (c) => {
  const db = getDb(c.env);
  const [settingRows, [counts], [groupCount]] = await db.batch([
    db.select().from(settings),
    db
      .select({
        checks: sql<number>`coalesce(sum(case when ${monitors.type} != 'heartbeat' then 1 else 0 end), 0)`,
        heartbeats: sql<number>`coalesce(sum(case when ${monitors.type} = 'heartbeat' then 1 else 0 end), 0)`,
      })
      .from(monitors),
    db.select({ n: sql<number>`count(*)` }).from(groups),
  ]);
  const stored = parseStored(settingRows);
  const body: Session = {
    version: VERSION,
    installSource: INSTALL_SOURCES.find((s) => s === c.env.UPFLARE_INSTALL_SOURCE) ?? null,
    siteName: stored.siteName,
    plan: stored.plan,
    auth: c.get("auth").kind,
    scope: c.get("auth").scope,
    analytics: Boolean(c.env.CF_ACCOUNT_ID && c.env.CF_API_TOKEN),
    counts: { monitors: counts?.checks ?? 0, heartbeats: counts?.heartbeats ?? 0, groups: groupCount?.n ?? 0 },
  };
  return c.json(body);
});
