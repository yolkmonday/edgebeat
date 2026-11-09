import { SELF, createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { resetLoginLimiter } from "@/api/admin/auth";
import { jwtKey } from "@/lib/keys";
import worker from "@/index";

const db = getDb(env);
const BASE = "https://edgebeat.test";
const ORIGIN = BASE;

const login = (password: string) =>
  SELF.fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ password }),
  });

const getCookie = async (): Promise<string> => {
  const res = await login("test-password");
  expect(res.status).toBe(204);
  const sc = res.headers.get("set-cookie") ?? "";
  return sc.split(";")[0]!;
};

const call = (
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  SELF.fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== "GET" ? { origin: ORIGIN } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const httpMonitor = (extra: Record<string, unknown> = {}) => ({
  name: "Site",
  slug: "site",
  type: "http",
  url: "https://example.com",
  intervalMin: 5,
  ...extra,
});

let cookie = "";

beforeEach(async () => {
  resetLoginLimiter();
  await db.batch([
    db.delete(t.monitorState),
    db.delete(t.heartbeats),
    db.delete(t.events),
    db.delete(t.dailyStats),
    db.delete(t.monitors),
    db.delete(t.groups),
    db.delete(t.settings),
  ]);
  cookie = await getCookie();
});

const b64url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const signJwt = async (header: object, payload: object) => {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", await jwtKey(env), new TextEncoder().encode(data)),
  );
  return `${data}.${b64url(String.fromCharCode(...sig))}`;
};

describe("auth", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await call(null, "GET", "/monitors");
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("login sets a hardened cookie and the cookie works", async () => {
    const res = await login("test-password");
    expect(res.status).toBe(204);
    const sc = res.headers.get("set-cookie")!;
    expect(sc).toMatch(/^eb_session=[\w-]+\.[\w-]+\.[\w-]+/);
    expect(sc).toContain("HttpOnly");
    expect(sc).toContain("Secure");
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).toContain("Path=/");
    expect(sc).toContain("Max-Age=43200");
    const list = await call(sc.split(";")[0]!, "GET", "/monitors");
    expect(list.status).toBe(200);
  });

  it("wrong password gives 401 after a delay", async () => {
    const start = Date.now();
    const res = await login("nope");
    expect(res.status).toBe(401);
    expect(Date.now() - start).toBeGreaterThanOrEqual(450);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rate limits after 10 failures", async () => {
    for (let i = 0; i < 10; i++) expect((await login("bad")).status).toBe(401);
    expect((await login("bad")).status).toBe(429);
    // check happens before compare: even the right password is refused
    expect((await login("test-password")).status).toBe(429);
  }, 20_000);

  it("login is 500 without a usable ENCRYPTION_KEY and 401 with empty ADMIN_PASSWORD", async () => {
    const run = (e: Record<string, unknown>, password: string) =>
      worker.fetch(
        new Request(`${BASE}/api/admin/login`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        }),
        { ...env, ...e } as typeof env,
        createExecutionContext(),
      );
    for (const key of ["", "c2hvcnQ=", "!!!not-base64"]) {
      const res = await run({ ENCRYPTION_KEY: key }, "test-password");
      expect(res.status).toBe(500);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await run({ ADMIN_PASSWORD: "" }, "")).status).toBe(401);
  });

  it("concurrent bad logins cannot bypass the rate limit", async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, async () => {
        const start = Date.now();
        const res = await login("bad");
        return { status: res.status, ms: Date.now() - start };
      }),
    );
    const limited = results.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThanOrEqual(10);
    expect(results.filter((r) => r.status === 401).length).toBeLessThanOrEqual(10);
    for (const r of limited) expect(r.ms).toBeLessThan(450);
  }, 20_000);

  it("logout clears the cookie", async () => {
    const res = await call(cookie, "POST", "/logout");
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects malformed, tampered, expired, wrong-alg and wrong-sub tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const good = await signJwt({ alg: "HS256", typ: "JWT" }, { sub: "admin", exp: now + 60 });
    expect((await call(`eb_session=${good}`, "GET", "/monitors")).status).toBe(200);
    const bad = [
      "garbage",
      "a.b",
      "a.b.c",
      "..",
      good.slice(0, -2) + "xx",
      await signJwt({ alg: "HS256", typ: "JWT" }, { sub: "admin", exp: now - 1 }),
      await signJwt({ alg: "HS256", typ: "JWT" }, { sub: "admin" }),
      await signJwt({ alg: "HS256", typ: "JWT" }, { sub: "other", exp: now + 60 }),
      await signJwt({ alg: "none", typ: "JWT" }, { sub: "admin", exp: now + 60 }),
      await signJwt({ alg: "HS512", typ: "JWT" }, { sub: "admin", exp: now + 60 }),
    ];
    for (const tok of bad) {
      expect((await call(`eb_session=${tok}`, "GET", "/monitors")).status).toBe(401);
    }
  });

  it("rejects foreign or missing Origin on writes", async () => {
    const foreign = await call(cookie, "POST", "/monitors", httpMonitor(), {
      origin: "https://evil.example",
    });
    expect(foreign.status).toBe(403);
    const missing = await SELF.fetch(`${BASE}/api/admin/monitors`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(httpMonitor()),
    });
    expect(missing.status).toBe(403);
    expect((await db.select().from(t.monitors)).length).toBe(0);
  });
});

describe("monitors", () => {
  it("validates input", async () => {
    const bad = async (extra: Record<string, unknown>) => {
      const res = await call(cookie, "POST", "/monitors", httpMonitor(extra));
      return res.status;
    };
    expect(await bad({ url: "http://10.0.0.1" })).toBe(400);
    expect(await bad({ intervalMin: 4 })).toBe(400);
    expect(await bad({ timeoutMs: 30_001 })).toBe(400);
    expect(await bad({ confirmations: 0 })).toBe(400);
    expect(await bad({ confirmations: 11 })).toBe(400);
    expect(await bad({ slug: "Bad Slug" })).toBe(400);
    expect(await bad({ url: undefined })).toBe(400);
    const res = await call(cookie, "POST", "/monitors", httpMonitor({ intervalMin: 4 }));
    const body = (await res.json()) as { error: string; issues: unknown };
    expect(body.error).toBe("validation");
    expect(body.issues).toBeTruthy();
    const ssrf = await call(cookie, "POST", "/monitors", httpMonitor({ url: "http://127.0.0.1" }));
    expect(((await ssrf.json()) as { error: string }).error).toBe("invalid_url");
    const tcp = await call(cookie, "POST", "/monitors", {
      name: "t", slug: "t", type: "tcp", host: "example.com", intervalMin: 5,
    });
    expect(tcp.status).toBe(400);
    const hb = await call(cookie, "POST", "/monitors", {
      name: "h", slug: "h", type: "heartbeat", intervalMin: 5, heartbeatPeriodS: 30, heartbeatGraceS: 0,
    });
    expect(hb.status).toBe(400);
  });

  it("creates, reads, lists, patches, 409s and 404s", async () => {
    const res = await call(cookie, "POST", "/monitors", httpMonitor({ headers: { "X-A": "1" } }));
    expect(res.status).toBe(201);
    const m = (await res.json()) as Record<string, unknown>;
    expect(typeof m.id).toBe("string");
    expect(m.headers).toEqual({ "X-A": "1" });
    expect(m.isPublic).toBe(true);
    expect(m.paused).toBe(false);
    expect(m.followRedirects).toBe(false);
    expect(m).not.toHaveProperty("heartbeatToken");

    expect((await call(cookie, "POST", "/monitors", httpMonitor())).status).toBe(409);

    const list = (await (await call(cookie, "GET", "/monitors")).json()) as unknown[];
    expect(list.length).toBe(1);
    expect((await call(cookie, "GET", `/monitors/${m.id}`)).status).toBe(200);
    expect((await call(cookie, "GET", "/monitors/nope")).status).toBe(404);

    const patched = await call(cookie, "PATCH", `/monitors/${m.id}`, { name: "Renamed", paused: true });
    expect(patched.status).toBe(200);
    const pj = (await patched.json()) as Record<string, unknown>;
    expect(pj.name).toBe("Renamed");
    expect(pj.paused).toBe(true);
    expect(pj.url).toBe("https://example.com");

    // merged record is revalidated, including the SSRF guard
    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { url: "http://192.168.1.1" })).status).toBe(400);
    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { intervalMin: 7 })).status).toBe(400);
    // type immutable
    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { type: "tcp" })).status).toBe(400);
    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { type: "http" })).status).toBe(200);
    expect((await call(cookie, "PATCH", "/monitors/nope", { name: "x" })).status).toBe(404);
    expect((await call(cookie, "DELETE", "/monitors/nope")).status).toBe(404);
  });

  it("followRedirects defaults to false, true when a keyword is set, explicit value wins", async () => {
    const create = async (extra: Record<string, unknown>) =>
      ((await (await call(cookie, "POST", "/monitors", httpMonitor(extra))).json()) as { followRedirects: boolean })
        .followRedirects;
    expect(await create({ slug: "a" })).toBe(false);
    expect(await create({ slug: "b", keyword: "ok" })).toBe(true);
    expect(await create({ slug: "c", keyword: "ok", followRedirects: false })).toBe(false);
    expect(await create({ slug: "d", followRedirects: true })).toBe(true);
  });

  it("rejects configs that can never pass", async () => {
    const status = async (body: Record<string, unknown>) => (await call(cookie, "POST", "/monitors", body)).status;
    expect(await status(httpMonitor({ body: "x" }))).toBe(400);
    expect(await status(httpMonitor({ method: "HEAD", body: "x" }))).toBe(400);
    expect(await status(httpMonitor({ headers: { "bad name": "x" } }))).toBe(400);
    expect(await status(httpMonitor({ headers: { "X-A": "line\nbreak" } }))).toBe(400);
    expect(await status(httpMonitor({ method: "HEAD", keyword: "ok" }))).toBe(400);
    expect(await status({ name: "t", slug: "t", type: "tcp", host: "mail.example.com", port: 25 })).toBe(400);
    expect(await status(httpMonitor({ method: "POST", body: "x", headers: { "X-A": "1" } }))).toBe(201);
    // merged record is revalidated: switching an existing keyword monitor to HEAD fails
    const m = (await (await call(cookie, "POST", "/monitors", httpMonitor({ slug: "k", keyword: "ok" }))).json()) as { id: string };
    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { method: "HEAD" })).status).toBe(400);
  });

  it("pause and unpause write the state lifecycle; heartbeat unpause clears beats", async () => {
    const m = (await (await call(cookie, "POST", "/monitors", httpMonitor())).json()) as { id: string };
    await db.insert(t.monitorState).values({ monitorId: m.id, state: "down", consecutiveFailures: 2, lastChangeAt: 1 });
    await db.delete(t.snapshot);
    await db.insert(t.snapshot).values({
      id: 1,
      lastTickAt: 0,
      current: JSON.stringify({ [m.id]: { state: "down", lastCheckedAt: 1, latencyMs: null }, other: { state: "up", lastCheckedAt: 1, latencyMs: 1 } }),
      bars: "{}",
    });
    const stateOf = async () => (await db.select().from(t.monitorState).where(eq(t.monitorState.monitorId, m.id)))[0];
    const eventsOf = async () =>
      (await db.select().from(t.events).where(eq(t.events.monitorId, m.id)).orderBy(t.events.id)).map((e) => [
        e.fromState,
        e.toState,
        e.reason,
      ]);

    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { paused: true })).status).toBe(200);
    expect(await stateOf()).toMatchObject({ state: "paused", consecutiveFailures: 0 });
    expect(await eventsOf()).toEqual([["down", "paused", "paused"]]);

    // no flip, no lifecycle writes
    await call(cookie, "PATCH", `/monitors/${m.id}`, { paused: true, name: "Again" });
    expect(await eventsOf()).toHaveLength(1);

    expect((await call(cookie, "PATCH", `/monitors/${m.id}`, { paused: false })).status).toBe(200);
    expect(await stateOf()).toMatchObject({ state: "pending", consecutiveFailures: 0 });
    expect(await eventsOf()).toEqual([
      ["down", "paused", "paused"],
      ["paused", "pending", "unpaused"],
    ]);
    // the stale pre-pause entry is gone from the public snapshot; others untouched
    const [snap] = await db.select().from(t.snapshot);
    expect(Object.keys(JSON.parse(snap!.current) as object)).toEqual(["other"]);
    await db.delete(t.snapshot);

    const hb = (await (await call(cookie, "POST", "/monitors", {
      name: "Cron", slug: "cron", type: "heartbeat", intervalMin: 5, heartbeatPeriodS: 300, heartbeatGraceS: 0, paused: true,
    })).json()) as { id: string };
    await db.update(t.heartbeats).set({ lastBeatAt: 5, lastFailAt: 6 }).where(eq(t.heartbeats.monitorId, hb.id));
    await call(cookie, "PATCH", `/monitors/${hb.id}`, { paused: false });
    expect((await db.select().from(t.heartbeats).where(eq(t.heartbeats.monitorId, hb.id)))[0]).toMatchObject({
      lastBeatAt: null,
      lastFailAt: null,
    });
  });

  it("patch slug conflict gives 409", async () => {
    await call(cookie, "POST", "/monitors", httpMonitor());
    const b = (await (await call(cookie, "POST", "/monitors", httpMonitor({ slug: "other" }))).json()) as { id: string };
    expect((await call(cookie, "PATCH", `/monitors/${b.id}`, { slug: "site" })).status).toBe(409);
  });

  it("heartbeat create returns beatUrl, rotate-token invalidates the old token", async () => {
    const res = await call(cookie, "POST", "/monitors", {
      name: "Cron", slug: "cron", type: "heartbeat", intervalMin: 5, heartbeatPeriodS: 300, heartbeatGraceS: 60,
    });
    expect(res.status).toBe(201);
    const m = (await res.json()) as { id: string; beatUrl: string };
    expect(m.beatUrl).toMatch(new RegExp(`^${BASE}/beat/[A-Za-z0-9_-]{22}$`));
    const oldToken = m.beatUrl.split("/").pop()!;
    expect((await db.select().from(t.heartbeats).where(eq(t.heartbeats.monitorId, m.id))).length).toBe(1);
    expect((await SELF.fetch(m.beatUrl)).status).toBe(200);

    const list = (await (await call(cookie, "GET", "/monitors")).json()) as { beatUrl?: string }[];
    expect(list[0]!.beatUrl).toBe(m.beatUrl);

    const rot = await call(cookie, "POST", `/monitors/${m.id}/rotate-token`);
    expect(rot.status).toBe(200);
    const r = (await rot.json()) as { beatUrl: string };
    expect(r.beatUrl).not.toBe(m.beatUrl);
    expect((await SELF.fetch(`${BASE}/beat/${oldToken}`)).status).toBe(404);
    expect((await SELF.fetch(r.beatUrl)).status).toBe(200);
  });

  it("rotate-token on a non-heartbeat monitor is 400", async () => {
    const m = (await (await call(cookie, "POST", "/monitors", httpMonitor())).json()) as { id: string };
    expect((await call(cookie, "POST", `/monitors/${m.id}/rotate-token`)).status).toBe(400);
    expect((await call(cookie, "POST", `/monitors/nope/rotate-token`)).status).toBe(404);
  });

  it("delete cascades monitor_state, heartbeats, events, daily_stats", async () => {
    const m = (await (await call(cookie, "POST", "/monitors", {
      name: "Cron", slug: "cron", type: "heartbeat", intervalMin: 5, heartbeatPeriodS: 300, heartbeatGraceS: 0,
    })).json()) as { id: string };
    await db.batch([
      db.insert(t.monitorState).values({ monitorId: m.id, state: "up", consecutiveFailures: 0, lastChangeAt: 0 }),
      db.insert(t.events).values({ monitorId: m.id, fromState: "pending", toState: "up", at: 0, reason: "x" }),
      db.insert(t.dailyStats).values({ monitorId: m.id, day: "2026-01-01" }),
    ]);
    expect((await call(cookie, "DELETE", `/monitors/${m.id}`)).status).toBe(204);
    expect(await db.select().from(t.monitors)).toHaveLength(0);
    expect(await db.select().from(t.monitorState)).toHaveLength(0);
    expect(await db.select().from(t.heartbeats)).toHaveLength(0);
    expect(await db.select().from(t.events)).toHaveLength(0);
    expect(await db.select().from(t.dailyStats)).toHaveLength(0);
  });
});

describe("groups", () => {
  it("creates, lists, patches, validates and deletes (ungrouping members)", async () => {
    expect((await call(cookie, "POST", "/groups", { slug: "Bad", name: "x" })).status).toBe(400);
    const res = await call(cookie, "POST", "/groups", { slug: "core", name: "Core", sort: 2 });
    expect(res.status).toBe(201);
    const g = (await res.json()) as { id: string; slug: string; sort: number };
    expect(g.sort).toBe(2);
    expect((await call(cookie, "POST", "/groups", { slug: "core", name: "Dup" })).status).toBe(409);
    expect(((await (await call(cookie, "GET", "/groups")).json()) as unknown[]).length).toBe(1);

    const p = await call(cookie, "PATCH", `/groups/${g.id}`, { name: "Core 2" });
    expect(((await p.json()) as { name: string }).name).toBe("Core 2");
    expect((await call(cookie, "PATCH", "/groups/nope", { name: "x" })).status).toBe(404);

    const m = (await (await call(cookie, "POST", "/monitors", httpMonitor({ groupId: g.id }))).json()) as { id: string };
    expect((await call(cookie, "POST", "/monitors", httpMonitor({ slug: "z", groupId: "missing" }))).status).toBe(400);
    expect((await call(cookie, "DELETE", `/groups/${g.id}`)).status).toBe(204);
    const after = (await db.select().from(t.monitors).where(eq(t.monitors.id, m.id)))[0]!;
    expect(after.groupId).toBeNull();
    expect(await db.select().from(t.groups)).toHaveLength(0);
    expect((await call(cookie, "DELETE", `/groups/${g.id}`)).status).toBe(404);
  });
});

describe("settings", () => {
  it("returns defaults, patches and persists JSON-encoded values", async () => {
    const d = (await (await call(cookie, "GET", "/settings")).json()) as Record<string, unknown>;
    expect(d).toEqual({ siteName: "Status", plan: "free", checkBudget: null });

    const res = await call(cookie, "PATCH", "/settings", { plan: "paid", siteName: "  My Site  ", checkBudget: 200 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ siteName: "My Site", plan: "paid", checkBudget: 200 });
    const rows = await db.select().from(t.settings);
    const map = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
    expect(map).toEqual({ siteName: "My Site", plan: "paid", checkBudget: 200 });

    const cleared = await call(cookie, "PATCH", "/settings", { checkBudget: null });
    expect(((await cleared.json()) as { checkBudget: unknown }).checkBudget).toBeNull();
    expect(((await (await call(cookie, "GET", "/settings")).json()) as { plan: string }).plan).toBe("paid");

    for (const bad of [{ plan: "gold" }, { checkBudget: 0 }, { checkBudget: 10_001 }, { siteName: "  " }, { siteName: "x".repeat(81) }]) {
      expect((await call(cookie, "PATCH", "/settings", bad)).status).toBe(400);
    }
  });
});
