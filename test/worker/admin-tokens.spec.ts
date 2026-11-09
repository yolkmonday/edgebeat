import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { resetLoginLimiter } from "@/api/admin/auth";
import { hashToken } from "@/lib/api-tokens";
import type { ApiToken, ApiTokenCreated } from "@/shared/admin-api";

const db = getDb(env);
const BASE = "https://edgebeat.test";

const getCookie = async (): Promise<string> => {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ password: "test-password" }),
  });
  expect(res.status).toBe(204);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
};

type Auth = { cookie?: string; bearer?: string; origin?: string | null };
const call = (auth: Auth, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = {};
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
  if (method !== "GET" && auth.origin !== null) headers.origin = auth.origin ?? BASE;
  if (body !== undefined) headers["content-type"] = "application/json";
  return SELF.fetch(`${BASE}/api/admin${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

let cookie = "";

const mint = async (scope: "read" | "admin", name = "ci"): Promise<ApiTokenCreated> => {
  const res = await call({ cookie }, "POST", "/tokens", { name, scope });
  expect(res.status).toBe(201);
  return (await res.json()) as ApiTokenCreated;
};

const lastUsed = async (id: string) =>
  (await db.select().from(t.apiTokens).where(eq(t.apiTokens.id, id)))[0]?.lastUsedAt ?? null;

const until = async <T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> => {
  let v = await read();
  for (let i = 0; i < 50 && !done(v); i++) {
    await new Promise((r) => setTimeout(r, 20));
    v = await read();
  }
  return v;
};

beforeEach(async () => {
  resetLoginLimiter();
  await db.batch([
    db.delete(t.apiTokens),
    db.delete(t.monitorState),
    db.delete(t.heartbeats),
    db.delete(t.monitors),
  ]);
  cookie = await getCookie();
});

describe("token endpoints", () => {
  it("token plaintext shown once", async () => {
    const created = await mint("admin", "deploy");
    expect(created.token).toMatch(/^eb_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toBe(created.token.slice(0, 10));
    expect(created).toMatchObject({ name: "deploy", scope: "admin", lastUsedAt: null });
    expect(created).not.toHaveProperty("tokenHash");

    const list = await call({ cookie }, "GET", "/tokens");
    expect(list.status).toBe(200);
    const text = await list.text();
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(await hashToken(created.token));
    const items = JSON.parse(text) as (ApiToken & Record<string, unknown>)[];
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      id: created.id,
      name: "deploy",
      scope: "admin",
      prefix: created.token.slice(0, 10),
      createdAt: created.createdAt,
      lastUsedAt: null,
    });
  });

  it("stores only the hash", async () => {
    const created = await mint("read");
    const [row] = await db.select().from(t.apiTokens);
    expect(row!.tokenHash).toBe(await hashToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);
  });

  it("lists newest first", async () => {
    const a = await mint("read", "a");
    await new Promise((r) => setTimeout(r, 5));
    const b = await mint("read", "b");
    const items = (await (await call({ cookie }, "GET", "/tokens")).json()) as ApiToken[];
    expect(items.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("validates the create body", async () => {
    for (const body of [{}, { name: "", scope: "admin" }, { name: "x", scope: "root" }, { name: "x" }]) {
      const res = await call({ cookie }, "POST", "/tokens", body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("validation");
    }
  });

  it("refuses the 21st token", async () => {
    for (let i = 0; i < 20; i++) await mint("read", `t${i}`);
    const res = await call({ cookie }, "POST", "/tokens", { name: "one-too-many", scope: "read" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("too_many_tokens");
    expect(await db.select().from(t.apiTokens)).toHaveLength(20);
  });

  it("deletes a token; unknown id is 404", async () => {
    const created = await mint("read");
    expect((await call({ cookie }, "DELETE", `/tokens/${created.id}`)).status).toBe(204);
    expect((await call({ cookie }, "DELETE", `/tokens/${created.id}`)).status).toBe(404);
    expect(await db.select().from(t.apiTokens)).toHaveLength(0);
  });

  it("cookie token management still requires the Origin header", async () => {
    const res = await call({ cookie, origin: "https://evil.test" }, "POST", "/tokens", { name: "x", scope: "admin" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("forbidden_origin");
    expect(await db.select().from(t.apiTokens)).toHaveLength(0);
  });
});

describe("bearer auth", () => {
  it("admin token lists and creates monitors without an Origin header", async () => {
    const { token } = await mint("admin");
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    const res = await call({ bearer: token, origin: null }, "POST", "/monitors", {
      name: "Site",
      slug: "site",
      type: "http",
      url: "https://example.com",
    });
    expect(res.status).toBe(201);
  });

  it("read token cannot mutate", async () => {
    const { token } = await mint("read");
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    const res = await call({ bearer: token, origin: null }, "POST", "/monitors", {
      name: "Site",
      slug: "site",
      type: "http",
      url: "https://example.com",
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("insufficient_scope");
    expect((await call({ bearer: token }, "DELETE", "/monitors/x")).status).toBe(403);
    expect((await call({ bearer: token }, "PATCH", "/settings", { siteName: "x" })).status).toBe(403);
    expect((await call({ bearer: token }, "POST", "/import", {})).status).toBe(403);
    expect(await db.select().from(t.monitors)).toHaveLength(0);
  });

  it("bearer cannot manage tokens", async () => {
    for (const scope of ["admin", "read"] as const) {
      const { token } = await mint(scope, `b-${scope}`);
      for (const [method, path, body] of [
        ["GET", "/tokens", undefined],
        ["POST", "/tokens", { name: "child", scope: "admin" }],
        ["DELETE", "/tokens/whatever", undefined],
      ] as const) {
        const res = await call({ bearer: token, origin: null }, method, path, body);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { error: string }).error).toBe("session_required");
      }
    }
    expect(await db.select().from(t.apiTokens)).toHaveLength(2);
  });

  it("a revoked token is rejected", async () => {
    const { token, id } = await mint("admin");
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    expect((await call({ cookie }, "DELETE", `/tokens/${id}`)).status).toBe(204);
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(401);
  });

  it("garbage Bearer is 401 even with a valid cookie", async () => {
    for (const bearer of ["garbage", "eb_short", `eb_${"A".repeat(43)}`]) {
      const res = await call({ cookie, bearer }, "GET", "/monitors");
      expect(res.status).toBe(401);
    }
    const res = await SELF.fetch(`${BASE}/api/admin/monitors`, {
      headers: { cookie, authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
  });

  it("requests without any credentials are 401", async () => {
    expect((await call({}, "GET", "/monitors")).status).toBe(401);
  });

  it("lastUsedAt is set on first use and throttled to once per 10 minutes", async () => {
    const { token, id } = await mint("read");
    expect(await lastUsed(id)).toBeNull();

    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    const first = await until(() => lastUsed(id), (v) => v !== null);
    expect(first).not.toBeNull();

    // second use right away: untouched
    const recent = first! - 60_000;
    await db.update(t.apiTokens).set({ lastUsedAt: recent }).where(eq(t.apiTokens.id, id));
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(await lastUsed(id)).toBe(recent);

    // older than 10 minutes: refreshed
    const old = Date.now() - 11 * 60_000;
    await db.update(t.apiTokens).set({ lastUsedAt: old }).where(eq(t.apiTokens.id, id));
    expect((await call({ bearer: token }, "GET", "/monitors")).status).toBe(200);
    const refreshed = await until(() => lastUsed(id), (v) => v !== old);
    expect(refreshed!).toBeGreaterThan(old);
  });

  it("cookie sessions keep working alongside tokens", async () => {
    expect((await call({ cookie }, "GET", "/monitors")).status).toBe(200);
  });
});
