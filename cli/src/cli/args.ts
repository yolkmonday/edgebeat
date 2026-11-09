export type Command = "setup" | "update" | "help" | "version";

export type Args = {
  command: Command;
  apiToken?: string;
  account?: string;
  name: string;
  adminPassword?: string;
  subdomain?: string;
  yes: boolean;
};

export type ParseResult = { ok: true; args: Args } | { ok: false; error: string };

const VALUE_FLAGS = {
  "--api-token": "apiToken",
  "--account": "account",
  "--name": "name",
  "--admin-password": "adminPassword",
  "--subdomain": "subdomain",
} as const;

export const VALID_FLAGS = [...Object.keys(VALUE_FLAGS), "--yes", "--version", "--help"];

export const USAGE = `Usage: edgebeat <command> [flags]

Commands:
  setup      Install Edgebeat on your Cloudflare account
  update     Update an existing install (secrets and data are kept)
  help       Show this help
  --version  Print the CLI version

Flags:
  --api-token <token>      Cloudflare API token. Prefer CLOUDFLARE_API_TOKEN: flags
                           are visible in ps and shell history
  --account <id>           Cloudflare account id (asked when you have several)
  --name <name>            Worker and database name (default: edgebeat)
  --admin-password <p>     setup only: admin password, at least 12 characters
                           (generated if empty)
  --subdomain <s>          setup only: workers.dev subdomain, used only if the
                           account has none
  --yes                    Non-interactive: never ask questions`;

export const parseArgs = (argv: string[]): ParseResult => {
  const values: Record<string, string> = {};
  let command: Command | undefined;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("-")) {
      if (command) return { ok: false, error: `Unexpected argument "${raw}".` };
      if (raw !== "setup" && raw !== "update" && raw !== "help") {
        return { ok: false, error: `Unknown command "${raw}". Commands: setup, update, help.` };
      }
      command = raw;
      continue;
    }

    const eq = raw.indexOf("=");
    const flag = eq === -1 ? raw : raw.slice(0, eq);
    const inline = eq === -1 ? undefined : raw.slice(eq + 1);

    if (flag === "--yes") {
      yes = true;
      continue;
    }
    if (flag === "--version" || flag === "-v") {
      command = "version";
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      command = "help";
      continue;
    }
    if (!(flag in VALUE_FLAGS)) {
      return { ok: false, error: `Unknown flag "${flag}". Valid flags: ${VALID_FLAGS.join(", ")}.` };
    }
    const value = inline ?? argv[++i];
    if (value === undefined) return { ok: false, error: `Flag ${flag} needs a value.` };
    values[VALUE_FLAGS[flag as keyof typeof VALUE_FLAGS]] = value;
  }

  return {
    ok: true,
    args: {
      command: command ?? "help",
      apiToken: values.apiToken,
      account: values.account,
      name: values.name ?? "edgebeat",
      adminPassword: values.adminPassword,
      subdomain: values.subdomain,
      yes,
    },
  };
};
