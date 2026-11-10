import { describe, expect, test } from "bun:test";
import {
  isInstallError,
  makeInstallError,
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
  name: "upflare",
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
  name: "UPFLARE_INSTALL_SOURCE",
  text: source,
});

const versionBinding = (version: string): ScriptBinding => ({
  type: "plain_text",
  name: "UPFLARE_VERSION",
  text: version,
});

const installedState = (
  over: { version?: string; source?: string; migrations?: string[] } = {},
): Partial<FakeState> => ({
  subdomain: "acme",
  d1: [
    { uuid: "u1", name: "upflare", migrations: over.migrations ?? ["0000_init.sql", "0001_more.sql"], executed: [] },
  ],
  scripts: {
    upflare: fakeScript({
      version: over.version ?? "0.1.0",
      workersDev: true,
      crons: ["* * * * *"],
      bindings: [
        { type: "d1", name: "DB", id: "u1" },
        { type: "assets", name: "ASSETS" },
        sourceBinding(over.source ?? "cli"),
        versionBinding(over.version ?? "0.1.0"),
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
    expect(state.d1.map((d) => d.name)).toEqual(["upflare"]);
    const db = state.d1[0];
    expect(db?.migrations).toEqual(["0000_init.sql", "0001_more.sql"]);

    const script = state.scripts.upflare;
    expect(script?.version).toBe("0.1.0");
    expect(script?.bindings).toEqual([
      { type: "d1", name: "DB", id: db?.uuid ?? "" },
      { type: "assets", name: "ASSETS" },
      sourceBinding("cli"),
      versionBinding("0.1.0"),
    ]);
    expect(script?.assetsJwt).toBe("jwt-upflare");
    expect(script?.crons).toEqual(["* * * * *"]);
    expect(script?.workersDev).toBe(true);
    expect(Object.keys(script?.secrets ?? {}).sort()).toEqual(["ADMIN_PASSWORD", "ENCRYPTION_KEY"]);
    expect(atob(script?.secrets.ENCRYPTION_KEY ?? "").length).toBe(32);

    expect(result.statusUrl).toBe("https://upflare.acme.workers.dev/");
    expect(result.adminUrl).toBe("https://upflare.acme.workers.dev/admin");
    expect(result.version).toBe("0.1.0");
    expect(result.generatedPassword).toHaveLength(24);
    expect(script?.secrets.ADMIN_PASSWORD).toBe(result.generatedPassword ?? "");
    expect(result.warnings).toEqual([]);
    expect(api.state.verifiedAccounts).toEqual(["acc"]);
  });

  test("uses a given admin password and reports none generated", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const result = await install(api, v010, baseOpts([], { adminPassword: "a-strong-password" }));
    expect(api.state.scripts.upflare?.secrets.ADMIN_PASSWORD).toBe("a-strong-password");
    expect(result.generatedPassword).toBeNull();
  });

  test("resumes after partial install", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      d1: [{ uuid: "u1", name: "upflare", migrations: ["0000_init.sql"], executed: [] }],
      scripts: {
        upflare: fakeScript({
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
    const secrets = state.scripts.upflare?.secrets;
    expect(secrets?.ENCRYPTION_KEY).toBe("existing-key");
    const secretWrites = state.writes.filter((w) => w.method === "putSecret").map((w) => w.args[2]);
    expect(secretWrites).toEqual(["ADMIN_PASSWORD"]);
    expect(secrets?.ADMIN_PASSWORD).toBe(result.generatedPassword ?? "");
    expect(events.filter((e) => e.status === "skip").map((e) => e.step)).toEqual(["subdomain", "database"]);
    expect(events.at(-1)).toEqual({ step: "health", status: "done", detail: "0.1.0" });
  });

  test("refuses foreign worker with same name", async () => {
    const api = createFakeApi({ subdomain: "acme", scripts: { upflare: fakeScript() } });
    const events: InstallEvent[] = [];
    const err = await caught(install(api, v010, baseOpts(events)));
    expect(err.code).toBe("name_taken");
    expect(api.state.writes).toEqual([]);
    expect(events.at(-1)).toMatchObject({ step: "limits", status: "fail", error: { code: "name_taken" } });
  });

  test("refuses an existing worker when there is no subdomain to check it", async () => {
    const api = createFakeApi({ scripts: { upflare: fakeScript() } });
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
    const script = seed.scripts?.upflare;
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

  test("ten D1 databases are not refused up front: creation decides (R14)", async () => {
    const d1 = Array.from({ length: 10 }, (_, i): FakeD1 => ({
      uuid: `d${i}`,
      name: `db${i}`,
      migrations: null,
      executed: [],
    }));
    const api = createFakeApi({ subdomain: "acme", d1 });
    const result = await install(api, v010, baseOpts([]));
    expect(api.state.d1).toHaveLength(11);
    expect(result.warnings).toEqual([]);
  });

  test("d1 limit does not apply when the database already exists", async () => {
    const d1 = Array.from({ length: 10 }, (_, i): FakeD1 => ({
      uuid: `d${i}`,
      name: i === 0 ? "upflare" : `db${i}`,
      migrations: null,
      executed: [],
    }));
    const api = createFakeApi({ subdomain: "acme", d1 });
    await install(api, v010, baseOpts([]));
    expect(api.state.d1).toHaveLength(10);
  });

  test("a full Worker count is a warning, not a refusal (R14)", async () => {
    const api = createFakeApi({ subdomain: "acme", otherWorkers: 100 });
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events));
    const warning = "This account already has 100 Workers, the free plan limit is 100. The upload may be refused.";
    expect(result.warnings).toEqual([warning]);
    expect(events.find((e) => e.step === "limits" && e.status === "done")).toEqual({
      step: "limits",
      status: "done",
      detail: warning,
    });
    expect(api.state.scripts.upflare?.version).toBe("0.1.0");
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

  test("health that never reaches the bundle version is a warning naming the url (R13)", async () => {
    const api = createFakeApi({ subdomain: "acme", healthOverride: () => ({ ok: true, version: "0.0.9" }) });
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events));
    expect(result.warnings).toEqual([
      "Installed, but https://upflare.acme.workers.dev/ still answers with version 0.0.9 instead of 0.1.0. It can take a minute to switch: reload it later.",
    ]);
    expect(events.at(-1)).toMatchObject({ step: "health", status: "skip" });
  });

  test("a failure after secrets were set still hands back the generated password", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    api.putSchedules = async () => {
      throw makeInstallError("api_error", "schedules down");
    };
    const err = await install(api, v010, baseOpts([])).catch((e: unknown) => e);
    const generated = (err as { generatedPassword?: string }).generatedPassword;
    expect(generated).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(api.state.scripts.upflare?.secrets.ADMIN_PASSWORD).toBe(generated ?? "");
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
    expect(await real("https://upflare.acme.workers.dev/api/v1/health")).toMatchObject({ version: "0.1.0" });
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
    const script = state.scripts.upflare;
    expect(script?.secrets).toEqual({ ENCRYPTION_KEY: "existing-key", ADMIN_PASSWORD: "existing-password" });
    expect(state.writes.some((w) => w.method === "putSecret" || w.method === "createD1")).toBe(false);
    const put = state.writes.find((w) => w.method === "putScript");
    expect(put?.args[2]).toEqual({
      version: "0.2.0",
      bindings: [
        { type: "d1", name: "DB", id: "u1" },
        { type: "assets", name: "ASSETS" },
        sourceBinding("cli"),
        versionBinding("0.2.0"),
      ],
    });
    expect(script?.version).toBe("0.2.0");
    expect(result).toEqual({
      statusUrl: "https://upflare.acme.workers.dev/",
      adminUrl: "https://upflare.acme.workers.dev/admin",
      version: "0.2.0",
      generatedPassword: null,
      warnings: [],
    });
    expect(state.verifiedAccounts).toEqual(["acc"]);
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
    const api = createFakeApi({ subdomain: "acme", scripts: { upflare: fakeScript() } });
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

describe("resume and safety guards", () => {
  const updateOpts = (events: InstallEvent[], over: Partial<InstallOptions> = {}) => {
    const { adminPassword: _a, subdomain: _s, ...rest } = baseOpts(events, over);
    return rest;
  };
  const NEWER = "This Upflare (schema 0002_future.sql) is newer than this installer (0.1.0). Use a newer upflare.";

  test("a cron limit after the upload leaves a reachable install that update can finish", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const putSchedules = api.putSchedules;
    api.putSchedules = async () => {
      throw makeInstallError("limit_cron", "This account has no free cron trigger left.");
    };
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("limit_cron");
    expect(api.state.scripts.upflare?.workersDev).toBe(true);

    api.putSchedules = putSchedules;
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("already_installed");
    await update(api, v010, updateOpts([]));
    expect(api.state.scripts.upflare?.crons).toEqual(["* * * * *"]);
  });

  test("route step still re-asserts workers.dev after the script step enabled it", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const events: InstallEvent[] = [];
    await install(api, v010, baseOpts(events));
    const methods = api.state.writes.map((w) => w.method);
    expect(methods.indexOf("enableWorkersDev")).toBe(methods.indexOf("putScript") + 1);
    expect(events.filter((e) => e.step === "route").map((e) => e.status)).toEqual(["start", "done"]);
  });

  test("refuses a foreign d1 with the same name before changes", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      d1: [{ uuid: "f1", name: "upflare", migrations: null, executed: [], tables: ["_cf_KV", "customers"] }],
    });
    const err = await caught(install(api, v010, baseOpts([])));
    expect(err.code).toBe("name_taken");
    expect(err.message).toContain('D1 database named "upflare"');
    expect(api.state.writes).toEqual([]);
  });

  test("reuses an empty d1 with the same name", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      d1: [{ uuid: "e1", name: "upflare", migrations: null, executed: [], tables: ["_cf_KV", "sqlite_sequence"] }],
    });
    await install(api, v010, baseOpts([]));
    expect(api.state.d1.map((d) => d.uuid)).toEqual(["e1"]);
    expect(api.state.d1[0]?.migrations).toEqual(["0000_init.sql", "0001_more.sql"]);
  });

  test("setup resume refuses a database newer than the installer", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      d1: [{ uuid: "u1", name: "upflare", migrations: ["0000_init.sql", "0002_future.sql"], executed: [] }],
      scripts: { upflare: fakeScript({ version: "0.3.0", workersDev: true, bindings: [sourceBinding("cli")] }) },
    });
    expect(await caught(install(api, v010, baseOpts([])))).toEqual({ code: "api_error", message: NEWER });
    expect(api.state.writes).toEqual([]);
  });

  test("update refuses a database newer than the installer", async () => {
    const api = createFakeApi(installedState({ migrations: ["0000_init.sql", "0001_more.sql", "0002_future.sql"] }));
    expect(await caught(update(api, v010, updateOpts([])))).toEqual({ code: "api_error", message: NEWER });
    expect(api.state.writes).toEqual([]);
  });

  test("update keeps the recorded install source", async () => {
    const api = createFakeApi(installedState({ source: "cloud" }));
    await update(api, v010, updateOpts([], { source: "cli" }));
    expect(api.state.scripts.upflare?.bindings).toContainEqual(sourceBinding("cloud"));
  });

  test("a given password does not replace an existing one and says so", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      scripts: {
        upflare: fakeScript({
          version: "0.1.0",
          workersDev: true,
          bindings: [sourceBinding("cli")],
          secrets: { ADMIN_PASSWORD: "existing-password" },
        }),
      },
    });
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events, { adminPassword: "a-strong-password" }));
    expect(api.state.scripts.upflare?.secrets.ADMIN_PASSWORD).toBe("existing-password");
    expect(result.generatedPassword).toBeNull();
    const done = events.find((e) => e.step === "secrets" && e.status === "done");
    expect(done && "detail" in done ? done.detail : "").toContain("admin password already set — kept");
  });
});

describe("final review: identity via the Cloudflare API (R13)", () => {
  const updateOpts = (events: InstallEvent[], over: Partial<InstallOptions> = {}) => {
    const { adminPassword: _a, subdomain: _s, ...rest } = baseOpts(events, over);
    return rest;
  };
  const UNREACHABLE =
    "Installed, but workers.dev isn't reachable from this network — open https://upflare.acme.workers.dev/ in a browser or try another network.";

  test("workers.dev unreachable: install still succeeds with a warning", async () => {
    const api = createFakeApi({ subdomain: "acme", healthOverride: () => null });
    const events: InstallEvent[] = [];
    const result = await install(api, v010, baseOpts(events));
    expect(result.warnings).toEqual([UNREACHABLE]);
    expect(result.statusUrl).toBe("https://upflare.acme.workers.dev/");
    expect(events.at(-1)).toEqual({ step: "health", status: "skip", detail: "workers.dev not reachable from here" });
    expect(api.state.scripts.upflare?.crons).toEqual(["* * * * *"]);
  });

  test("workers.dev unreachable: a complete install is still recognised as already installed", async () => {
    const api = createFakeApi({ ...installedState(), healthOverride: () => null });
    const err = await caught(install(api, v010, baseOpts([])));
    expect(err).toEqual({
      code: "already_installed",
      message: 'Upflare 0.1.0 is already installed as "upflare". Use update to upgrade it.',
    });
    expect(api.state.writes).toEqual([]);
  });

  test("workers.dev unreachable: setup resumes our own partial install", async () => {
    const seed = installedState();
    const script = seed.scripts?.upflare;
    if (script) script.secrets = { ENCRYPTION_KEY: "existing-key" };
    const api = createFakeApi({ ...seed, healthOverride: () => null });
    const result = await install(api, v010, baseOpts([]));
    expect(result.generatedPassword).toHaveLength(24);
    expect(result.warnings).toEqual([UNREACHABLE]);
  });

  test("workers.dev unreachable: update finds the install and finishes with a warning", async () => {
    const api = createFakeApi({ ...installedState({ source: "cloud" }), healthOverride: () => null });
    const result = await update(api, v010, updateOpts([], { source: "cli" }));
    expect(result.warnings).toEqual([UNREACHABLE.replace("Installed", "Updated")]);
    expect(api.state.scripts.upflare?.bindings).toContainEqual(sourceBinding("cloud"));
  });

  test("a worker without the source binding is foreign even if health claims Upflare", async () => {
    const api = createFakeApi({
      subdomain: "acme",
      scripts: { upflare: fakeScript({ version: "0.1.0", workersDev: true }) },
      healthOverride: () => ({ ok: true, version: "0.1.0", installSource: "cli" }),
    });
    expect((await caught(install(api, v010, baseOpts([])))).code).toBe("name_taken");
    expect((await caught(update(api, v010, updateOpts([])))).code).toBe("not_installed");
    expect(api.state.writes).toEqual([]);
  });

  test("a git install is git managed for update even when health is unreachable", async () => {
    const api = createFakeApi({ ...installedState({ source: "git" }), healthOverride: () => null });
    expect((await caught(update(api, v010, updateOpts([])))).code).toBe("git_managed");
    expect(api.state.writes).toEqual([]);
  });

  test("an install from before UPFLARE_VERSION (no version binding) still updates", async () => {
    const seed = installedState();
    const script = seed.scripts?.upflare;
    if (script) script.bindings = script.bindings.filter((b) => b.name !== "UPFLARE_VERSION");
    const api = createFakeApi(seed);
    const events: InstallEvent[] = [];
    await update(api, v010, updateOpts(events));
    expect(events.find((e) => e.step === "verify" && e.status === "done")).toMatchObject({ detail: "installed version unknown" });
    expect(api.state.scripts.upflare?.bindings).toContainEqual(versionBinding("0.1.0"));
  });
});

describe("final review: code downgrade guard (R18)", () => {
  const updateOpts = (events: InstallEvent[]) => {
    const { adminPassword: _a, subdomain: _s, ...rest } = baseOpts(events);
    return rest;
  };
  const NEWER_CODE = "This Upflare (v0.10.0) is newer than this installer (v0.9.0). Run bunx upflare@latest update.";
  const v090 = bundle("0.9.0", v010.migrations);

  test("update refuses installed code newer than the bundle, zero writes", async () => {
    const api = createFakeApi(installedState({ version: "0.10.0" }));
    expect(await caught(update(api, v090, updateOpts([])))).toEqual({ code: "api_error", message: NEWER_CODE });
    expect(api.state.writes).toEqual([]);
  });

  test("setup resume refuses installed code newer than the bundle, zero writes", async () => {
    const seed = installedState({ version: "0.10.0" });
    const script = seed.scripts?.upflare;
    if (script) script.secrets = {};
    const api = createFakeApi(seed);
    expect(await caught(install(api, v090, baseOpts([])))).toEqual({ code: "api_error", message: NEWER_CODE });
    expect(api.state.writes).toEqual([]);
  });

  test("same, older and prerelease-of-newer installed versions are allowed", async () => {
    for (const installed of ["0.9.0", "0.8.12", "0.9.0-beta.1"]) {
      const api = createFakeApi(installedState({ version: installed }));
      const result = await update(api, v090, updateOpts([]));
      expect(result.version).toBe("0.9.0");
    }
  });

  test("a prerelease bundle refuses its own final release", async () => {
    const api = createFakeApi(installedState({ version: "1.0.0" }));
    const err = await caught(update(api, bundle("1.0.0-rc.1", v010.migrations), updateOpts([])));
    expect(err.message).toBe(
      "This Upflare (v1.0.0) is newer than this installer (v1.0.0-rc.1). Run bunx upflare@latest update.",
    );
  });
});

describe("final review: token and password hooks (R15)", () => {
  test("verifyToken probes the chosen account", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    await install(api, v010, baseOpts([], { accountId: "acc-2" }));
    expect(api.state.verifiedAccounts).toEqual(["acc-2"]);
  });

  test("onGeneratedPassword fires right after the secret is set, before later steps", async () => {
    const api = createFakeApi({ subdomain: "acme" });
    const seen: { password: string; writesBefore: string[] }[] = [];
    const result = await install(
      api,
      v010,
      baseOpts([], {
        onGeneratedPassword: (password) =>
          seen.push({ password, writesBefore: api.state.writes.map((w) => w.method) }),
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.password).toBe(result.generatedPassword ?? "");
    expect(seen[0]?.writesBefore.at(-1)).toBe("putSecret");
    expect(seen[0]?.writesBefore).not.toContain("putSchedules");
  });

  test("onGeneratedPassword is not called for a given or an existing password", async () => {
    const calls: string[] = [];
    const given = createFakeApi({ subdomain: "acme" });
    await install(given, v010, baseOpts([], { adminPassword: "a-strong-password", onGeneratedPassword: (p) => calls.push(p) }));
    const existing = createFakeApi(installedState());
    const script = existing.state.scripts.upflare;
    if (script) delete script.secrets.ENCRYPTION_KEY;
    await install(existing, v010, baseOpts([], { onGeneratedPassword: (p) => calls.push(p) }));
    expect(calls).toEqual([]);
  });
});
