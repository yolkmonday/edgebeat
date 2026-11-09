import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { heartbeats, monitors } from "@/db/schema";

export const COALESCE_MS = 30_000;
// newToken(): 128 random bits, base64url without padding
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{22}$/;

export const beat = new Hono<{ Bindings: Env }>();

beat.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const lookup = async (env: Env, token: string) => {
  // junk tokens never reach D1
  if (!TOKEN_SHAPE.test(token)) return undefined;
  const [m] = await getDb(env)
    .select({ id: monitors.id, paused: monitors.paused })
    .from(monitors)
    .where(and(eq(monitors.heartbeatToken, token), eq(monitors.type, "heartbeat")))
    .limit(1);
  return m;
};

const handleBeat = async (c: import("hono").Context<{ Bindings: Env }>) => {
  const m = await lookup(c.env, c.req.param("token") ?? "");
  if (!m) return c.json({ ok: false }, 404);
  if (m.paused) return c.json({ ok: true, paused: true });
  const now = Date.now();
  // single conditional statement: concurrent beats cannot double-write;
  // a recovery beat (after a reported failure) is never coalesced
  const res = await c.env.DB.prepare(
    `INSERT INTO heartbeats (monitor_id, last_beat_at) VALUES (?1, ?2)
     ON CONFLICT(monitor_id) DO UPDATE SET last_beat_at = excluded.last_beat_at
     WHERE heartbeats.last_beat_at IS NULL
        OR heartbeats.last_beat_at < excluded.last_beat_at - ?3
        OR heartbeats.last_fail_at > heartbeats.last_beat_at`,
  )
    .bind(m.id, now, COALESCE_MS)
    .run();
  return c.json({ ok: true, coalesced: res.meta.changes === 0 });
};

const handleFail = async (c: import("hono").Context<{ Bindings: Env }>) => {
  const m = await lookup(c.env, c.req.param("token") ?? "");
  if (!m) return c.json({ ok: false }, 404);
  if (m.paused) return c.json({ ok: true, paused: true });
  await c.env.DB.prepare(
    `INSERT INTO heartbeats (monitor_id, last_fail_at) VALUES (?1, ?2)
     ON CONFLICT(monitor_id) DO UPDATE SET last_fail_at = excluded.last_fail_at`,
  )
    .bind(m.id, Date.now())
    .run();
  return c.json({ ok: true });
};

beat.on(["GET", "POST"], "/:token", handleBeat);
beat.on(["GET", "POST"], "/:token/fail", handleFail);
