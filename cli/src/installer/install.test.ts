import { describe, expect, test } from "bun:test";
import {
  isInstallError,
  type InstallEvent,
  type InstallStep,
  type InstallOptions,
  type ReleaseBundle,
  type ScriptBinding,
} from "../contracts";
import { createFakeApi, fakeScript, type FakeD1, type FakeState } from "./fake-api";
import { install, update } from "./index";

const MIGRATION_0 =
  "CREATE TABLE `monitors` (`id` text);\n--> statement-breakpoint\nCREATE INDEX `m_i` ON `monitors` (`id`);";
const MIGRATION_1 = "CREATE TABLE `events` (`id` text);";
const MIGRATION_X = "ALTER TABLE `monitors` ADD `note` text;";

const bundle = (version: string, migrations: { name: string; sql: string }[]): ReleaseBundle => ({
  manifest: {
    version,
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    mainModule: "index.js",
    modules: [{ name: "index.js", contentType: "application/javascript+module" }],
    crons: ["* * * * *"],
    assetsConfig: { run_worker_first: ["/api/*"], not_found_handling: "single-page-application" },
    migrations: migrations.map((m) => m.name),
    observability: true,
  },
  modules: { "index.js": new TextEncoder().encode("export default {}") },
  assets: { "/index.html": new TextEncoder().encode("<html></html>") },
  migrations,
});

const v010 = bundle("0.1.0", [
  { name: "0000_init.sql", sql: MIGRATION_0 },
  { name: "0001_more.sql", sql: MIGRATION_1 },
]);

const baseOpts = (events: InstallEvent[], over: Partial<InstallOptions> = {}): InstallOptions => ({
  accountId: "acc",
  name: "edgebeat",
  source: "cli",
  onEvent: (e) => events.push(e),
  pollIntervalMs: 1,
  pollTimeoutMs: 30,
  ...over,
});

const caught = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => {
  try {
    await p;
  } catch (e) {
    if (isInstallError(e)) return { code: e.code, message: e.message };
    throw e;
  }
  throw new Error("expected an install error");
};

const sourceBinding = (source: string): ScriptBinding => ({
  type: "plain_text",
  name: "EDGEBEAT_INSTALL_SOURCE",
  text: source,
});

const installedState = (
  over: { version?: string; source?: string; migrations?: string[] } = {},
): Partial<FakeState> => ({
  subdomain: "acme",
  d1: [
    { uuid: "u1", name: "edgebeat", migrations: over.migrations ?? ["0000_init.sql", "0001_more.sql"], executed: [] },
  ],
  scripts: {
    edgebeat: fakeScript({
      version: over.version ?? "0.1.0",
      workersDev: true,
      crons: ["* * * * *"],
      bindings: [
        { type: "d1", name: "DB", id: "u1" },
        { type: "assets", name: "ASSETS" },
        sourceBinding(over.source ?? "cli"),
      ],
      secrets: { ENCRYPTION_KEY: "existing-key", ADMIN_PASSWORD: "existing-password" },
    }),
  },
});

const migrationRuns = (d: FakeD1 | undefined): string[] =>
  (d?.executed ?? []).filter((sql) => !/CREATE TABLE IF NOT EXISTS d1_migrations/i.test(sql));

const stepTrail = (events: InstallEvent[]): string[] => events.map((e) => `${e.step}:${e.status}`);

describe("install", () => {
  test("fresh account installs everything in step order", async () => {
    const api = createFakeApi();
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events, { subdomain: "acme" }));

    const steps = [
      "verify",
      "limits",
      "subdomain",
      "database",
      "migrations",
      "script",
      "secrets",
      "schedule",
      "route",
      "health",
    ];
    expect(stepTrail(events)).toEqual(steps.flatMap((s) => [`${s}:start`, `${s}:done`]));

    const { state } = api;
    expect(state.subdomain).toBe("acme");
    expect(state.d1.map((d) => d.name)).toEqual(["edgebeat"]);
    const db = state.d1[0];
    expect(db?.migrations).toEqual(["0000_init.sql", "0001_more.sql"]);

    const script = state.scripts.edgebeat;
    expect(script?.version).toBe("0.1.0");
    expect(script?.bindings).toEqual([
      { type: "d1", name: "DB", id: db?.uuid ?? "" },
      { type: "assets", name: "ASSETS" },
      sourceBinding("cli"),
    ]);
    expect(script?.assetsJwt).toBe("jwt-edgebeat");
    expect(script?.crons).toEqual(["* * * * *"]);
    expect(script?.workersDev).toBe(true);
    expect(Object.keys(script?.secrets ?? {}).sort()).toEqual(["ADMIN_PASSWORD", "ENCRYPTION_KEY"]);
    expect(atob(script?.secrets.ENCRYPTION_KEY ?? "").length).toBe(32);

    expect(result.statusUrl).toBe("https://edgebeat.acme.workers.dev/");
    expect(result.adminUrl).toBe("https://edgebeat.acme.workers.dev/admin");
    expect(result.version).toBe("0.1.0");
    expect(result.generatedPassword).toHaveLength(24);
    expect(script?.secrets.ADMIN_PASSWORD).toBe(result.generatedPassword ?? "");
  });

  test("uses a given admin password and reports none generated", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const result = await install(api, v010, baseOpts([], { adminPassword: "a-strong-password" }));
    expect(api.state.scripts.edgebeat?.secrets.ADMIN_PASSWORD).toBe("a-strong-password");
    expect(result.generatedPassword).toBeNull();
  });

  test("resumes after partial install", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      d1: [{ uuid: "u1", name: "edgebeat", migrations: ["0000_init.sql"], executed: [] }],
      scripts: {
        edgebeat: fakeScript({
          version: "0.1.0",
          workersDev: true,
          bindings: [sourceBinding("cli")],
          secrets: { ENCRYPTION_KEY: "existing-key" },
        }),
      },
    });
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events));

    const { state } = api;
    expect(state.writes.some((w) => w.method === "createD1")).toBe(false);
    expect(state.d1).toHaveLength(1);
    expect(state.d1[0]?.migrations).toEqual(["0000_init.sql", "0001_more.sql"]);
    expect(migrationRuns(state.d1[0])).toEqual([
      "CREATE TABLE `events` (`id` text);\nINSERT INTO d1_migrations (name) VALUES ('0001_more.sql');",
    ]);
    const secrets = state.scripts.edgebeat?.secrets;
    expect(secrets?.ENCRYPTION_KEY).toBe("existing-key");
    const secretWrites = state.writes.filter((w) => w.method === "putSecret").map((w) => w.args[2]);
    expect(secretWrites).toEqual(["ADMIN_PASSWORD"]);
    expect(secrets?.ADMIN_PASSWORD).toBe(result.generatedPassword ?? "");
    expect(events.filter((e) => e.status === "skip").map((e) => e.step)).toEqual(["subdomain", "database"]);
    expect(events.at(-1)).toEqual({ step: "health", status: "done", detail: "0.1.0" });
  });

  test("refuses foreign worker with same name", async () => {
    const api = createFakeApi({ subdomain: "acme", scripts: { edgebeat: fakeScript() } });
    const events: InstallEvent[] = [];
    const err = await caught(install(api, v010, baseOpts(events)));
    expect(err.code).toBe("name_taken");
    expect(api.state.writes).toEqual([]);
    expect(events.at(-1)).toMatchObject({ step: "limits", status: "fail", error: { code: "name_taken" } });
  });

  test("refuses an existing worker when there is no subdomain to check it", async () => {
    const api = createFakeApi({ scripts: { edgebeat: fakeScript() } });
    expect((await caught(install(api, v010, baseOpts([], { subdomain: "acme" })))).code).toBe("name_taken");
    expect(api.state.writes).toEqual([]);
  });

  test("refuses a complete install as already installed", async () => {
    const api = createFakeApi(installedState());
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("already_installed");
    expect(api.state.writes).toEqual([]);
  });

  test("refuses a git managed install even when secrets are missing", async () => {
    const seed = installedState({ source: "git" });
    const script = seed.scripts?.edgebeat;
    if (script) script.secrets = {};
    const api = createFakeApi(seed);
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("already_installed");
    expect(api.state.writes).toEqual([]);
  });

  test("requires subdomain before changes", async () => {
    const api = createFakeApi();
    const events: InstallEvent[] = [];
    expect((await caught(install(api, v010, baseOpts(events)))).code).toBe("no_subdomain");
    expect(api.state.writes).toEqual([]);
    expect(events.at(-1)).toMatchObject({ step: "subdomain", status: "fail", error: { code: "no_subdomain" } });
  });

  test("rejects an invalid subdomain option before changes", async () => {
    const api = createFakeApi();
    expect((await caught(install(api, v010, baseOpts([], { subdomain: "Not Valid" })))).code).toBe("invalid_name");
    expect(api.state.writes).toEqual([]);
  });

  test("stops on d1 limit before changes", async () => {
    const d1 = Array.from({ length: 10 }, (_, i): FakeD1 => ({
      uuid: `d${i}`,
      name: `db${i}`,
      migrations: null,
      executed: [],
    }));
    const api = createFakeApi({ subdomain: "acme", d1 });
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("limit_d1");
    expect(api.state.writes).toEqual([]);
  });

  test("d1 limit does not apply when the database already exists", async () => {
    const d1 = Array.from({ length: 10 }, (_, i): FakeD1 => ({
      uuid: `d${i}`,
      name: i === 0 ? "edgebeat" : `db${i}`,
      migrations: null,
      executed: [],
    }));
    const api = createFakeApi({ subdomain: "acme", d1 });
    await install(api, v010, baseOpts([]));
    expect(api.state.d1).toHaveLength(10);
  });

  test("stops on worker limit before changes", async () => {
    const api = createFakeApi({ subdomain: "acme", otherWorkers: 100 });
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("limit_workers");
    expect(api.state.writes).toEqual([]);
  });

  test("missing token permission stops before changes and names it", async () => {
    const api = createFakeApi({ verify: { ok: false, missing: ["Account · D1 · Edit"] } });
    const err = await caught(install(api, v010, baseOpts([], { subdomain: "acme" })));
    expect(err.code).toBe("missing_permission");
    expect(err.message).toContain("Account · D1 · Edit");
    expect(api.state.writes).toEqual([]);
  });

  test("weak given password fails before any write", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const err = await caught(install(api, v010, baseOpts([], { adminPassword: "change-me" })));
    expect(err).toEqual({
      code: "weak_password",
      message: 'Admin password must be at least 12 characters and not "change-me".',
    });
    expect(api.state.writes).toEqual([]);
  });

  test("invalid name fails before any write", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    expect((await caught(install(api, v010, baseOpts([], { name: "Edge_Beat" })))).code).toBe("invalid_name");
    expect(api.state.writes).toEqual([]);
  });

  test("health that never reaches the bundle version fails with the url", async () => {
    const api = createFakeApi({ subdomain: "acme", healthOverride: () => ({ ok: true, version: "0.0.9" }) });
    const events: InstallEvent[] = [];
    const err = await caught(install(api, v010, baseOpts(events)));
    expect(err.code).toBe("health_failed");
    expect(err.message).toContain("https://edgebeat.acme.workers.dev/api/v1/health");
    expect(events.at(-1)).toMatchObject({ step: "health", status: "fail" });
  });

  test("a failure after secrets were set still hands back the generated password", async () => {
    const api = createFakeApi({ subdomain: "acme", healthOverride: () => null });
    const err = await install(api, v010, baseOpts([])).catch((e: unknown) => e);
    const generated = (err as { generatedPassword?: string }).generatedPassword;
    expect(generated).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(api.state.scripts.edgebeat?.secrets.ADMIN_PASSWORD).toBe(generated ?? "");
  });

  test("health polls until the new version answers", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const urls: string[] = [];
    const real = api.fetchHealth;
    api.state.healthOverride = (url) => {
      urls.push(url);
      return null;
    };
    const pending = install(api, v010, baseOpts([], { pollTimeoutMs: 2000 }));
    setTimeout(() => {
      api.state.healthOverride = null;
    }, 20);
    await pending;
    expect(urls.length).toBeGreaterThan(1);
    expect(await real("https://edgebeat.acme.workers.dev/api/v1/health")).toMatchObject({ version: "0.1.0" });
  });

  test("an api failure emits a fail event and rethrows", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    api.createD1 = async () => {
      throw new Error("boom");
    };
    const events: InstallEvent[] = [];
    await expect(install(api, v010, baseOpts(events))).rejects.toThrow("boom");
    expect(events.at(-1)).toEqual({ step: "database", status: "fail", error: { code: "api_error", message: "boom" } });
  });
});

describe("update", () => {
  const v020 = bundle("0.2.0", [...v010.migrations, { name: "0001_x.sql", sql: MIGRATION_X }]);
  const updateOpts = (events: InstallEvent[]) => {
    const { adminPassword: _a, subdomain: _s, ...rest } = baseOpts(events);
    return rest;
  };

  test("update keeps secrets and applies only new migrations", async () => {
    const api = createFakeApi(installedState());
    const events: InstallEvent[] = [];
    const result = await update(api, v020, updateOpts(events));

    const steps: InstallStep[] = ["verify", "database", "migrations", "script", "schedule", "route", "health"];
    expect([...new Set(events.map((e) => e.step))]).toEqual(steps);
    expect(events.every((e) => e.status !== "fail")).toBe(true);

    const { state } = api;
    expect(migrationRuns(state.d1[0])).toEqual([
      "ALTER TABLE `monitors` ADD `note` text;\nINSERT INTO d1_migrations (name) VALUES ('0001_x.sql');",
    ]);
    const script = state.scripts.edgebeat;
    expect(script?.secrets).toEqual({ ENCRYPTION_KEY: "existing-key", ADMIN_PASSWORD: "existing-password" });
    expect(state.writes.some((w) => w.method === "putSecret" || w.method === "createD1")).toBe(false);
    const put = state.writes.find((w) => w.method === "putScript");
    expect(put?.args[2]).toEqual({
      version: "0.2.0",
      bindings: [{ type: "d1", name: "DB", id: "u1" }, { type: "assets", name: "ASSETS" }, sourceBinding("cli")],
    });
    expect(script?.version).toBe("0.2.0");
    expect(result).toEqual({
      statusUrl: "https://edgebeat.acme.workers.dev/",
      adminUrl: "https://edgebeat.acme.workers.dev/admin",
      version: "0.2.0",
      generatedPassword: null,
    });
  });

  test("update refuses a git managed install with the exact copy", async () => {
    const api = createFakeApi(installedState({ source: "git" }));
    const err = await caught(update(api, v020, updateOpts([])));
    expect(err).toEqual({
      code: "git_managed",
      message: "This install is managed by its git repository. Pull upstream and redeploy to update.",
    });
    expect(api.state.writes).toEqual([]);
  });

  test("update without an install fails with not_installed", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    expect((await caught(update(api, v020, updateOpts([])))).code).toBe("not_installed");
    expect(api.state.writes).toEqual([]);
  });

  test("update on a foreign worker fails with not_installed", async () => {
    const api = createFakeApi({ subdomain: "acme", scripts: { edgebeat: fakeScript() } });
    expect((await caught(update(api, v020, updateOpts([])))).code).toBe("not_installed");
    expect(api.state.writes).toEqual([]);
  });

  test("update fails with not_installed when the database is gone", async () => {
    const seed = installedState();
    seed.d1 = [];
    const api = createFakeApi(seed);
    expect((await caught(update(api, v020, updateOpts([])))).code).toBe("not_installed");
    expect(api.state.writes).toEqual([]);
  });
});
