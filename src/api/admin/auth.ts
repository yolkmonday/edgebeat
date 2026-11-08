import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "@/env";
import { jwtKey } from "@/lib/keys";

const COOKIE = "eb_session";
const SESSION_S = 12 * 60 * 60;
const FAIL_DELAY_MS = 500;
const MAX_FAILURES = 10;
const WINDOW_MS = 60_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type AppEnv = { Bindings: Env };

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

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === "/api/admin/login") return next();
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
  return next();
};

export const auth = new Hono<AppEnv>();

auth.post("/login", async (c) => {
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
