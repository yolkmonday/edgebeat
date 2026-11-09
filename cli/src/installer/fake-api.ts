// In-memory CloudflareApi for tests. Every call that would change the account is
// recorded in `state.writes`; reads (including SELECT queries) are not.
import {
  INSTALL_SOURCE_BINDING,
  makeInstallError,
  VERSION_BINDING,
  type Account,
  type CloudflareApi,
  type InstallSource,
  type ReleaseManifest,
  type ScriptBinding,
  type ScriptInfo,
} from "../contracts";

export type FakeScript = {
  version: string | null; // code version health answers with; null = a foreign (non-Edgebeat) worker
  bindings: ScriptBinding[];
  secrets: Record<string, string>;
  crons: string[];
  workersDev: boolean;
  modules: string[];
  assetsJwt: string | null;
};

export type FakeD1 = {
  uuid: string;
  name: string;
  migrations: string[] | null; // rows of d1_migrations; null = table absent
  executed: string[]; // every non-SELECT sql run against this database
  tables?: string[]; // other tables in sqlite_master (d1_migrations is derived from `migrations`)
};

export type FakeWrite = { method: string; args: unknown[] };

export type HealthAnswer = { ok: boolean; version?: string; installSource?: InstallSource } | null;

export type FakeState = {
  verify: { ok: boolean; missing: string[] };
  verifiedAccounts: (string | undefined)[]; // accountId of every verifyToken call
  accounts: Account[];
  subdomain: string | null;
  otherWorkers: number; // workers in the account besides `scripts`
  scripts: Record<string, FakeScript>;
  d1: FakeD1[];
  writes: FakeWrite[];
  healthOverride: ((url: string) => HealthAnswer) | null;
};

const MIGRATION_INSERT = /INSERT INTO d1_migrations \(name\) VALUES \('((?:[^']|'')*)'\)/gi;

const isRead = (sql: string): boolean => /^\s*(SELECT|PRAGMA)\b/i.test(sql);

const plainText = (bindings: ScriptBinding[], name: string): string | undefined => {
  const b = bindings.find((x) => x.type === "plain_text" && x.name === name);
  return b?.type === "plain_text" ? b.text : undefined;
};
const sourceOf = (bindings: ScriptBinding[]): InstallSource | undefined =>
  plainText(bindings, INSTALL_SOURCE_BINDING) as InstallSource | undefined;

export const fakeScript = (over: Partial<FakeScript> = {}): FakeScript => ({
  version: null,
  bindings: [],
  secrets: {},
  crons: [],
  workersDev: false,
  modules: [],
  assetsJwt: null,
  ...over,
});

export const createFakeApi = (seed: Partial<FakeState> = {}): CloudflareApi & { state: FakeState } => {
  const state: FakeState = {
    verify: { ok: true, missing: [] },
    verifiedAccounts: [],
    accounts: [{ id: "acc", name: "Account" }],
    subdomain: null,
    otherWorkers: 0,
    scripts: {},
    d1: [],
    writes: [],
    healthOverride: null,
    ...seed,
  };
  const write = (method: string, ...args: unknown[]): void => {
    state.writes.push({ method, args });
  };
  const script = (name: string): FakeScript => {
    const s = state.scripts[name];
    if (!s) throw makeInstallError("api_error", `fake: script ${name} not found`);
    return s;
  };
  const db = (uuid: string): FakeD1 => {
    const d = state.d1.find((x) => x.uuid === uuid);
    if (!d) throw makeInstallError("api_error", `fake: d1 ${uuid} not found`);
    return d;
  };

  const queryD1 = async (_accountId: string, uuid: string, sql: string): Promise<Record<string, unknown>[]> => {
    const d = db(uuid);
    if (isRead(sql)) {
      if (/\bsqlite_master\b/.test(sql)) {
        const tables = [...(d.migrations === null ? [] : ["d1_migrations"]), ...(d.tables ?? [])];
        return tables.map((name) => ({ name }));
      }
      if (!/\bd1_migrations\b/.test(sql)) return [];
      if (d.migrations === null) throw makeInstallError("api_error", "fake: no such table: d1_migrations");
      return d.migrations.map((name) => ({ name }));
    }
    write("queryD1", uuid, sql);
    d.executed.push(sql);
    if (/CREATE TABLE IF NOT EXISTS d1_migrations/i.test(sql)) {
      d.migrations ??= [];
      return [];
    }
    for (const m of sql.matchAll(MIGRATION_INSERT)) {
      if (d.migrations === null) throw makeInstallError("api_error", "fake: no such table: d1_migrations");
      d.migrations.push((m[1] ?? "").replaceAll("''", "'"));
    }
    return [];
  };

  return {
    state,
    verifyToken: async (accountId) => {
      state.verifiedAccounts.push(accountId);
      return state.verify;
    },
    listAccounts: async () => state.accounts,
    getSubdomain: async () => state.subdomain,
    createSubdomain: async (accountId, subdomain) => {
      write("createSubdomain", accountId, subdomain);
      state.subdomain = subdomain;
    },
    countWorkers: async () => state.otherWorkers + Object.keys(state.scripts).length,
    scriptExists: async (_accountId, name) => name in state.scripts,
    // Mirrors GET …/scripts/{name}/settings: identity comes from bindings only, never from health.
    getScriptInfo: async (_accountId, name) => {
      const s = state.scripts[name];
      if (!s) return null;
      const info: ScriptInfo = {};
      const source = sourceOf(s.bindings);
      if (source) info.installSource = source;
      const version = plainText(s.bindings, VERSION_BINDING);
      if (version) info.version = version;
      return info;
    },
    listD1: async () => state.d1.map(({ uuid, name }) => ({ uuid, name })),
    createD1: async (accountId, name) => {
      write("createD1", accountId, name);
      const d: FakeD1 = { uuid: `uuid-${name}-${state.d1.length}`, name, migrations: null, executed: [] };
      state.d1.push(d);
      return { uuid: d.uuid, name };
    },
    queryD1,
    uploadAssets: async (accountId, scriptName, assets) => {
      write("uploadAssets", accountId, scriptName, Object.keys(assets));
      return `jwt-${scriptName}`;
    },
    putScript: async (
      accountId,
      name,
      input: {
        manifest: ReleaseManifest;
        modules: Record<string, Uint8Array>;
        assetsJwt: string;
        bindings: ScriptBinding[];
      },
    ) => {
      write("putScript", accountId, name, { version: input.manifest.version, bindings: input.bindings });
      // Mirrors keep_bindings ["secret_text"]: secrets survive an upload.
      const prev = state.scripts[name];
      state.scripts[name] = fakeScript({
        version: input.manifest.version,
        bindings: input.bindings,
        secrets: prev?.secrets ?? {},
        crons: prev?.crons ?? [],
        workersDev: prev?.workersDev ?? false,
        modules: Object.keys(input.modules),
        assetsJwt: input.assetsJwt,
      });
    },
    listSecretNames: async (_accountId, scriptName) => Object.keys(script(scriptName).secrets),
    putSecret: async (accountId, scriptName, name, value) => {
      write("putSecret", accountId, scriptName, name);
      script(scriptName).secrets[name] = value;
    },
    putSchedules: async (accountId, scriptName, crons) => {
      write("putSchedules", accountId, scriptName, crons);
      script(scriptName).crons = [...crons];
    },
    enableWorkersDev: async (accountId, scriptName) => {
      write("enableWorkersDev", accountId, scriptName);
      script(scriptName).workersDev = true;
    },
    fetchHealth: async (url) => {
      if (state.healthOverride) return state.healthOverride(url);
      const m = /^https:\/\/([a-z0-9-]+)\.([a-z0-9-]+)\.workers\.dev\/api\/v1\/health$/.exec(url);
      if (!m || m[2] !== state.subdomain) return null;
      const s = state.scripts[m[1] ?? ""];
      if (!s || !s.workersDev || s.version === null) return null;
      return { ok: true, version: s.version, installSource: sourceOf(s.bindings) };
    },
  };
};
