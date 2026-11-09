import type { Context } from "hono";
import type { Env } from "@/env";

// stub: serves assets as-is; the SPA fallback and security headers land in plan 3 task 2
export const adminSpa = (c: Context<{ Bindings: Env }>) => c.env.ASSETS.fetch(c.req.raw);
