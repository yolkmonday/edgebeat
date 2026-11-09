import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { apiTokens } from "@/db/schema";
import { hashToken, looksLikeToken } from "@/lib/api-tokens";
import { jwtKey } from "@/lib/keys";
import { and, eq, isNull, lt, or } from "drizzle-orm";

const COOKIE = "eb_session";
const SESSION_S = 12 * 60 * 60;
const FAIL_DELAY_MS = 500;
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MIN_PASSWORD_LENGTH = 12;
const PLACEHOLDER_PASSWORD = "change-me"; // .dev.vars.example

const weakPassword = (p: string | undefined): boolean =>
  p === undefined || p === PLACEHOLDER_PASSWORD || p.length < MIN_PASSWORD_LENGTH;

type AppEnv = { Bindings: Env };

export type AuthInfo = { kind: "cookie" | "token"; scope: "admin" | "read"; tokenId?: string };

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthInfo;
  }
}

const LAST_USED_THROTTLE_MS = 10 * 60_000;
const BEARER_RE = /^Bearer\s+(\S+)$/i;
const READ_METHODS = new Set(["GET", "HEAD"]);
const TOKENS_PATH = /^\/api\/admin\/tokens(\/|$)/;

const enc = new TextEncoder();

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const std = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(std + "=".repeat((4 - (std.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};

const signSession = async (env: Env, nowS: number): Promise<string> => {
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ sub: "admin", exp: nowS + SESSION_S })));
  const sig = await crypto.subtle.sign("HMAC", await jwtKey(env), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
};

const parseJsonPart = (part: string): Record<string, unknown> | null => {
  const bytes = fromB64url(part);
  if (!bytes) return null;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Never throws: any malformed or invalid token yields false. */
const verifySession = async (env: Env, token: string, nowS: number): Promise<boolean> => {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [h, p, s] = parts as [string, string, string];
    const header = parseJsonPart(h);
    const payload = parseJsonPart(p);
    const sig = fromB64url(s);
    if (!header || !payload || !sig || header.alg !== "HS256") return false;
    const ok = await crypto.subtle.verify("HMAC", await jwtKey(env), sig, enc.encode(`${h}.${p}`));
    if (!ok) return false;
    return payload.sub === "admin" && typeof payload.exp === "number" && payload.exp > nowS;
  } catch {
    return false;
  }
};

// per-isolate fixed-window failure counter; best effort, resets on isolate recycle
const limiter = { start: 0, count: 0 };
export const resetLoginLimiter = (): void => {
  limiter.start = 0;
  limiter.count = 0;
};
// reserve an attempt slot synchronously (before any await) so concurrent requests cannot all pass the check
const reserveSlot = (now: number): boolean => {
  if (now - limiter.start >= WINDOW_MS) {
    limiter.start = now;
    limiter.count = 0;
  }
  if (limiter.count >= MAX_FAILURES) return false;
  limiter.count += 1;
  return true;
};
const releaseSlot = (): void => {
  limiter.count = Math.max(0, limiter.count - 1);
};

const passwordMatches = async (given: string, expected: string): Promise<boolean> => {
  if (expected === "") return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  // timingSafeEqual is a workerd extension missing from the lib typings
  return (crypto.subtle as unknown as TimingSafe).timingSafeEqual(a, b);
};

type TimingSafe = { timingSafeEqual: (a: ArrayBuffer, b: ArrayBuffer) => boolean };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type TokenRow = { id: string; scope: "read" | "admin"; tokenHash: string };

/** Looks a bearer token up by its hash; the stored hash is compared in constant time as well. */
const findToken = async (env: Env, token: string): Promise<TokenRow | null> => {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token);
  const [row] = await getDb(env)
    .select({ id: apiTokens.id, scope: apiTokens.scope, tokenHash: apiTokens.tokenHash })
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hash))
    .limit(1);
  if (!row) return null;
  const same = (crypto.subtle as unknown as TimingSafe).timingSafeEqual(enc.encode(row.tokenHash).buffer, enc.encode(hash).buffer);
  return same ? row : null;
};

const touchToken = (c: Parameters<MiddlewareHandler<AppEnv>>[0], id: string, now: number): void => {
  const write = getDb(c.env)
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(and(eq(apiTokens.id, id), or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, now - LAST_USED_THROTTLE_MS))))
    .then(
      () => undefined,
      () => undefined,
    );
  try {
    c.executionCtx.waitUntil(write);
  } catch {
    // no execution context (unit-style invocation): the write still runs, just unobserved
  }
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === "/api/admin/login") return next();

  const authorization = c.req.header("authorization");
  if (authorization !== undefined) {
    // a Bearer header wins over the cookie: malformed or unknown tokens never fall back to the session
    const match = BEARER_RE.exec(authorization);
    const row = match ? await findToken(c.env, match[1]!) : null;
    if (!row) return c.json({ error: "unauthorized" }, 401);
    if (TOKENS_PATH.test(c.req.path)) return c.json({ error: "session_required" }, 403);
    if (row.scope === "read" && !READ_METHODS.has(c.req.method)) {
      return c.json({ error: "insufficient_scope" }, 403);
    }
    // Bearer is exempt from the Origin check: it is never attached ambiently by a browser
    c.set("auth", { kind: "token", scope: row.scope, tokenId: row.id });
    touchToken(c, row.id, Date.now());
    return next();
  }

  const token = getCookie(c, COOKIE);
  if (!token || !(await verifySession(c.env, token, Math.floor(Date.now() / 1000)))) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (!SAFE_METHODS.has(c.req.method)) {
    // a missing Origin is treated like a mismatch
    if (c.req.header("origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
  }
  c.set("auth", { kind: "cookie", scope: "admin" });
  return next();
};

export const auth = new Hono<AppEnv>();

auth.post("/login", async (c) => {
  // a placeholder or short secret is a deploy mistake: refuse to issue any session
  if (weakPassword(c.env.ADMIN_PASSWORD)) return c.json({ error: "weak_admin_password" }, 500);
  const now = Date.now();
  if (!reserveSlot(now)) return c.json({ error: "too_many_attempts" }, 429);
  const body: unknown = await c.req.json().catch(() => null);
  const password =
    body && typeof body === "object" && typeof (body as { password?: unknown }).password === "string"
      ? (body as { password: string }).password
      : "";
  if (!(await passwordMatches(password, c.env.ADMIN_PASSWORD ?? ""))) {
    await sleep(FAIL_DELAY_MS);
    return c.json({ error: "invalid_credentials" }, 401);
  }
  releaseSlot();
  let jwt: string;
  try {
    jwt = await signSession(c.env, Math.floor(now / 1000));
  } catch {
    return c.json({ error: "server_misconfigured", detail: "ENCRYPTION_KEY missing or invalid" }, 500);
  }
  setCookie(c, COOKIE, jwt, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_S,
  });
  return c.body(null, 204);
});

auth.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
  return c.body(null, 204);
});
