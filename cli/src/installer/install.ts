// Installer core: installs or updates Edgebeat through a CloudflareApi. Every step
// re-reads the account, so a run can resume from any point; every check that can
// refuse runs before the first write. Uses only Web APIs (runs in Bun, Node, Workers).
import {
  isInstallError,
  makeInstallError,
  type CloudflareApi,
  type InstallError,
  type InstallEvent,
  type InstallOptions,
  type InstallResult,
  type InstallStep,
  type ReleaseBundle,
  type InstallSource,
  type ScriptBinding,
  type ScriptInfo,
  INSTALL_SOURCE_BINDING,
  VERSION_BINDING,
} from "../contracts";
import { CREATE_MIGRATIONS_TABLE, SELECT_APPLIED, migrationBatch, pendingMigrations } from "./migrations";
import { generateEncryptionKey, generatePassword, isValidSlug, validateAdminPassword, validateName } from "./secrets";
import { compareVersions } from "./semver";

export type UpdateOptions = Omit<InstallOptions, "adminPassword" | "subdomain">;

// Free-plan Worker count; only a warning (R14): paid plans allow more, and the upload itself reports a real limit.
const WORKER_LIMIT = 100;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 90_000;
const GIT_MANAGED_MESSAGE = "This install is managed by its git repository. Pull upstream and redeploy to update.";

type Emit = (e: InstallEvent) => void;
type Outcome<T> = { value: T; status?: "done" | "skip"; detail?: string };

const toInstallError = (e: unknown): InstallError =>
  isInstallError(e)
    ? { code: e.code, message: e.message }
    : { code: "api_error", message: e instanceof Error ? e.message : String(e) };

const runStep = async <T>(emit: Emit, step: InstallStep, fn: () => Promise<Outcome<T>>): Promise<T> => {
  emit({ step, status: "start" });
  try {
    const out = await fn();
    emit(
      out.detail === undefined
        ? { step, status: out.status ?? "done" }
        : { step, status: out.status ?? "done", detail: out.detail },
    );
    return out.value;
  } catch (e) {
    emit({ step, status: "fail", error: toInstallError(e) });
    throw e;
  }
};

const origin = (name: string, subdomain: string): string => `https://${name}.${subdomain}.workers.dev`;
const healthUrl = (name: string, subdomain: string): string => `${origin(name, subdomain)}/api/v1/health`;

// Smoke check only (R13): never used to decide whether Edgebeat is installed.
const readHealth = async (api: CloudflareApi, url: string) => {
  try {
    return await api.fetchHealth(url);
  } catch {
    return null; // unreachable, e.g. an ISP that blocks *.workers.dev
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const checkToken = async (api: CloudflareApi, accountId: string): Promise<void> => {
  const v = await api.verifyToken(accountId);
  if (v.missing.length > 0) {
    throw makeInstallError(
      "missing_permission",
      `The API token is missing these permissions: ${v.missing.join(", ")}.`,
    );
  }
  if (!v.ok) throw makeInstallError("api_error", "The API token is not valid or not active.");
};

const nameTaken = (name: string): Error =>
  makeInstallError(
    "name_taken",
    `A Worker named "${name}" already exists in this account and is not an Edgebeat install. Choose another name.`,
  );

// Refuse to replace newer installed code with this bundle (R18). Unknown or non-semver versions pass.
const guardCodeDowngrade = (installed: string | undefined, bundle: ReleaseBundle): void => {
  const { version } = bundle.manifest;
  if (!installed || (compareVersions(installed, version) ?? 0) <= 0) return;
  throw makeInstallError(
    "api_error",
    `This Edgebeat (v${installed}) is newer than this installer (v${version}). Run bunx edgebeat@latest update.`,
  );
};

// The script exists: refuse unless it is our own install that stopped before its secrets were set.
// Identity comes from the script's bindings through the Cloudflare API, never from workers.dev (R13).
const checkExistingScript = async (
  api: CloudflareApi,
  opts: InstallOptions,
  info: ScriptInfo,
  bundle: ReleaseBundle,
): Promise<void> => {
  if (!info.installSource) throw nameTaken(opts.name);
  if (info.installSource === "git") {
    throw makeInstallError(
      "already_installed",
      `Edgebeat is already installed as "${opts.name}". ${GIT_MANAGED_MESSAGE}`,
    );
  }
  const secrets = await api.listSecretNames(opts.accountId, opts.name);
  if (secrets.includes("ENCRYPTION_KEY") && secrets.includes("ADMIN_PASSWORD")) {
    const version = info.version ? `Edgebeat ${info.version}` : "Edgebeat";
    throw makeInstallError("already_installed", `${version} is already installed as "${opts.name}". Use update to upgrade it.`);
  }
  guardCodeDowngrade(info.version, bundle);
};

const SELECT_TABLES = "SELECT name FROM sqlite_master WHERE type = 'table';";

// Reads only. `applied` is null when the database has no d1_migrations ledger.
const inspectDatabase = async (
  api: CloudflareApi,
  accountId: string,
  uuid: string,
): Promise<{ applied: string[] | null; userTables: string[] }> => {
  const tables = (await api.queryD1(accountId, uuid, SELECT_TABLES)).map((r) => String(r.name));
  const userTables = tables.filter((t) => t !== "d1_migrations" && !t.startsWith("sqlite_") && !t.startsWith("_cf_"));
  if (!tables.includes("d1_migrations")) return { applied: null, userTables };
  const applied = (await api.queryD1(accountId, uuid, SELECT_APPLIED)).map((r) => String(r.name));
  return { applied, userTables };
};

// Refuse to run older code against a schema this bundle does not know (R9).
const guardDowngrade = (applied: string[], bundle: ReleaseBundle): void => {
  const known = new Set(bundle.manifest.migrations);
  if (applied.every((n) => known.has(n))) return;
  const latest = [...applied].sort().at(-1) ?? "";
  throw makeInstallError(
    "api_error",
    `This Edgebeat (schema ${latest}) is newer than this installer (${bundle.manifest.version}). Use a newer edgebeat.`,
  );
};

// A D1 with our name is reused only if it is empty or holds an Edgebeat schema we can migrate.
const checkExistingDatabase = async (
  api: CloudflareApi,
  accountId: string,
  uuid: string,
  name: string,
  bundle: ReleaseBundle,
): Promise<void> => {
  const { applied, userTables } = await inspectDatabase(api, accountId, uuid);
  if (applied) return guardDowngrade(applied, bundle);
  if (userTables.length === 0) return;
  throw makeInstallError(
    "name_taken",
    `A D1 database named "${name}" already exists in this account and does not hold Edgebeat data. Choose another name.`,
  );
};

const databaseStep = async (
  api: CloudflareApi,
  accountId: string,
  name: string,
  bundle: ReleaseBundle | null, // set for update: re-check the schema before the first write
): Promise<Outcome<string>> => {
  const found = (await api.listD1(accountId)).find((d) => d.name === name);
  if (found) {
    if (bundle) {
      const { applied } = await inspectDatabase(api, accountId, found.uuid);
      if (applied) guardDowngrade(applied, bundle);
    }
    return { value: found.uuid, status: "skip", detail: `using D1 "${name}"` };
  }
  if (bundle) {
    throw makeInstallError(
      "not_installed",
      `The D1 database "${name}" of this install is missing. Run setup to repair it.`,
    );
  }
  const created = await api.createD1(accountId, name);
  return { value: created.uuid, detail: `created D1 "${name}"` };
};

const migrationsStep = async (
  api: CloudflareApi,
  accountId: string,
  uuid: string,
  bundle: ReleaseBundle,
): Promise<Outcome<void>> => {
  await api.queryD1(accountId, uuid, CREATE_MIGRATIONS_TABLE);
  const rows = await api.queryD1(accountId, uuid, SELECT_APPLIED);
  const pending = pendingMigrations(
    rows.map((r) => String(r.name)),
    bundle,
  );
  for (const m of pending) await api.queryD1(accountId, uuid, migrationBatch(m));
  if (pending.length === 0) return { value: undefined, status: "skip", detail: "database is up to date" };
  return { value: undefined, detail: `applied ${pending.map((m) => m.name).join(", ")}` };
};

const scriptStep = async (
  api: CloudflareApi,
  bundle: ReleaseBundle,
  opts: UpdateOptions,
  uuid: string,
  source: InstallSource,
): Promise<Outcome<void>> => {
  const assetsJwt = await api.uploadAssets(opts.accountId, opts.name, bundle.assets);
  const bindings: ScriptBinding[] = [
    { type: "d1", name: "DB", id: uuid },
    { type: "assets", name: "ASSETS" },
    { type: "plain_text", name: INSTALL_SOURCE_BINDING, text: source },
    { type: "plain_text", name: VERSION_BINDING, text: bundle.manifest.version },
  ];
  await api.putScript(opts.accountId, opts.name, {
    manifest: bundle.manifest,
    modules: bundle.modules,
    assetsJwt,
    bindings,
  });
  // Reachable right away, so a later failure (e.g. limit_cron) leaves an install that update can finish.
  await api.enableWorkersDev(opts.accountId, opts.name);
  return { value: undefined, detail: bundle.manifest.version };
};

// Polls health until the new version answers. A timeout is a warning, not a failure: everything is
// deployed by now, and workers.dev may just be blocked on this network (R13). Value = the warning.
const healthStep = async (
  api: CloudflareApi,
  name: string,
  subdomain: string,
  version: string,
  opts: UpdateOptions,
  done: "Installed" | "Updated",
): Promise<Outcome<string | null>> => {
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  const statusUrl = `${origin(name, subdomain)}/`;
  for (;;) {
    const health = await readHealth(api, healthUrl(name, subdomain));
    if (health?.version === version) return { value: null, detail: version };
    if (Date.now() + interval > deadline) {
      if (health?.version) {
        return {
          value: `${done}, but ${statusUrl} still answers with version ${health.version} instead of ${version}. It can take a minute to switch: reload it later.`,
          status: "skip",
          detail: `still ${health.version}`,
        };
      }
      return {
        value: `${done}, but workers.dev isn't reachable from this network — open ${statusUrl} in a browser or try another network.`,
        status: "skip",
        detail: "workers.dev not reachable from here",
      };
    }
    await sleep(interval);
  }
};

// Shared tail of install and update: code, schedule, route, smoke check.
const deployTail = async (
  api: CloudflareApi,
  bundle: ReleaseBundle,
  opts: UpdateOptions,
  uuid: string,
  subdomain: string,
  emit: Emit,
  source: InstallSource,
  warnings: string[],
  done: "Installed" | "Updated",
  secrets: () => Promise<string | null>,
): Promise<InstallResult> => {
  const { accountId, name } = opts;
  const { version } = bundle.manifest;
  await runStep(emit, "migrations", () => migrationsStep(api, accountId, uuid, bundle));
  await runStep(emit, "script", () => scriptStep(api, bundle, opts, uuid, source));
  const generatedPassword = await secrets();
  try {
    await runStep(emit, "schedule", async () => {
      await api.putSchedules(accountId, name, bundle.manifest.crons);
      return { value: undefined, detail: bundle.manifest.crons.join(", ") };
    });
    await runStep(emit, "route", async () => {
      await api.enableWorkersDev(accountId, name);
      return { value: undefined, detail: `${origin(name, subdomain)}/` };
    });
    const warning = await runStep(emit, "health", () => healthStep(api, name, subdomain, version, opts, done));
    if (warning) warnings.push(warning);
  } catch (e) {
    // A re-run keeps the existing secret, so this is the only chance to show the password.
    if (generatedPassword !== null && e instanceof Error) Object.assign(e, { generatedPassword });
    throw e;
  }
  return {
    statusUrl: `${origin(name, subdomain)}/`,
    adminUrl: `${origin(name, subdomain)}/admin`,
    version,
    generatedPassword,
    warnings,
  };
};

export const install = async (
  api: CloudflareApi,
  bundle: ReleaseBundle,
  opts: InstallOptions,
): Promise<InstallResult> => {
  const emit: Emit = opts.onEvent ?? (() => {});
  const { accountId, name } = opts;
  const warnings: string[] = [];

  await runStep(emit, "verify", async () => {
    validateName(name);
    if (opts.adminPassword !== undefined) validateAdminPassword(opts.adminPassword);
    await checkToken(api, accountId);
    return { value: undefined };
  });

  // No D1-count refusal (R14): createD1 maps a real limit to limit_d1, before anything else is written.
  await runStep(emit, "limits", async (): Promise<Outcome<void>> => {
    const [d1s, info] = await Promise.all([api.listD1(accountId), api.getScriptInfo(accountId, name)]);
    let warning: string | undefined;
    if (info) {
      await checkExistingScript(api, opts, info, bundle);
    } else {
      const workers = await api.countWorkers(accountId);
      if (workers >= WORKER_LIMIT) {
        warning = `This account already has ${workers} Workers, the free plan limit is ${WORKER_LIMIT}. The upload may be refused.`;
        warnings.push(warning);
      }
    }
    const db = d1s.find((d) => d.name === name);
    if (db) await checkExistingDatabase(api, accountId, db.uuid, name, bundle);
    return warning === undefined ? { value: undefined } : { value: undefined, detail: warning };
  });

  const subdomain = await runStep(emit, "subdomain", async (): Promise<Outcome<string>> => {
    const current = await api.getSubdomain(accountId);
    if (current) return { value: current, status: "skip", detail: `${current}.workers.dev` };
    if (opts.subdomain === undefined) {
      throw makeInstallError(
        "no_subdomain",
        "This account has no workers.dev subdomain yet. Choose one (lowercase letters, digits, hyphens) and run setup again.",
      );
    }
    if (!isValidSlug(opts.subdomain)) {
      throw makeInstallError(
        "invalid_name",
        "Subdomain must be 1 to 63 characters of lowercase letters, digits and hyphens.",
      );
    }
    await api.createSubdomain(accountId, opts.subdomain);
    return { value: opts.subdomain, detail: `${opts.subdomain}.workers.dev` };
  });

  const uuid = await runStep(emit, "database", () => databaseStep(api, accountId, name, null));

  return deployTail(api, bundle, opts, uuid, subdomain, emit, opts.source, warnings, "Installed", () =>
    runStep(emit, "secrets", async (): Promise<Outcome<string | null>> => {
      const present = await api.listSecretNames(accountId, name);
      const set: string[] = [];
      if (!present.includes("ENCRYPTION_KEY")) {
        await api.putSecret(accountId, name, "ENCRYPTION_KEY", generateEncryptionKey());
        set.push("ENCRYPTION_KEY");
      }
      const generated =
        present.includes("ADMIN_PASSWORD") || opts.adminPassword !== undefined ? null : generatePassword();
      const notes: string[] = [];
      if (!present.includes("ADMIN_PASSWORD")) {
        await api.putSecret(accountId, name, "ADMIN_PASSWORD", opts.adminPassword ?? generated ?? "");
        set.push("ADMIN_PASSWORD");
        // Hand the password over now: a re-run keeps this secret, so a later failure must not lose it (R15).
        if (generated !== null) opts.onGeneratedPassword?.(generated);
      } else if (opts.adminPassword !== undefined) {
        notes.push("admin password already set — kept");
      }
      if (set.length > 0) notes.unshift(`set ${set.join(", ")}`);
      if (notes.length === 0) return { value: null, status: "skip", detail: "secrets already set" };
      return { value: generated, detail: notes.join("; ") };
    }),
  );
};

export const update = async (
  api: CloudflareApi,
  bundle: ReleaseBundle,
  opts: UpdateOptions,
): Promise<InstallResult> => {
  const emit: Emit = opts.onEvent ?? (() => {});
  const { accountId, name } = opts;

  const found = await runStep(
    emit,
    "verify",
    async (): Promise<Outcome<{ subdomain: string; source: InstallSource }>> => {
      validateName(name);
      await checkToken(api, accountId);
      const notInstalled = makeInstallError(
        "not_installed",
        `No Edgebeat install named "${name}" was found in this account.`,
      );
      // Identity from the Cloudflare API, not workers.dev (R13).
      const [info, current] = await Promise.all([api.getScriptInfo(accountId, name), api.getSubdomain(accountId)]);
      if (!info?.installSource || !current) throw notInstalled;
      if (info.installSource === "git") throw makeInstallError("git_managed", GIT_MANAGED_MESSAGE);
      guardCodeDowngrade(info.version, bundle);
      // Keep the recorded source (R10): a CLI update of a cloud install stays "cloud".
      return {
        value: { subdomain: current, source: info.installSource },
        detail: `installed ${info.version ?? "version unknown"}`,
      };
    },
  );

  const uuid = await runStep(emit, "database", () => databaseStep(api, accountId, name, bundle));

  return deployTail(api, bundle, opts, uuid, found.subdomain, emit, found.source, [], "Updated", async () => null);
};
