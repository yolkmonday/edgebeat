export type InstallSource = "cli" | "cloud" | "git";

export type ReleaseManifest = {
  version: string; // = root package.json version
  compatibilityDate: string;
  compatibilityFlags: string[];
  mainModule: string; // file name inside worker/
  modules: { name: string; contentType: string }[]; // every file in worker/ incl. mainModule
  crons: string[]; // ["* * * * *"]
  assetsConfig: { run_worker_first: string[]; html_handling?: string; not_found_handling?: string };
  migrations: string[]; // file names, ordered
  observability: boolean;
};

export type ReleaseBundle = {
  manifest: ReleaseManifest;
  modules: Record<string, Uint8Array>; // worker/ files by name
  assets: Record<string, Uint8Array>; // key = "/index.html" style path
  migrations: { name: string; sql: string }[];
};

export type Account = { id: string; name: string };
export type D1Info = { uuid: string; name: string };
export type ScriptBinding =
  | { type: "d1"; name: string; id: string }
  | { type: "assets"; name: string }
  | { type: "plain_text"; name: string; text: string };

// Plain-text Worker variables that identify an Edgebeat install through the Cloudflare API (R13).
export const INSTALL_SOURCE_BINDING = "EDGEBEAT_INSTALL_SOURCE";
export const VERSION_BINDING = "EDGEBEAT_VERSION";

// Read from the script's settings bindings; a field is absent when its binding is missing or unknown.
export type ScriptInfo = { installSource?: InstallSource; version?: string };

export type CloudflareApi = {
  // missing = permission labels from Global Constraints; probes `accountId` when given, else the first account.
  verifyToken(accountId?: string): Promise<{ ok: boolean; missing: string[] }>;
  listAccounts(): Promise<Account[]>;
  getSubdomain(accountId: string): Promise<string | null>;
  createSubdomain(accountId: string, subdomain: string): Promise<void>;
  countWorkers(accountId: string): Promise<number>;
  scriptExists(accountId: string, name: string): Promise<boolean>;
  getScriptInfo(accountId: string, name: string): Promise<ScriptInfo | null>; // null = no script with that name
  listD1(accountId: string): Promise<D1Info[]>;
  createD1(accountId: string, name: string): Promise<D1Info>;
  queryD1(accountId: string, uuid: string, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  uploadAssets(accountId: string, scriptName: string, assets: Record<string, Uint8Array>): Promise<string>; // completion jwt
  putScript(
    accountId: string,
    name: string,
    input: {
      manifest: ReleaseManifest;
      modules: Record<string, Uint8Array>;
      assetsJwt: string;
      bindings: ScriptBinding[];
    },
  ): Promise<void>; // must send keep_bindings ["secret_text"]
  listSecretNames(accountId: string, scriptName: string): Promise<string[]>;
  putSecret(accountId: string, scriptName: string, name: string, value: string): Promise<void>;
  putSchedules(accountId: string, scriptName: string, crons: string[]): Promise<void>;
  enableWorkersDev(accountId: string, scriptName: string): Promise<void>;
  fetchHealth(url: string): Promise<{ ok: boolean; version?: string; installSource?: InstallSource } | null>;
};

export type InstallErrorCode =
  | "missing_permission"
  | "no_subdomain"
  | "limit_workers"
  | "limit_d1"
  | "limit_cron"
  | "name_taken"
  | "already_installed"
  | "not_installed"
  | "git_managed"
  | "weak_password"
  | "invalid_name"
  | "health_failed"
  | "api_error";

// Thrown as a plain Error carrying `code`; build with makeInstallError.
export type InstallError = { code: InstallErrorCode; message: string };

export type InstallStep =
  | "verify"
  | "limits"
  | "subdomain"
  | "database"
  | "migrations"
  | "script"
  | "secrets"
  | "schedule"
  | "route"
  | "health";
export type InstallEvent =
  | { step: InstallStep; status: "start" | "done" | "skip"; detail?: string }
  | { step: InstallStep; status: "fail"; error: InstallError };

export type InstallOptions = {
  accountId: string;
  name: string; // worker + D1 name
  source: InstallSource;
  adminPassword?: string; // undefined → generate if absent
  subdomain?: string; // used only if the account has none
  onEvent?: (e: InstallEvent) => void;
  pollIntervalMs?: number; // health poll, default 3000
  pollTimeoutMs?: number; // health poll, default 90000
};
export type InstallResult = {
  statusUrl: string;
  adminUrl: string; // https://<name>.<sub>.workers.dev/ and …/admin
  version: string;
  generatedPassword: string | null; // non-null only if generated this run
};

const INSTALL_ERROR_CODES: readonly string[] = [
  "missing_permission",
  "no_subdomain",
  "limit_workers",
  "limit_d1",
  "limit_cron",
  "name_taken",
  "already_installed",
  "not_installed",
  "git_managed",
  "weak_password",
  "invalid_name",
  "health_failed",
  "api_error",
] satisfies InstallErrorCode[];

export const makeInstallError = (code: InstallErrorCode, message: string): Error & { code: InstallErrorCode } =>
  Object.assign(new Error(message), { code });

export const isInstallError = (e: unknown): e is Error & { code: InstallErrorCode } => {
  if (!(e instanceof Error)) return false;
  const code = (e as Error & { code?: unknown }).code;
  return typeof code === "string" && INSTALL_ERROR_CODES.includes(code);
};
