import type { Account, CloudflareApi, D1Info, InstallSource } from "../contracts";
import { uploadAssetFiles } from "./assets";
import { createHttp, isNotFound } from "./http";

const DEFAULT_BASE = "https://api.cloudflare.com/client/v4";

export const createCloudflareApi = (
  token: string,
  opts: { fetch?: typeof fetch; baseUrl?: string } = {},
): CloudflareApi => {
  const fetchImpl = opts.fetch ?? ((input: URL | RequestInfo, init?: RequestInit) => fetch(input, init));
  const http = createHttp(token, opts.baseUrl ?? DEFAULT_BASE, fetchImpl);
  const acc = (id: string) => `/accounts/${id}`;
  const script = (id: string, name: string) => `/accounts/${id}/workers/scripts/${name}`;
  const isMissingPermission = (e: unknown): boolean => (e as { code?: string })?.code === "missing_permission";

  const listAccounts = async (): Promise<Account[]> => {
    const r = await http.json<{ id: string; name: string }[]>("GET", "/accounts");
    return r.map(({ id, name }) => ({ id, name }));
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
    verifyToken: async () => {
      const v = await http.json<{ status?: string }>("GET", "/user/tokens/verify");
      if (v.status !== "active") return { ok: false, missing: [] };
      const missing: string[] = [];
      const probe = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await fn();
        } catch (e) {
          if (!isMissingPermission(e)) throw e;
          missing.push(label);
        }
      };
      let accounts: Account[] = [];
      await probe("Account · Account Settings · Read", async () => {
        accounts = await listAccounts();
      });
      const first = accounts[0];
      if (first) {
        await probe("Account · Workers Scripts · Edit", () => http.json("GET", `${acc(first.id)}/workers/scripts`));
        await probe("Account · D1 · Edit", () => http.json("GET", `${acc(first.id)}/d1/database?per_page=1`));
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
    scriptExists: async (accountId, name) => {
      try {
        await http.json("GET", script(accountId, name));
        return true;
      } catch (e) {
        if (isNotFound(e)) return false;
        throw e;
      }
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
        { sql, params },
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
        bindings,
        keep_bindings: ["secret_text"],
        observability: { enabled: manifest.observability },
      };
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }), "metadata.json");
      for (const m of manifest.modules) {
        const bytes = modules[m.name];
        if (!bytes) continue;
        form.append(m.name, new Blob([bytes as BlobPart], { type: m.contentType }), m.name);
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
        const res = await fetchImpl(url);
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
