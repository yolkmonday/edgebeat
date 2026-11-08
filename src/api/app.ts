import { Hono } from "hono";
import type { Env } from "@/env";
import { beat } from "@/api/beat";
import { publicApi } from "@/api/public";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", (c) => c.json({ ok: true }));
app.route("/beat", beat);
app.route("/api/v1", publicApi);
