import { z } from "zod";

export const INTERVALS = [1, 2, 3, 5, 10, 15, 30, 60] as const;
export const SLUG_RE = /^[a-z0-9-]{1,64}$/;
const STATUS_SPEC = /^\s*\d{3}(\s*-\s*\d{3})?(\s*,\s*\d{3}(\s*-\s*\d{3})?)*\s*$/;

// no .default() here: PATCH reuses this shape through .partial(), which would re-apply defaults
export const monitorShape = {
  name: z.string().trim().min(1).max(80),
  slug: z.string().regex(SLUG_RE),
  type: z.enum(["http", "tcp", "heartbeat"]),
  groupId: z.string().min(1).nullable().optional(),
  url: z.string().max(2048).nullable().optional(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).optional(),
  headers: z.record(z.string().min(1), z.string()).optional(),
  body: z.string().max(65_536).nullable().optional(),
  expectedStatus: z.string().max(100).regex(STATUS_SPEC).optional(),
  timeoutMs: z.number().int().min(100).max(30_000).optional(),
  followRedirects: z.boolean().optional(),
  keyword: z.string().min(1).max(500).nullable().optional(),
  keywordMode: z.enum(["contains", "not_contains"]).optional(),
  host: z.string().min(1).max(255).nullable().optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  intervalMin: z
    .number()
    .refine((n): n is (typeof INTERVALS)[number] => (INTERVALS as readonly number[]).includes(n), {
      message: "intervalMin must be one of 1, 2, 3, 5, 10, 15, 30, 60",
    })
    .optional(),
  confirmations: z.number().int().min(1).max(10).optional(),
  degradedThresholdMs: z.number().int().min(1).nullable().optional(),
  heartbeatPeriodS: z.number().int().min(60).nullable().optional(),
  heartbeatGraceS: z.number().int().min(0).nullable().optional(),
  isPublic: z.boolean().optional(),
  paused: z.boolean().optional(),
  sort: z.number().int().optional(),
};

// Workers cannot open outbound connections to port 25
const BLOCKED_TCP_PORTS = new Set([25]);

const need = (ctx: z.RefinementCtx, path: string, message: string) =>
  ctx.addIssue({ code: "custom", path: [path], message });

const validHeaders = (h: Record<string, string>): boolean => {
  try {
    new Headers(h);
    return true;
  } catch {
    return false;
  }
};

/** Full-record rules: `type`-specific required fields, and configs that could never pass. */
export const monitorInput = z.object(monitorShape).superRefine((v, ctx) => {
  if (v.type === "http") {
    if (!v.url) need(ctx, "url", "url is required for http monitors");
    const method = v.method ?? "GET";
    const bodyless = method === "GET" || method === "HEAD";
    if (bodyless && v.body != null) need(ctx, "body", `${method} requests cannot have a body`);
    if (method === "HEAD" && v.keyword != null) need(ctx, "keyword", "HEAD responses have no body to match a keyword");
    if (v.headers && !validHeaders(v.headers)) need(ctx, "headers", "invalid header name or value");
  }
  if (v.type === "tcp") {
    if (!v.host) need(ctx, "host", "host is required for tcp monitors");
    if (v.port == null) need(ctx, "port", "port is required for tcp monitors");
    else if (BLOCKED_TCP_PORTS.has(v.port)) need(ctx, "port", "port 25 is blocked for outbound connections on Workers");
  }
  if (v.type === "heartbeat") {
    if (v.heartbeatPeriodS == null) need(ctx, "heartbeatPeriodS", "heartbeatPeriodS (>= 60) is required");
    if (v.heartbeatGraceS == null) need(ctx, "heartbeatGraceS", "heartbeatGraceS (>= 0) is required");
  }
});

export const monitorPatch = z.object(monitorShape).partial();

export type MonitorInput = z.input<typeof monitorInput>;

/** Lowercase, non [a-z0-9] runs become "-", trimmed, at most 64 chars; empty falls back to "monitor". */
export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "") || "monitor";
