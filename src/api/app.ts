import { Hono } from "hono";
import type { Env } from "@/env";
import { beat } from "@/api/beat";
import { publicApi } from "@/api/public";
import { auth, requireAdmin } from "@/api/admin/auth";
import { adminSpa } from "@/api/admin-spa";
import { eventsApi } from "@/api/admin/events";
import { groupsApi } from "@/api/admin/groups";
import { monitorsApi } from "@/api/admin/monitors";
import { overviewApi } from "@/api/admin/overview";
import { sessionApi } from "@/api/admin/session";
import { settingsApi } from "@/api/admin/settings";
import { tokensApi } from "@/api/admin/tokens";
import { transferApi } from "@/api/admin/transfer";
import { VERSION } from "@/version";

export const app = new Hono<{ Bindings: Env }>();

const INSTALL_SOURCES = ["cli", "cloud", "git"] as const;

const parseInstallSource = (value: string | undefined) =>
  INSTALL_SOURCES.find((source) => source === value) ?? null;

app.get("/api/v1/health", (c) =>
  c.json({ ok: true, version: VERSION, installSource: parseInstallSource(c.env.EDGEBEAT_INSTALL_SOURCE) }),
);
app.route("/beat", beat);
app.route("/api/v1", publicApi);

app.use("/api/admin/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});
app.use("/api/admin/*", requireAdmin);
app.route("/api/admin", auth);
app.route("/api/admin/monitors", monitorsApi);
app.route("/api/admin/groups", groupsApi);
app.route("/api/admin/settings", settingsApi);
app.route("/api/admin/session", sessionApi);
app.route("/api/admin/overview", overviewApi);
app.route("/api/admin/events", eventsApi);
app.route("/api/admin/tokens", tokensApi);
app.route("/api/admin", transferApi);

app.get("/admin", adminSpa);
app.get("/admin/*", adminSpa);
