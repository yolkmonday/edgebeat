import {
  isInstallError,
  type Account,
  type CloudflareApi,
  type InstallOptions,
  type InstallResult,
  type ReleaseBundle,
} from "../contracts";
import { parseArgs, USAGE, type Args } from "./args";
import { createChecklist, makeColors } from "./checklist";

export type Io = {
  prompt(q: string, opts?: { secret?: boolean }): Promise<string>;
  print(line: string): void;
  isTTY: boolean;
  env: Record<string, string | undefined>;
};

// Mirrors the Task 4 installer exports; injected so run.ts has no hard import of them.
export type Installer = {
  install(api: CloudflareApi, bundle: ReleaseBundle, opts: InstallOptions): Promise<InstallResult>;
  update(
    api: CloudflareApi,
    bundle: ReleaseBundle,
    opts: Omit<InstallOptions, "adminPassword" | "subdomain">,
  ): Promise<InstallResult>;
  validateAdminPassword(p: string): void;
  validateName(n: string): void;
};

export type Deps = {
  api: (token: string) => CloudflareApi;
  bundle: () => Promise<ReleaseBundle>;
  io: Io;
  installer: Installer;
  version?: string;
};

const TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";
const PERMISSIONS = [
  "Account · Workers Scripts · Edit",
  "Account · D1 · Edit",
  "Account · Account Settings · Read",
];
const GIT_MANAGED_COPY = "This install is managed by its git repository. Pull upstream and redeploy to update.";
const PASSWORD_ATTEMPTS = 5;
const SUBDOMAIN_ATTEMPTS = 3;

// Thrown for user-input problems; mapped to exit code 2.
const usageError = (message: string): Error & { usage: true } => Object.assign(new Error(message), { usage: true as const });

const isUsageError = (e: unknown): e is Error & { usage: true } =>
  e instanceof Error && (e as Error & { usage?: unknown }).usage === true;

const resolveToken = async (args: Args, io: Io): Promise<string> => {
  const given = args.apiToken ?? io.env.CLOUDFLARE_API_TOKEN;
  if (given) return given;
  if (args.yes) {
    throw usageError("No API token. Pass --api-token or set CLOUDFLARE_API_TOKEN (required with --yes).");
  }
  io.print("Edgebeat needs a Cloudflare API token with these permissions:");
  PERMISSIONS.forEach((p) => io.print(`  - ${p}`));
  io.print(`Create one at ${TOKEN_URL}`);
  const token = await io.prompt("Paste your API token (input is hidden): ", { secret: true });
  if (!token) throw usageError("No API token entered.");
  return token;
};

const resolveAccount = async (args: Args, io: Io, api: CloudflareApi): Promise<string> => {
  const accounts: Account[] = await api.listAccounts();
  if (args.account) return args.account;
  if (accounts.length === 0) throw new Error("This token cannot see any Cloudflare account.");
  if (accounts.length === 1) return accounts[0].id;
  if (args.yes) {
    const ids = accounts.map((a) => `${a.name} (${a.id})`).join(", ");
    throw usageError(`Several accounts found: ${ids}. Pass --account <id>.`);
  }
  io.print("Several Cloudflare accounts found:");
  accounts.forEach((a, i) => io.print(`  ${i + 1}) ${a.name} (${a.id})`));
  const answer = await io.prompt(`Pick an account [1-${accounts.length}]: `);
  const picked = accounts[Number(answer) - 1];
  if (!picked) throw usageError(`"${answer}" is not a valid choice.`);
  return picked.id;
};

const resolvePassword = async (args: Args, io: Io, installer: Installer): Promise<string | undefined> => {
  if (args.adminPassword !== undefined) {
    try {
      installer.validateAdminPassword(args.adminPassword);
    } catch (e) {
      throw usageError(e instanceof Error ? e.message : String(e));
    }
    return args.adminPassword;
  }
  if (args.yes) return undefined;
  for (let attempt = 0; attempt < PASSWORD_ATTEMPTS; attempt++) {
    const answer = await io.prompt("Choose an admin password (leave empty to generate): ", { secret: true });
    if (!answer) return undefined;
    try {
      installer.validateAdminPassword(answer);
      return answer;
    } catch (e) {
      io.print(e instanceof Error ? e.message : String(e));
    }
  }
  throw usageError("Too many invalid passwords.");
};

const printResult = (io: Io, result: InstallResult): void => {
  const c = makeColors(io.isTTY);
  io.print("");
  io.print(c.bold(`Edgebeat ${result.version} is ready.`));
  io.print(`Status page: ${result.statusUrl}`);
  io.print(`Admin:       ${result.adminUrl}`);
  if (result.generatedPassword) io.print(`Admin password (shown once): ${result.generatedPassword}`);
};

const installWithRetry = async (
  deps: Deps,
  args: Args,
  api: CloudflareApi,
  bundle: ReleaseBundle,
  accountId: string,
  adminPassword: string | undefined,
  base: Pick<InstallOptions, "name" | "source" | "onEvent">,
  onRetry: () => void,
): Promise<InstallResult> => {
  const { io, installer } = deps;
  let subdomain = args.subdomain;
  for (let attempt = 0; ; attempt++) {
    try {
      return await installer.install(api, bundle, { ...base, accountId, adminPassword, subdomain });
    } catch (e) {
      const needsSubdomain = isInstallError(e) && e.code === "no_subdomain";
      if (!needsSubdomain || args.yes || attempt >= SUBDOMAIN_ATTEMPTS) throw e;
      onRetry();
      subdomain = await io.prompt("Your account has no workers.dev subdomain yet. Choose one: ");
      if (!subdomain) throw e;
    }
  }
};

export const run = async (argv: string[], deps: Deps): Promise<number> => {
  const { io, installer } = deps;
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    io.print(parsed.error);
    io.print("");
    io.print(USAGE);
    return 2;
  }
  const { args } = parsed;

  if (args.command === "version") {
    io.print(deps.version ?? "unknown");
    return 0;
  }
  if (args.command === "help") {
    io.print(USAGE);
    return 0;
  }

  const c = makeColors(io.isTTY);
  const checklist = createChecklist((l) => io.print(l), io.isTTY);

  try {
    try {
      installer.validateName(args.name);
    } catch (e) {
      throw usageError(e instanceof Error ? e.message : String(e));
    }

    const token = await resolveToken(args, io);
    const api = deps.api(token);
    const accountId = await resolveAccount(args, io, api);
    const base = { name: args.name, source: "cli" as const, onEvent: checklist.onEvent };

    if (args.command === "update") {
      const bundle = await deps.bundle();
      printResult(io, await installer.update(api, bundle, { accountId, ...base }));
      return 0;
    }

    const adminPassword = await resolvePassword(args, io, installer);
    const bundle = await deps.bundle();
    const result = await installWithRetry(deps, args, api, bundle, accountId, adminPassword, base, () =>
      checklist.resetFailure(),
    );
    printResult(io, result);
    return 0;
  } catch (e) {
    if (isUsageError(e)) {
      io.print(`${c.red("✗")} ${e.message}`);
      return 2;
    }
    if (isInstallError(e) && e.code === "git_managed") {
      io.print(`${c.red("✗")} ${GIT_MANAGED_COPY}`);
      return 1;
    }
    if (!checklist.hasFailure()) {
      io.print(`${c.red("✗")} ${e instanceof Error ? e.message : String(e)}`);
    }
    return 1;
  }
};
