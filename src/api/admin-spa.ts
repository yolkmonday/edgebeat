import type { Context } from "hono";
import type { Env } from "@/env";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const hardened = (res: Response, extra: Record<string, string>): Response => {
  const out = new Response(res.body, res);
  out.headers.set("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
};

/** `/admin` and `/admin/*`: built files pass through, every other path gets the SPA shell. */
export const adminSpa = async (c: Context<{ Bindings: Env }>): Promise<Response> => {
  const url = new URL(c.req.url);
  const last = url.pathname.split("/").pop() ?? "";

  // a file-like path never falls back to HTML: a missing script must stay a 404
  if (last.includes(".")) {
    const res = await c.env.ASSETS.fetch(c.req.raw);
    const immutable = res.ok && url.pathname.startsWith("/admin/assets/");
    return hardened(res, immutable ? { "Cache-Control": "public, max-age=31536000, immutable" } : {});
  }

  const shell = await c.env.ASSETS.fetch(new Request(`${url.origin}/admin/`));
  if (!shell.ok) return c.text("Admin UI is not built. Run bun run build.", 404);
  return hardened(shell, {
    "Content-Security-Policy": CSP,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
};
