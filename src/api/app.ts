import { Hono } from "hono";
import type { Env } from "@/env";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", (c) => c.json({ ok: true }));
