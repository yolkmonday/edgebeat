import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { groups, monitors, settings, snapshot } from "@/db/schema";
import { buildPublicStatus } from "@/core/public-status";
import type { Bar } from "@/core/stats";
import type { CurrentEntry } from "@/core/types";
import { isRecord, parseJson } from "@/tick/batch";

export const publicApi = new Hono<{ Bindings: Env }>();

const CACHE_CONTROL = "public, max-age=15, s-maxage=30";

const readSiteName = (value: string | undefined): string => {
  if (value === undefined) return "Status";
  try {
    const v: unknown = JSON.parse(value);
    return typeof v === "string" && v !== "" ? v : "Status";
  } catch {
    return "Status";
  }
};

const build = async (env: Env, now: number) => {
  const db = getDb(env);
  const [siteRows, groupRows, monitorRows, snapRows] = await db.batch([
    db.select().from(settings).where(eq(settings.key, "siteName")),
    db.select().from(groups),
    db.select().from(monitors).where(eq(monitors.isPublic, 1)),
    db.select().from(snapshot).where(eq(snapshot.id, 1)),
  ]);
  const snap = snapRows[0];
  const slugById = new Map(groupRows.map((g) => [g.id, g.slug]));
  return buildPublicStatus({
    now,
    siteName: readSiteName(siteRows[0]?.value),
    lastTickAt: snap ? snap.lastTickAt : null,
    groups: groupRows.map((g) => ({ slug: g.slug, name: g.name, sort: g.sort })),
    monitors: monitorRows.map((m) => ({
      id: m.id,
      slug: m.slug,
      name: m.name,
      groupSlug: m.groupId ? (slugById.get(m.groupId) ?? null) : null,
      intervalMin: m.intervalMin,
      isPublic: m.isPublic === 1,
      paused: m.paused === 1,
      sort: m.sort,
    })),
    current: parseJson<Record<string, CurrentEntry>>(snap?.current ?? "{}", {}, isRecord),
    bars: parseJson<Record<string, Bar[]>>(snap?.bars ?? "{}", {}, isRecord),
  });
};

publicApi.get("/status", async (c) => {
  const cache = caches.default;
  const key = new Request(c.req.url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit;

  const body = await build(c.env, Date.now());
  const res = new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", "Cache-Control": CACHE_CONTROL },
  });
  c.executionCtx.waitUntil(cache.put(key, res.clone()));
  return res;
});
