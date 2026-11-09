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
} from "../contracts";
import { CREATE_MIGRATIONS_TABLE, SELECT_APPLIED, migrationBatch, pendingMigrations } from "./migrations";
import { generateEncryptionKey, generatePassword, isValidSlug, validateAdminPassword, validateName } from "./secrets";

export type UpdateOptions = Omit<InstallOptions, "adminPassword" | "subdomain">;

const D1_LIMIT = 10;
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

const readHealth = async (api: CloudflareApi, url: string) => {
  try {
    return await api.fetchHealth(url);
  } catch {
    return null; // unreachable counts as "no Edgebeat here"
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const checkToken = async (api: CloudflareApi): Promise<void> => {
  const v = await api.verifyToken();
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

// The script exists: refuse unless it is our own install that stopped before its secrets were set.
const checkExistingScript = async (
  api: CloudflareApi,
  opts: InstallOptions,
  subdomain: string | null,
): Promise<void> => {
  if (!subdomain) throw nameTaken(opts.name);
  const health = await readHealth(api, healthUrl(opts.name, subdomain));
  if (!health?.version) throw nameTaken(opts.name);
  if (health.installSource === "git") {
    throw makeInstallError(
      "already_installed",
      `Edgebeat is already installed as "${opts.name}". ${GIT_MANAGED_MESSAGE}`,
    );
  }
  const secrets = await api.listSecretNames(opts.accountId, opts.name);
  if (secrets.includes("ENCRYPTION_KEY") && secrets.includes("ADMIN_PASSWORD")) {
    throw makeInstallError(
      "already_installed",
      `Edgebeat ${health.version} is already installed as "${opts.name}". Use update to upgrade it.`,
    );
  }
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
    { type: "plain_text", name: "EDGEBEAT_INSTALL_SOURCE", text: source },
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

const healthStep = async (
  api: CloudflareApi,
  url: string,
  version: string,
  opts: UpdateOptions,
): Promise<Outcome<void>> => {
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  for (;;) {
    const health = await readHealth(api, url);
    if (health?.version === version) return { value: undefined, detail: version };
    if (Date.now() + interval > deadline) {
      throw makeInstallError(
        "health_failed",
        `Edgebeat did not answer with version ${version} at ${url} within ${Math.round(timeout / 1000)} s.`,
      );
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
    await runStep(emit, "health", () => healthStep(api, healthUrl(name, subdomain), version, opts));
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
  };
};

export const install = async (
  api: CloudflareApi,
  bundle: ReleaseBundle,
  opts: InstallOptions,
): Promise<InstallResult> => {
  const emit: Emit = opts.onEvent ?? (() => {});
  const { accountId, name } = opts;

  await runStep(emit, "verify", async () => {
    validateName(name);
    if (opts.adminPassword !== undefined) validateAdminPassword(opts.adminPassword);
    await checkToken(api);
    return { value: undefined };
  });

  await runStep(emit, "limits", async () => {
    const [d1s, exists, subdomain] = await Promise.all([
      api.listD1(accountId),
      api.scriptExists(accountId, name),
      api.getSubdomain(accountId),
    ]);
    if (!d1s.some((d) => d.name === name) && d1s.length >= D1_LIMIT) {
      throw makeInstallError(
        "limit_d1",
        `This account already has ${d1s.length} D1 databases, the free plan limit is ${D1_LIMIT}. Delete one or upgrade the plan.`,
      );
    }
    if (!exists) {
      const workers = await api.countWorkers(accountId);
      if (workers >= WORKER_LIMIT) {
        throw makeInstallError(
          "limit_workers",
          `This account already has ${workers} Workers, the free plan limit is ${WORKER_LIMIT}. Delete one or upgrade the plan.`,
        );
      }
    }
    if (exists) await checkExistingScript(api, opts, subdomain);
    const db = d1s.find((d) => d.name === name);
    if (db) await checkExistingDatabase(api, accountId, db.uuid, name, bundle);
    return { value: undefined };
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

  return deployTail(api, bundle, opts, uuid, subdomain, emit, opts.source, () =>
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
      await checkToken(api);
      const notInstalled = makeInstallError(
        "not_installed",
        `No Edgebeat install named "${name}" was found in this account.`,
      );
      const [exists, current] = await Promise.all([api.scriptExists(accountId, name), api.getSubdomain(accountId)]);
      if (!exists || !current) throw notInstalled;
      const health = await readHealth(api, healthUrl(name, current));
      if (!health?.version) throw notInstalled;
      if (health.installSource === "git") throw makeInstallError("git_managed", GIT_MANAGED_MESSAGE);
      // Keep the recorded source (R10): a CLI update of a cloud install stays "cloud".
      const source = health.installSource ?? opts.source;
      return { value: { subdomain: current, source }, detail: `installed ${health.version}` };
    },
  );

  const uuid = await runStep(emit, "database", () => databaseStep(api, accountId, name, bundle));

  return deployTail(api, bundle, opts, uuid, found.subdomain, emit, found.source, async () => null);
};
