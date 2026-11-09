import { SELF, createExecutionContext, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import worker from "@/index";

const db = getDb(env);
const BASE = "https://edgebeat.test";
// tokens are 128-bit base64url: 22 chars
const TOK = "abcdefghijklmnopqrstu_";
const UNKNOWN = "zzzzzzzzzzzzzzzzzzzzz-";

const seed = async (extra: Partial<typeof t.monitors.$inferInsert> = {}, hb = true) => {
  await db.insert(t.monitors).values({
    id: "m1",
    slug: "m1",
    name: "m1",
    type: "heartbeat",
    heartbeatToken: TOK,
    intervalMin: 5,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  });
  if (hb) await db.insert(t.heartbeats).values({ monitorId: "m1" });
};
const row = async () => (await db.select().from(t.heartbeats).where(eq(t.heartbeats.monitorId, "m1")))[0];
const setBeat = (lastBeatAt: number) =>
  db.update(t.heartbeats).set({ lastBeatAt }).where(eq(t.heartbeats.monitorId, "m1"));

beforeEach(async () => {
  await db.batch([db.delete(t.heartbeats), db.delete(t.monitors)]);
});

describe("beat ingest", () => {
  it("unknown token: 404, no write", async () => {
    await seed();
    const res = await SELF.fetch(`${BASE}/beat/${UNKNOWN}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await db.select().from(t.heartbeats)).toEqual([{ monitorId: "m1", lastBeatAt: null, lastFailAt: null }]);
  });

  it("malformed token: 404 before any D1 access", async () => {
    const noDb = new Proxy({}, {
      get: () => {
        throw new Error("D1 touched");
      },
    });
    for (const path of ["/beat/nope", "/beat/nope/fail", `/beat/${TOK}x`, `/beat/${TOK.slice(1)}=`]) {
      const res = await worker.fetch(new Request(`${BASE}${path}`), { ...env, DB: noDb } as typeof env, createExecutionContext());
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false });
    }
  });

  it("first beat writes", async () => {
    await seed();
    const before = Date.now();
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, coalesced: false });
    expect((await row())!.lastBeatAt).toBeGreaterThanOrEqual(before);
  });

  it("POST accepted; body ignored", async () => {
    await seed();
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`, { method: "POST", body: "junk" });
    expect(await res.json()).toEqual({ ok: true, coalesced: false });
  });

  it("beat 5s later is coalesced, unchanged", async () => {
    await seed();
    const stored = Date.now() - 5_000;
    await setBeat(stored);
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(await res.json()).toEqual({ ok: true, coalesced: true });
    expect((await row())!.lastBeatAt).toBe(stored);
  });

  it("beat 31s later writes", async () => {
    await seed();
    const stored = Date.now() - 31_000;
    await setBeat(stored);
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(await res.json()).toEqual({ ok: true, coalesced: false });
    expect((await row())!.lastBeatAt).toBeGreaterThan(stored);
  });

  it("a success beat after a reported failure is never coalesced", async () => {
    await seed();
    const stored = Date.now() - 5_000;
    await db.update(t.heartbeats).set({ lastBeatAt: stored, lastFailAt: stored + 1_000 }).where(eq(t.heartbeats.monitorId, "m1"));
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(await res.json()).toEqual({ ok: true, coalesced: false });
    expect((await row())!.lastBeatAt).toBeGreaterThan(stored + 1_000);
  });

  it("missing heartbeats row is upserted", async () => {
    await seed({}, false);
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(await res.json()).toEqual({ ok: true, coalesced: false });
    expect((await row())!.lastBeatAt).not.toBeNull();
  });

  it("paused: 200 paused, no write", async () => {
    await seed({ paused: 1 });
    const res = await SELF.fetch(`${BASE}/beat/${TOK}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paused: true });
    expect((await row())!.lastBeatAt).toBeNull();
  });

  it("non-heartbeat monitor token is unknown", async () => {
    await seed({ type: "http", url: "https://x.test" });
    expect((await SELF.fetch(`${BASE}/beat/${TOK}`)).status).toBe(404);
  });
});

describe("fail ingest", () => {
  it("sets lastFailAt every time, not coalesced", async () => {
    await seed();
    const r1 = await SELF.fetch(`${BASE}/beat/${TOK}/fail`);
    expect(r1.status).toBe(200);
    const first = (await row())!.lastFailAt!;
    expect(first).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 5));
    await SELF.fetch(`${BASE}/beat/${TOK}/fail`, { method: "POST" });
    expect((await row())!.lastFailAt!).toBeGreaterThan(first);
  });

  it("unknown token 404, paused no write", async () => {
    await seed({ paused: 1 });
    expect((await SELF.fetch(`${BASE}/beat/${UNKNOWN}/fail`)).status).toBe(404);
    const res = await SELF.fetch(`${BASE}/beat/${TOK}/fail`);
    expect(await res.json()).toEqual({ ok: true, paused: true });
    expect((await row())!.lastFailAt).toBeNull();
  });
});
