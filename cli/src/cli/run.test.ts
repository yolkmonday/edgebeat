import { describe, expect, test } from "bun:test";
import {
  makeInstallError,
  type CloudflareApi,
  type InstallOptions,
  type InstallResult,
  type ReleaseBundle,
} from "../contracts";
import { run, type Deps, type Io } from "./run";

const GIT_COPY = "This install is managed by its git repository. Pull upstream and redeploy to update.";
const STRONG = "a-strong-password-1";

const RESULT: InstallResult = {
  statusUrl: "https://edgebeat.me.workers.dev/",
  adminUrl: "https://edgebeat.me.workers.dev/admin",
  version: "0.1.0",
  generatedPassword: null,
};

type Harness = {
  deps: Deps;
  out: string[];
  prompts: string[];
  installCalls: InstallOptions[];
  updateCalls: unknown[];
  tokens: string[];
};

const makeHarness = (opts: {
  answers?: string[];
  env?: Record<string, string | undefined>;
  accounts?: { id: string; name: string }[];
  install?: (o: InstallOptions, call: number) => Promise<InstallResult>;
  update?: () => Promise<InstallResult>;
}): Harness => {
  const out: string[] = [];
  const prompts: string[] = [];
  const installCalls: InstallOptions[] = [];
  const updateCalls: unknown[] = [];
  const tokens: string[] = [];
  const answers = [...(opts.answers ?? [])];
  const accounts = opts.accounts ?? [{ id: "acc1", name: "Main" }];

  const io: Io = {
    prompt: async (q) => {
      prompts.push(q);
      return answers.shift() ?? "";
    },
    print: (line) => out.push(line),
    isTTY: false,
    env: opts.env ?? {},
  };

  const deps: Deps = {
    api: (token) => {
      tokens.push(token);
      return { listAccounts: async () => accounts } as unknown as CloudflareApi;
    },
    bundle: async () => ({}) as ReleaseBundle,
    io,
    version: "9.9.9",
    installer: {
      install: async (_api, _bundle, o) => {
        installCalls.push(o);
        o.onEvent?.({ step: "database", status: "done" });
        return opts.install ? opts.install(o, installCalls.length) : RESULT;
      },
      update: async () => {
        updateCalls.push(true);
        if (opts.update) return opts.update();
        return RESULT;
      },
      validateAdminPassword: (p) => {
        if (p.length < 12 || p === "change-me") throw makeInstallError("weak_password", "weak");
      },
      validateName: (n) => {
        if (!/^[a-z0-9-]{1,63}$/.test(n)) throw makeInstallError("invalid_name", "bad name");
      },
    },
  };
  return { deps, out, prompts, installCalls, updateCalls, tokens };
};

const text = (h: Harness) => h.out.join("\n");

describe("run", () => {
  test("token from env is used without prompting", async () => {
    const h = makeHarness({ env: { CLOUDFLARE_API_TOKEN: "env-token" } });
    const code = await run(["setup", "--yes", "--admin-password", STRONG], h.deps);
    expect(code).toBe(0);
    expect(h.tokens.every((t) => t === "env-token")).toBe(true);
    expect(h.prompts).toEqual([]);
  });

  test("missing token with --yes exits 2 naming CLOUDFLARE_API_TOKEN", async () => {
    const h = makeHarness({});
    const code = await run(["setup", "--yes"], h.deps);
    expect(code).toBe(2);
    expect(text(h)).toContain("CLOUDFLARE_API_TOKEN");
    expect(h.installCalls).toHaveLength(0);
  });

  test("interactive token prompt shows permissions and token page", async () => {
    const h = makeHarness({ answers: ["pasted-token", ""] });
    const code = await run(["setup"], h.deps);
    expect(code).toBe(0);
    expect(h.tokens[0]).toBe("pasted-token");
    expect(text(h)).toContain("https://dash.cloudflare.com/profile/api-tokens");
    expect(text(h)).toContain("Account · Workers Scripts · Edit");
    expect(text(h)).not.toContain("pasted-token");
  });

  test("two accounts interactive: prompt shows both names and pick wins", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      accounts: [
        { id: "a1", name: "Personal" },
        { id: "a2", name: "Company" },
      ],
      answers: ["2", ""],
    });
    const code = await run(["setup"], h.deps);
    expect(code).toBe(0);
    const shown = text(h) + h.prompts.join("\n");
    expect(shown).toContain("Personal");
    expect(shown).toContain("Company");
    expect(h.installCalls[0].accountId).toBe("a2");
  });

  test("two accounts with --yes and no --account exits 2", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      accounts: [
        { id: "a1", name: "Personal" },
        { id: "a2", name: "Company" },
      ],
    });
    expect(await run(["setup", "--yes"], h.deps)).toBe(2);
    expect(h.installCalls).toHaveLength(0);
  });

  test("--account wins over auto-pick", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      accounts: [
        { id: "a1", name: "Personal" },
        { id: "a2", name: "Company" },
      ],
    });
    expect(await run(["setup", "--yes", "--account", "a1"], h.deps)).toBe(0);
    expect(h.installCalls[0].accountId).toBe("a1");
  });

  test("prompts for subdomain", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      answers: ["", "my-sub"],
      install: async (o, call) => {
        if (call === 1) throw makeInstallError("no_subdomain", "no workers.dev subdomain");
        return RESULT;
      },
    });
    const code = await run(["setup"], h.deps);
    expect(code).toBe(0);
    expect(h.installCalls).toHaveLength(2);
    expect(h.installCalls[1].subdomain).toBe("my-sub");
  });

  test("no_subdomain with --yes fails with exit 1", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      install: async () => {
        throw makeInstallError("no_subdomain", "no workers.dev subdomain");
      },
    });
    expect(await run(["setup", "--yes"], h.deps)).toBe(1);
    expect(text(h)).toContain("no workers.dev subdomain");
  });

  test("weak password then strong is re-asked once", async () => {
    const h = makeHarness({ env: { CLOUDFLARE_API_TOKEN: "t" }, answers: ["short", STRONG] });
    const code = await run(["setup"], h.deps);
    expect(code).toBe(0);
    expect(h.prompts.filter((p) => p.includes("admin password"))).toHaveLength(2);
    expect(h.installCalls[0].adminPassword).toBe(STRONG);
  });

  test("empty password answer means generate", async () => {
    const h = makeHarness({ env: { CLOUDFLARE_API_TOKEN: "t" }, answers: [""] });
    await run(["setup"], h.deps);
    expect(h.installCalls[0].adminPassword).toBeUndefined();
  });

  test("success prints both urls and the generated password once; token never", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "secret-token-xyz" },
      install: async () => ({ ...RESULT, generatedPassword: "GeneratedPass1234567890ab" }),
    });
    expect(await run(["setup", "--yes"], h.deps)).toBe(0);
    const all = text(h);
    expect(all).toContain(RESULT.statusUrl);
    expect(all).toContain(RESULT.adminUrl);
    expect(all.split("GeneratedPass1234567890ab")).toHaveLength(2);
    expect(all).toContain("Admin password (shown once): GeneratedPass1234567890ab");
    expect(all).not.toContain("secret-token-xyz");
    expect(all).toContain("✓ Database");
  });

  test("install error prints a failure line and exits 1", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      install: async () => {
        throw makeInstallError("name_taken", "A Worker named edgebeat already exists");
      },
    });
    expect(await run(["setup", "--yes"], h.deps)).toBe(1);
    expect(text(h)).toContain("✗ A Worker named edgebeat already exists");
  });

  test("update with git_managed exits 1 with the exact copy", async () => {
    const h = makeHarness({
      env: { CLOUDFLARE_API_TOKEN: "t" },
      update: async () => {
        throw makeInstallError("git_managed", "something else");
      },
    });
    expect(await run(["update", "--yes"], h.deps)).toBe(1);
    expect(text(h)).toContain(GIT_COPY);
  });

  test("update success exits 0 and never asks for a password", async () => {
    const h = makeHarness({ env: { CLOUDFLARE_API_TOKEN: "t" } });
    expect(await run(["update", "--yes"], h.deps)).toBe(0);
    expect(h.updateCalls).toHaveLength(1);
    expect(text(h)).toContain(RESULT.statusUrl);
  });

  test("unknown flag exits 2; version and help exit 0", async () => {
    const h = makeHarness({});
    expect(await run(["setup", "--bogus"], h.deps)).toBe(2);
    expect(await run(["--version"], h.deps)).toBe(0);
    expect(text(h)).toContain("9.9.9");
    expect(await run(["help"], h.deps)).toBe(0);
  });

  test("invalid --name and weak --admin-password exit 2", async () => {
    const h = makeHarness({ env: { CLOUDFLARE_API_TOKEN: "t" } });
    expect(await run(["setup", "--yes", "--name", "Bad Name"], h.deps)).toBe(2);
    expect(await run(["setup", "--yes", "--admin-password", "short"], h.deps)).toBe(2);
  });
});
