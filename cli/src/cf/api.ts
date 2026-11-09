import type { Account, CloudflareApi, D1Info, InstallSource, ScriptInfo } from "../contracts";
import { uploadAssetFiles } from "./assets";
import { createHttp, isNotFound, type Timeouts } from "./http";
import { INSTALL_SOURCE_BINDING, makeInstallError, VERSION_BINDING } from "../contracts";

const INSTALL_SOURCES: readonly string[] = ["cli", "cloud", "git"] satisfies InstallSource[];

const DEFAULT_BASE = "https://api.cloudflare.com/client/v4";

export const createCloudflareApi = (
  token: string,
  opts: { fetch?: typeof fetch; baseUrl?: string; timeouts?: Timeouts } = {},
): CloudflareApi => {
  const fetchImpl = opts.fetch ?? ((input: URL | RequestInfo, init?: RequestInit) => fetch(input, init));
  const http = createHttp(token, opts.baseUrl ?? DEFAULT_BASE, fetchImpl, opts.timeouts);
  const acc = (id: string) => `/accounts/${id}`;
  const script = (id: string, name: string) => `/accounts/${id}/workers/scripts/${name}`;
  const isMissingPermission = (e: unknown): boolean => (e as { code?: string })?.code === "missing_permission";

  const listAccounts = async (): Promise<Account[]> => {
    const all: Account[] = [];
    for (let n = 1; n <= 50; n++) {
      const { result, page, totalPages } = await http.page<{ id: string; name: string }[]>(
        `/accounts?per_page=50&page=${n}`,
      );
      all.push(...result.map(({ id, name }) => ({ id, name })));
      if (result.length === 0 || !totalPages || (page ?? n) >= totalPages) break;
    }
    return all;
  };

  const listD1 = async (accountId: string): Promise<D1Info[]> => {
    const all: D1Info[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await http.json<{ uuid: string; name: string }[]>(
        "GET",
        `${acc(accountId)}/d1/database?per_page=100&page=${page}`,
      );
      all.push(...r.map(({ uuid, name }) => ({ uuid, name })));
      if (r.length < 100) break;
    }
    return all;
  };

  return {
    verifyToken: async (accountId) => {
      const missing: string[] = [];
      let accounts: Account[] | null = null;
      let status: string | undefined;
      // Only HTTP rejections fall back; network errors and timeouts propagate.
      const accountVerify = async (id: string): Promise<string | undefined> => {
        try {
          return (await http.json<{ status?: string }>("GET", `${acc(id)}/tokens/verify`)).status;
        } catch (ae) {
          if (typeof (ae as { status?: unknown }).status !== "number") throw ae;
          return undefined;
        }
      };
      try {
        status = (await http.json<{ status?: string }>("GET", "/user/tokens/verify")).status;
      } catch (e) {
        if (typeof (e as { status?: unknown }).status !== "number") throw e;
        if (accountId) status = await accountVerify(accountId);
        if (status === undefined) {
          const verifyFailed = makeInstallError(
            "api_error",
            "Could not verify the API token. Check that it is correct and has not expired.",
          );
          try {
            accounts = await listAccounts();
          } catch (le) {
            if (isMissingPermission(le)) {
              throw makeInstallError(
                "missing_permission",
                "The API token could not be verified and cannot list accounts: add Account · Account Settings · Read.",
              );
            }
            throw verifyFailed;
          }
          for (const a of accounts) {
            if (a.id === accountId) continue;
            status = await accountVerify(a.id);
            if (status !== undefined) break;
          }
          if (status === undefined) throw verifyFailed;
        }
      }
      if (status !== "active") return { ok: false, missing: [] };
      const probe = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (e) {
          if (!isMissingPermission(e)) throw e;
          missing.push(label);
        }
      };
      if (!accounts) {
        await probe("Account · Account Settings · Read", async () => {
          accounts = await listAccounts();
        });
      }
      // Probe the account the install will write to (R15); without one, the first the token sees.
      const target = accountId ?? (accounts as Account[] | null)?.[0]?.id;
      if (target) {
        await probe("Account · Workers Scripts · Edit", () => http.json("GET", `${acc(target)}/workers/scripts`));
        await probe("Account · D1 · Edit", () => http.json("GET", `${acc(target)}/d1/database?per_page=10`));
      }
      return { ok: missing.length === 0, missing };
    },
    listAccounts,
    getSubdomain: async (accountId) => {
      try {
        const r = await http.json<{ subdomain?: string | null } | null>("GET", `${acc(accountId)}/workers/subdomain`);
        return r?.subdomain || null;
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },
    createSubdomain: async (accountId, subdomain) => {
      await http.json("PUT", `${acc(accountId)}/workers/subdomain`, { subdomain });
    },
    countWorkers: async (accountId) => {
      const r = await http.json<unknown[]>("GET", `${acc(accountId)}/workers/scripts`);
      return r.length;
    },
    getScriptInfo: async (accountId, name) => {
      type Binding = { type?: string; name?: string; text?: string };
      let settings: { bindings?: Binding[] } | null;
      try {
        settings = await http.json<{ bindings?: Binding[] } | null>("GET", `${script(accountId, name)}/settings`);
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
      const text = (n: string): string | undefined =>
        settings?.bindings?.find((b) => b.type === "plain_text" && b.name === n)?.text;
      const info: ScriptInfo = {};
      const source = text(INSTALL_SOURCE_BINDING);
      if (source !== undefined && INSTALL_SOURCES.includes(source)) info.installSource = source as InstallSource;
      const version = text(VERSION_BINDING);
      if (version) info.version = version;
      return info;
    },
    listD1,
    createD1: async (accountId, name) => {
      const r = await http.json<{ uuid: string; name: string }>("POST", `${acc(accountId)}/d1/database`, { name });
      return { uuid: r.uuid, name: r.name };
    },
    queryD1: async (accountId, uuid, sql, params = []) => {
      const r = await http.json<{ results?: Record<string, unknown>[] }[]>(
        "POST",
        `${acc(accountId)}/d1/database/${uuid}/query`,
        params.length > 0 ? { sql, params } : { sql },
      );
      return r.flatMap((x) => x.results ?? []);
    },
    uploadAssets: (accountId, scriptName, assets) => uploadAssetFiles(http, accountId, scriptName, assets),
    putScript: async (accountId, name, { manifest, modules, assetsJwt, bindings }) => {
      const metadata = {
        main_module: manifest.mainModule,
        compatibility_date: manifest.compatibilityDate,
        compatibility_flags: manifest.compatibilityFlags,
        assets: { jwt: assetsJwt, config: manifest.assetsConfig },
        bindings: bindings.map((b) => (b.type === "d1" ? { type: "d1", name: b.name, database_id: b.id } : b)),
        keep_bindings: ["secret_text"],
        observability: { enabled: manifest.observability },
      };
      const missingModule = manifest.modules.find((m) => !modules[m.name]);
      if (missingModule) {
        throw makeInstallError("api_error", `Release bundle is missing module ${missingModule.name}.`);
      }
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
      for (const m of manifest.modules) {
        form.append(m.name, new Blob([modules[m.name] as BlobPart], { type: m.contentType }), m.name);
      }
      await http.form("PUT", script(accountId, name), form);
    },
    listSecretNames: async (accountId, scriptName) => {
      const r = await http.json<{ name: string }[]>("GET", `${script(accountId, scriptName)}/secrets`);
      return r.map((s) => s.name);
    },
    putSecret: async (accountId, scriptName, name, value) => {
      await http.json("PUT", `${script(accountId, scriptName)}/secrets`, { name, text: value, type: "secret_text" });
    },
    putSchedules: async (accountId, scriptName, crons) => {
      await http.json("PUT", `${script(accountId, scriptName)}/schedules`, crons.map((cron) => ({ cron })));
    },
    enableWorkersDev: async (accountId, scriptName) => {
      await http.json("POST", `${script(accountId, scriptName)}/subdomain`, { enabled: true, previews_enabled: false });
    },
    fetchHealth: async (url) => {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(opts.timeouts?.health ?? 10_000) });
        if (res.status !== 200) return null;
        const body = (await res.json()) as { ok?: boolean; version?: string; installSource?: InstallSource } | null;
        if (!body || typeof body !== "object") return null;
        return { ok: body.ok === true, version: body.version, installSource: body.installSource };
      } catch {
        return null;
      }
    },
  };
};
