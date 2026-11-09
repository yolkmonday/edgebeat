import { Hono, type Context } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { groups, monitors, settings } from "@/db/schema";
import { parseStored } from "@/api/admin/settings";
import type { Session } from "@/shared/admin-api";
import { VERSION } from "@/version";
import { sql } from "drizzle-orm";

export const sessionApi = new Hono<{ Bindings: Env }>();

const INSTALL_SOURCES = ["cli", "cloud", "git"] as const;

type AuthInfo = { kind?: string; scope?: string };

/** requireAdmin may set `auth`; without it the request came in through the cookie. */
const authOf = (c: Context): Pick<Session, "auth" | "scope"> => {
  const info = (c as unknown as { get: (k: string) => unknown }).get("auth") as AuthInfo | undefined;
  return {
    auth: info?.kind === undefined || info.kind === "cookie" ? "cookie" : "token",
    scope: info?.scope === "read" ? "read" : "admin",
  };
};

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
    installSource: INSTALL_SOURCES.find((s) => s === c.env.EDGEBEAT_INSTALL_SOURCE) ?? null,
    siteName: stored.siteName,
    plan: stored.plan,
    ...authOf(c),
    analytics: Boolean(c.env.CF_ACCOUNT_ID && c.env.CF_API_TOKEN),
    counts: { monitors: counts?.checks ?? 0, heartbeats: counts?.heartbeats ?? 0, groups: groupCount?.n ?? 0 },
  };
  return c.json(body);
});
