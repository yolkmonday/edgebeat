import { SELF, env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import * as t from "@/db/schema";
import { resetLoginLimiter } from "@/api/admin/auth";
import type { ExportFile, ImportSummary } from "@/shared/admin-api";

const db = getDb(env);
const BASE = "https://edgebeat.test";

let cookie = "";

const login = async () => {
  const res = await SELF.fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ password: "test-password" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0]!;
};

const call = (method: string, path: string, body?: unknown) =>
  SELF.fetch(`${BASE}/api/admin${path}`, {
    method,
    headers: {
      cookie,
      ...(method !== "GET" ? { origin: BASE } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const importFile = (file: unknown, qs = "") => call("POST", `/import${qs}`, file);

const http = (slug: string, extra: Record<string, unknown> = {}) => ({
  name: slug.toUpperCase(),
  slug,
  type: "http",
  url: `https://${slug}.example.com`,
  intervalMin: 5,
  ...extra,
});

const file = (monitors: unknown[], groups: unknown[] = [], settings?: unknown) => ({
  edgebeat: 1,
  settings,
  groups,
  monitors,
});

const counts = async () => ({
  monitors: (await db.select().from(t.monitors)).length,
  groups: (await db.select().from(t.groups)).length,
  heartbeats: (await db.select().from(t.heartbeats)).length,
  events: (await db.select().from(t.events)).length,
  stats: (await db.select().from(t.dailyStats)).length,
  settings: (await db.select().from(t.settings)).length,
});

beforeEach(async () => {
  resetLoginLimiter();
  await db.batch([
    db.delete(t.monitorState),
    db.delete(t.heartbeats),
    db.delete(t.events),
    db.delete(t.dailyStats),
    db.delete(t.monitors),
    db.delete(t.groups),
    db.delete(t.settings),
  ]);
  await login();
});

const seed = async () => {
  const res = await importFile(
    file(
      [
        http("web", { group: "core", keyword: "ok" }),
        { name: "DB", slug: "db", type: "tcp", host: "db.example.com", port: 5432, intervalMin: 10, group: "core", isPublic: false },
        { name: "Cron", slug: "cron", type: "heartbeat", heartbeatPeriodS: 3600, heartbeatGraceS: 300 },
      ],
      [{ slug: "core", name: "Core", sort: 2 }],
      { siteName: "My Status", plan: "free", checkBudget: null },
    ),
  );
  expect(res.status).toBe(200);
};

describe("export", () => {
  it("export contains no secrets", async () => {
    await seed();
    const rows = await db.select().from(t.monitors);
    const hb = rows.find((r) => r.type === "heartbeat")!;
    const res = await call("GET", "/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="edgebeat-config-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    for (const secret of [hb.heartbeatToken!, "heartbeatToken", "beatUrl", "/beat/", '"id"', "createdAt", "updatedAt", ...rows.map((r) => r.id)]) {
      expect(text).not.toContain(secret);
    }
    const out = JSON.parse(text) as ExportFile;
    expect(out.edgebeat).toBe(1);
    expect(out.settings).toEqual({ siteName: "My Status", plan: "free", checkBudget: null });
    expect(out.groups).toEqual([{ slug: "core", name: "Core", sort: 2 }]);
    expect(out.monitors.map((m) => [m.slug, m.group])).toEqual(
      expect.arrayContaining([["web", "core"], ["db", "core"], ["cron", null]]),
    );
  });

  it("requires auth", async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/export`);
    expect(res.status).toBe(401);
  });
});

describe("import", () => {
  it("export then import into the same database changes nothing", async () => {
    await seed();
    const before = { monitors: await db.select().from(t.monitors), groups: await db.select().from(t.groups) };
    const exported = (await (await call("GET", "/export")).json()) as ExportFile;
    const res = await importFile(exported);
    expect(res.status).toBe(200);
    const summary = (await res.json()) as ImportSummary;
    expect(summary.dryRun).toBe(false);
    expect(summary.settingsChanged).toBe(false);
    expect(summary.monitors.created).toEqual([]);
    expect(summary.monitors.deleted).toEqual([]);
    expect(summary.monitors.updated.sort()).toEqual(["cron", "db", "web"]);
    expect(summary.groups).toEqual({ created: [], updated: ["core"], deleted: [] });

    const after = { monitors: await db.select().from(t.monitors), groups: await db.select().from(t.groups) };
    const strip = (rows: typeof before.monitors) =>
      rows.map(({ updatedAt: _u, ...rest }) => rest).sort((a, b) => a.slug.localeCompare(b.slug));
    expect(strip(after.monitors)).toEqual(strip(before.monitors)); // ids, heartbeat token, createdAt unchanged
    expect(after.groups).toEqual(before.groups);
  });

  it("new slugs are created and heartbeats get a working beat token", async () => {
    const res = await importFile(
      file([{ name: "Job", slug: "job", type: "heartbeat", heartbeatPeriodS: 3600, heartbeatGraceS: 60 }]),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as ImportSummary).monitors.created).toEqual(["job"]);
    const [row] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "job"));
    expect(row!.heartbeatToken).toBeTruthy();
    expect(await db.select().from(t.heartbeats).where(eq(t.heartbeats.monitorId, row!.id))).toHaveLength(1);
    const beat = await SELF.fetch(`${BASE}/beat/${row!.heartbeatToken}`);
    expect(beat.status).toBeLessThan(300);
  });

  it("updates existing monitors in place and applies settings", async () => {
    await seed();
    const [before] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    const res = await importFile(
      file([http("web", { name: "Renamed", intervalMin: 15 })], [], { siteName: "Other", plan: "paid", checkBudget: 100 }),
    );
    const summary = (await res.json()) as ImportSummary;
    expect(res.status).toBe(200);
    expect(summary.settingsChanged).toBe(true);
    const [after] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    expect(after).toMatchObject({ id: before!.id, name: "Renamed", intervalMin: 15, createdAt: before!.createdAt, groupId: null });
    const cfg = Object.fromEntries((await db.select().from(t.settings)).map((s) => [s.key, JSON.parse(s.value)]));
    expect(cfg).toEqual({ siteName: "Other", plan: "paid", checkBudget: 100 });
    // merge-only: the other two monitors are untouched
    expect(await db.select().from(t.monitors)).toHaveLength(3);
  });

  it("paused flip through import writes the same lifecycle as patch", async () => {
    await seed();
    const [web] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    const res = await importFile(file([http("web", { paused: true })]));
    expect(res.status).toBe(200);
    const [state] = await db.select().from(t.monitorState).where(eq(t.monitorState.monitorId, web!.id));
    expect(state!.state).toBe("paused");
    const evs = await db.select().from(t.events).where(eq(t.events.monitorId, web!.id));
    expect(evs.map((e) => e.toState)).toEqual(["paused"]);
  });

  it("import is atomic", async () => {
    await seed();
    const before = await counts();
    const res = await importFile(
      file([
        http("fresh-one"),
        http("web", { name: "should not apply" }),
        { ...http("bad"), url: "http://127.0.0.1/admin" },
        { name: "x", slug: "x", type: "tcp", host: "h", port: 25 },
      ]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: { path: (string | number)[]; message: string }[] };
    expect(body.error).toBe("validation");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        { path: ["monitors", 2, "url"], message: "invalid_url" },
        expect.objectContaining({ path: ["monitors", 3, "port"] }),
      ]),
    );
    expect(await counts()).toEqual(before);
    const [web] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    expect(web!.name).toBe("WEB");
  });

  it("prune deletes only with flag", async () => {
    await seed();
    const [db1] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "db"));
    await db.insert(t.events).values({ monitorId: db1!.id, fromState: "up", toState: "down", at: 1, reason: "timeout" });
    await db.insert(t.dailyStats).values({ monitorId: db1!.id, day: "2026-11-01" });
    await db.insert(t.groups).values({ id: "g-extra", slug: "extra", name: "Extra", sort: 0 });

    const keep = file([http("web")], [{ slug: "core", name: "Core", sort: 2 }]);
    const merged = (await (await importFile(keep)).json()) as ImportSummary;
    expect(merged.monitors.deleted).toEqual([]);
    expect(merged.groups.deleted).toEqual([]);
    expect(await db.select().from(t.monitors)).toHaveLength(3);
    expect(await db.select().from(t.groups)).toHaveLength(2);

    const pruned = (await (await importFile(keep, "?prune=true")).json()) as ImportSummary;
    expect(pruned.prune).toBe(true);
    expect(pruned.monitors.deleted.sort()).toEqual(["cron", "db"]);
    expect(pruned.groups.deleted).toEqual(["extra"]);
    expect((await db.select().from(t.monitors)).map((m) => m.slug)).toEqual(["web"]);
    expect((await db.select().from(t.groups)).map((g) => g.slug)).toEqual(["core"]);
    expect(await db.select().from(t.events)).toHaveLength(0);
    expect(await db.select().from(t.dailyStats)).toHaveLength(0);
    expect(await db.select().from(t.heartbeats)).toHaveLength(0);
  });

  it("prune removes every row when more than 99 monitors and groups are pruned", async () => {
    const N = 205;
    const ids = Array.from({ length: N }, (_, i) => `m${i}`);
    const now = Date.now();
    const insert = async (stmts: unknown[]) => {
      for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40) as never);
    };
    await insert(ids.map((id, i) => db.insert(t.groups).values({ id: `g${i}`, slug: `grp-${i}`, name: `G${i}`, sort: 0 })));
    await insert(
      ids.map((id, i) =>
        db.insert(t.monitors).values({ id, slug: `mon-${i}`, name: id, type: "tcp", host: "h.example.com", port: 1, groupId: `g${i}`, createdAt: now, updatedAt: now }),
      ),
    );
    await insert(ids.map((id) => db.insert(t.events).values({ monitorId: id, fromState: "up", toState: "down", at: 1, reason: "timeout" })));
    await insert(ids.map((id) => db.insert(t.dailyStats).values({ monitorId: id, day: "2026-11-01" })));

    const res = await importFile(file([]), "?prune=true");
    expect(res.status).toBe(200);
    const summary = (await res.json()) as ImportSummary;
    expect(summary.monitors.deleted).toHaveLength(N);
    expect(summary.groups.deleted).toHaveLength(N);
    expect(await counts()).toMatchObject({ monitors: 0, groups: 0, events: 0, stats: 0 });
  });

  it("rejects oversized bodies and too many groups with 413/400", async () => {
    const huge = file([http("web", { body: "x".repeat(1024 * 1024) })]);
    expect((await importFile(huge)).status).toBe(413);
    const tooManyGroups = file([], Array.from({ length: 1001 }, (_, i) => ({ slug: `g-${i}`, name: "G", sort: 0 })));
    expect((await importFile(tooManyGroups)).status).toBe(400);
    expect((await importFile(file([http("web")]))).status).toBe(200);
  });

  it("dryRun returns the same summary with zero writes", async () => {
    await seed();
    const before = await counts();
    const [webBefore] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    const body = file([http("web", { name: "Dry" }), http("brand-new")], [{ slug: "newg", name: "N", sort: 0 }], {
      siteName: "Dry Run",
    });
    const dry = (await (await importFile(body, "?dryRun=true&prune=true")).json()) as ImportSummary;
    expect(dry).toMatchObject({ dryRun: true, prune: true, settingsChanged: true });
    expect(dry.monitors).toEqual({ created: ["brand-new"], updated: ["web"], deleted: expect.arrayContaining(["db", "cron"]) });
    expect(dry.groups.created).toEqual(["newg"]);
    expect(await counts()).toEqual(before);
    const [webAfter] = await db.select().from(t.monitors).where(eq(t.monitors.slug, "web"));
    expect(webAfter).toEqual(webBefore);

    const real = (await (await importFile(body, "?prune=true")).json()) as ImportSummary;
    expect({ ...real, dryRun: true }).toEqual(dry);
  });

  it("unknown group slug is 400; existing group slug is accepted without prune", async () => {
    await seed();
    const unknown = await importFile(file([http("web", { group: "nope" })]));
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { issues: unknown[] }).issues).toEqual([
      { path: ["monitors", 0, "group"], message: "unknown group" },
    ]);
    expect((await importFile(file([http("web", { group: "core" })]))).status).toBe(200);
    // with prune the undeclared group is deleted, so referencing it is invalid
    expect((await importFile(file([http("web", { group: "core" })]), "?prune=true")).status).toBe(400);
  });

  it("changing a monitor's type is 400", async () => {
    await seed();
    const res = await importFile(file([{ name: "WEB", slug: "web", type: "tcp", host: "h.example.com", port: 80 }]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { issues: unknown[] }).issues).toEqual([
      { path: ["monitors", 0, "type"], message: "type is immutable" },
    ]);
  });

  it("rejects malformed files and duplicate slugs", async () => {
    for (const body of [null, {}, { edgebeat: 2, groups: [], monitors: [] }, { edgebeat: 1, groups: [] }, "nope"]) {
      expect((await importFile(body)).status).toBe(400);
    }
    const dup = await importFile(
      file([http("a"), http("a")], [{ slug: "g", name: "G", sort: 0 }, { slug: "g", name: "G", sort: 0 }]),
    );
    expect(dup.status).toBe(400);
    const paths = ((await dup.json()) as { issues: { path: (string | number)[] }[] }).issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["monitors.0.slug", "monitors.1.slug", "groups.0.slug", "groups.1.slug"]));
    expect(await counts()).toMatchObject({ monitors: 0, groups: 0 });
  });

  it("ids and tokens smuggled into the file are ignored, never stored", async () => {
    const res = await importFile(
      file([{ ...http("smug"), id: "attacker-id", heartbeatToken: "attacker-token", createdAt: 1 }]),
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(t.monitors);
    expect(row!.id).not.toBe("attacker-id");
    expect(row!.heartbeatToken).toBeNull();
    expect(row!.createdAt).toBeGreaterThan(1);
  });

  it("import adding 41 one-minute monitors on free is 409 budget_exceeded", async () => {
    const monitors = Array.from({ length: 41 }, (_, i) => http(`m${i}`, { intervalMin: 1 }));
    expect((await importFile(file(monitors.slice(0, 20)))).status).toBe(200);
    const over = await importFile(file(monitors, [], { plan: "free" }));
    expect(over.status).toBe(409);
    const verdict = (await over.json()) as { error: string; used: number; after: number; budget: number };
    expect(verdict).toMatchObject({ error: "budget_exceeded", budget: 40 });
    expect(verdict.after).toBeGreaterThan(40);
    expect(await db.select().from(t.monitors)).toHaveLength(20);
  });

  it("200-monitor file is 413 too_large", async () => {
    const monitors = Array.from({ length: 200 }, (_, i) => http(`big${i}`, { intervalMin: 60 }));
    const res = await importFile(file(monitors));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toBe("too_large");
    expect(await counts()).toMatchObject({ monitors: 0 });
  });

  it("import keeps the Origin check for cookie sessions and requires auth", async () => {
    const noOrigin = await SELF.fetch(`${BASE}/api/admin/import`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(file([])),
    });
    expect(noOrigin.status).toBe(403);
    expect((await SELF.fetch(`${BASE}/api/admin/import`, { method: "POST", body: "{}" })).status).toBe(401);
  });
});
