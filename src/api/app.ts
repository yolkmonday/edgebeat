import { Hono } from "hono";
import type { Env } from "@/env";
import { beat } from "@/api/beat";
import { publicApi } from "@/api/public";
import { auth, requireAdmin } from "@/api/admin/auth";
import { groupsApi } from "@/api/admin/groups";
import { monitorsApi } from "@/api/admin/monitors";
import { settingsApi } from "@/api/admin/settings";

export const app = new Hono<{ Bindings: Env }>();

app.get("/api/v1/health", (c) => c.json({ ok: true }));
app.route("/beat", beat);
app.route("/api/v1", publicApi);

app.use("/api/admin/*", requireAdmin);
app.use("/api/admin/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.route("/api/admin", auth);
app.route("/api/admin/monitors", monitorsApi);
app.route("/api/admin/groups", groupsApi);
app.route("/api/admin/settings", settingsApi);
