import { describe, expect, test } from "bun:test";
import { isInstallError, type ReleaseManifest } from "../contracts";
import { createCloudflareApi } from "./api";
import { assetHash } from "./assets";

const TOKEN = "tok_SECRET_123";
type Rec = { url: string; method: string; headers: Headers; body: unknown };

const env = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200 });
const fail = (status: number, code: number, message: string) =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), { status });

const harness = (handler: (r: Rec) => Response | Promise<Response>) => {
  const calls: Rec[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const rec: Rec = { url: String(url), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body };
    calls.push(rec);
    return handler(rec);
  }) as unknown as typeof fetch;
  return { calls, api: createCloudflareApi(TOKEN, { fetch: f, baseUrl: "https://cf.test/v4" }) };
};

const manifest: ReleaseManifest = {
  version: "1.0.0",
  compatibilityDate: "2025-01-01",
  compatibilityFlags: ["nodejs_compat"],
  mainModule: "index.js",
  modules: [
    { name: "index.js", contentType: "application/javascript+module" },
    { name: "index.js.map", contentType: "application/source-map" },
  ],
  crons: ["* * * * *"],
  assetsConfig: { run_worker_first: ["/api/*", "/beat/*"] },
  migrations: [],
  observability: true,
};

describe("auth and errors", () => {
  test("every request carries the bearer token", async () => {
    const { api, calls } = harness(() => env([{ id: "a1", name: "Acc", extra: 1 }]));
    expect(await api.listAccounts()).toEqual([{ id: "a1", name: "Acc" }]);
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("maps 403 to missing permission naming the endpoint family", async () => {
    const cases: [string, (a: ReturnType<typeof harness>["api"]) => Promise<unknown>, string][] = [
      ["scripts", (a) => a.countWorkers("a1"), "Workers Scripts"],
      ["d1", (a) => a.listD1("a1"), "D1"],
      ["accounts", (a) => a.listAccounts(), "Account Settings"],
    ];
    for (const [, run, label] of cases) {
      const { api } = harness(() => fail(403, 10000, `Authentication error ${TOKEN}`));
      const err = (await run(api).catch((e) => e)) as Error & { code?: string };
      expect(isInstallError(err) && err.code).toBe("missing_permission");
      expect(err.message).toContain(label);
      expect(err.message).not.toContain(TOKEN);
    }
  });

  test("code 10000 with status 400 also maps to missing permission", async () => {
    const { api } = harness(() => fail(400, 10000, "nope"));
    const err = await api.listD1("a1").catch((e) => e);
    expect(err.code).toBe("missing_permission");
  });

  test("d1 limit and cron limit and generic errors", async () => {
    const d1 = harness(() => fail(400, 7403, "You have reached the maximum number of D1 databases"));
    expect((await d1.api.createD1("a1", "x").catch((e) => e)).code).toBe("limit_d1");
    const cron = harness(() => fail(400, 100328, "Exceeded the maximum number of cron triggers for this account"));
    expect((await cron.api.putSchedules("a1", "w", ["* * * * *"]).catch((e) => e)).code).toBe("limit_cron");
    const other = harness(() => fail(500, 1, `boom ${TOKEN}`));
    const err = await other.api.createD1("a1", "x").catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.message).toContain("boom");
    expect(err.message).not.toContain(TOKEN);
  });

  test("network error never leaks the token", async () => {
    const api = createCloudflareApi(TOKEN, {
      fetch: (async () => {
        throw new Error(`fail with ${TOKEN}`);
      }) as unknown as typeof fetch,
    });
    const err = await api.listAccounts().catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.message).not.toContain(TOKEN);
  });
});

describe("simple endpoints", () => {
  test("getSubdomain null when none", async () => {
    expect(await harness(() => env({ subdomain: null })).api.getSubdomain("a1")).toBeNull();
    expect(await harness(() => env(null)).api.getSubdomain("a1")).toBeNull();
    expect(await harness(() => fail(404, 10007, "nf")).api.getSubdomain("a1")).toBeNull();
    expect(await harness(() => env({ subdomain: "me" })).api.getSubdomain("a1")).toBe("me");
  });

  test("scriptExists 404 -> false", async () => {
    expect(await harness(() => fail(404, 10007, "nf")).api.scriptExists("a1", "w")).toBe(false);
    expect(await harness(() => env({})).api.scriptExists("a1", "w")).toBe(true);
  });

  test("queryD1 flattens results and sends sql/params", async () => {
    const { api, calls } = harness(() => env([{ results: [{ a: 1 }] }, { results: [{ b: 2 }] }]));
    expect(await api.queryD1("a1", "u1", "select ?", [1])).toEqual([{ a: 1 }, { b: 2 }]);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ sql: "select ?", params: [1] });
    expect(calls[0]!.url).toBe("https://cf.test/v4/accounts/a1/d1/database/u1/query");
  });

  test("secrets, schedules, workers.dev", async () => {
    const { api, calls } = harness(() => env([{ name: "ADMIN_PASSWORD", type: "secret_text" }]));
    expect(await api.listSecretNames("a1", "w")).toEqual(["ADMIN_PASSWORD"]);
    await api.putSecret("a1", "w", "K", "v");
    await api.putSchedules("a1", "w", ["* * * * *"]);
    await api.enableWorkersDev("a1", "w");
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ name: "K", text: "v", type: "secret_text" });
    expect(JSON.parse(calls[2]!.body as string)).toEqual([{ cron: "* * * * *" }]);
    expect(JSON.parse(calls[3]!.body as string)).toEqual({ enabled: true, previews_enabled: false });
  });

  test("verifyToken reports missing permissions", async () => {
    const { api } = harness((r) => {
      if (r.url.endsWith("/user/tokens/verify")) return env({ status: "active" });
      if (r.url.includes("/accounts?")) return env([{ id: "a1", name: "A" }]);
      if (r.url.includes("/d1/")) return fail(403, 10000, "no");
      return env([]);
    });
    expect(await api.verifyToken()).toEqual({ ok: false, missing: ["Account · D1 · Edit"] });
  });
});

describe("fetchHealth", () => {
  test("parses 200 json", async () => {
    const { api } = harness(() => new Response(JSON.stringify({ ok: true, version: "1.2.3", installSource: "cli" })));
    expect(await api.fetchHealth("https://x/api/v1/health")).toEqual({ ok: true, version: "1.2.3", installSource: "cli" });
  });
  test("null on non-200, non-json, network error", async () => {
    expect(await harness(() => new Response("{}", { status: 503 })).api.fetchHealth("https://x")).toBeNull();
    expect(await harness(() => new Response("<html>")).api.fetchHealth("https://x")).toBeNull();
    const api = createCloudflareApi(TOKEN, {
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    expect(await api.fetchHealth("https://x")).toBeNull();
  });
});

describe("putScript", () => {
  test("sends metadata and one part per module", async () => {
    const { api, calls } = harness(() => env({}));
    await api.putScript("a1", "w", {
      manifest,
      modules: { "index.js": new TextEncoder().encode("export default {}"), "index.js.map": new TextEncoder().encode("{}") },
      assetsJwt: "jwt-c",
      bindings: [
        { type: "d1", name: "DB", id: "u1" },
        { type: "assets", name: "ASSETS" },
      ],
    });
    const call = calls[0]!;
    expect(call.method).toBe("PUT");
    expect(call.url).toBe("https://cf.test/v4/accounts/a1/workers/scripts/w");
    const form = call.body as FormData;
    const meta = JSON.parse(await (form.get("metadata") as File).text());
    expect(meta.main_module).toBe("index.js");
    expect(meta.compatibility_date).toBe("2025-01-01");
    expect(meta.compatibility_flags).toEqual(["nodejs_compat"]);
    expect(meta.assets).toEqual({ jwt: "jwt-c", config: { run_worker_first: ["/api/*", "/beat/*"] } });
    expect(meta.bindings).toContainEqual({ type: "assets", name: "ASSETS" });
    expect(meta.keep_bindings).toEqual(["secret_text"]);
    expect((form.get("index.js") as File).type).toBe("application/javascript+module");
    expect((form.get("index.js.map") as File).type).toBe("application/source-map");
  });
});

describe("uploadAssets", () => {
  const assets = {
    "/index.html": new TextEncoder().encode("<div id=app>"),
    "/app.js": new TextEncoder().encode("x=1"),
    "/old.css": new TextEncoder().encode("a{}"),
  };

  test("uploads only listed buckets, one request each, base64, returns completion jwt", async () => {
    const hIndex = await assetHash("/index.html", assets["/index.html"]);
    const hJs = await assetHash("/app.js", assets["/app.js"]);
    const { api, calls } = harness((r) => {
      if (r.url.endsWith("/assets-upload-session")) return env({ jwt: "session", buckets: [[hIndex], [hJs]] });
      const n = calls.filter((c) => c.url.includes("/assets/upload")).length;
      return env(n === 2 ? { jwt: "complete" } : {});
    });
    expect(await api.uploadAssets("a1", "w", assets)).toBe("complete");
    const session = JSON.parse(calls[0]!.body as string);
    expect(Object.keys(session.manifest).sort()).toEqual(["/app.js", "/index.html", "/old.css"]);
    expect(session.manifest["/index.html"]).toEqual({ hash: hIndex, size: assets["/index.html"].length });
    const uploads = calls.slice(1);
    expect(uploads).toHaveLength(2);
    for (const u of uploads) {
      expect(u.url).toBe("https://cf.test/v4/accounts/a1/workers/assets/upload?base64=true");
      expect(u.headers.get("authorization")).toBe("Bearer session");
    }
    const f0 = uploads[0]!.body as FormData;
    expect([...f0.keys()]).toEqual([hIndex]);
    expect(await (f0.get(hIndex) as File).text()).toBe(btoa("<div id=app>"));
    expect([...(uploads[1]!.body as FormData).keys()]).toEqual([hJs]);
  });

  test("empty buckets returns session jwt without uploads", async () => {
    const { api, calls } = harness(() => env({ jwt: "session", buckets: [] }));
    expect(await api.uploadAssets("a1", "w", assets)).toBe("session");
    expect(calls).toHaveLength(1);
  });
});

const hang = (): typeof fetch =>
  ((_url: unknown, init?: RequestInit) =>
    new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal!.reason));
    })) as unknown as typeof fetch;

describe("fix round 1", () => {
  test("scriptExists accepts a non-JSON 200 body, 404 -> false, other errors mapped", async () => {
    const ok = harness(() => new Response("export default {}", { status: 200 }));
    expect(await ok.api.scriptExists("a1", "w")).toBe(true);
    expect(await harness(() => fail(404, 10007, "nf")).api.scriptExists("a1", "w")).toBe(false);
    expect(await harness(() => new Response("not found", { status: 404 })).api.scriptExists("a1", "w")).toBe(false);
    const err = await harness(() => fail(500, 1, "boom")).api.scriptExists("a1", "w").catch((e) => e);
    expect(err.code).toBe("api_error");
    const perm = await harness(() => fail(403, 10000, "x")).api.scriptExists("a1", "w").catch((e) => e);
    expect(perm.code).toBe("missing_permission");
  });

  test("verifyToken falls back to account token verify", async () => {
    const { api, calls } = harness((r) => {
      if (r.url.endsWith("/user/tokens/verify")) return fail(401, 1000, "Invalid API Token");
      if (r.url.includes("/accounts?")) return env([{ id: "a1", name: "A" }, { id: "a2", name: "B" }]);
      if (r.url.endsWith("/accounts/a1/tokens/verify")) return fail(403, 1000, "nope");
      if (r.url.endsWith("/accounts/a2/tokens/verify")) return env({ status: "active" });
      return env([]);
    });
    expect(await api.verifyToken()).toEqual({ ok: true, missing: [] });
    expect(calls.some((c) => c.url.endsWith("/accounts/a2/tokens/verify"))).toBe(true);
  });

  test("verifyToken fails plainly when neither verify works", async () => {
    const { api } = harness((r) => {
      if (r.url.includes("/accounts?")) return env([{ id: "a1", name: "A" }]);
      return fail(401, 1000, `Invalid ${TOKEN}`);
    });
    const err = await api.verifyToken().catch((e) => e);
    expect(isInstallError(err)).toBe(true);
    expect(err.message).not.toContain(TOKEN);
    const noList = harness(() => fail(401, 1000, "bad"));
    const err2 = await noList.api.verifyToken().catch((e) => e);
    expect(isInstallError(err2)).toBe(true);
  });

  test("d1 probe uses per_page=10", async () => {
    const { api, calls } = harness((r) => {
      if (r.url.endsWith("/user/tokens/verify")) return env({ status: "active" });
      if (r.url.includes("/accounts?")) return env([{ id: "a1", name: "A" }]);
      return env([]);
    });
    await api.verifyToken();
    const d1 = calls.find((c) => c.url.includes("/d1/database"))!;
    expect(d1.url.endsWith("per_page=10")).toBe(true);
  });

  test("fetchHealth passes a timeout signal and returns null on hang", async () => {
    const api = createCloudflareApi(TOKEN, { fetch: hang(), timeouts: { health: 20 } });
    expect(await api.fetchHealth("https://x")).toBeNull();
    let signal: AbortSignal | null | undefined;
    const spy = createCloudflareApi(TOKEN, {
      fetch: (async (_u: unknown, init?: RequestInit) => {
        signal = init?.signal;
        return new Response("{}", { status: 503 });
      }) as unknown as typeof fetch,
    });
    await spy.fetchHealth("https://x");
    expect(signal).toBeDefined();
  });

  test("api requests time out as api_error", async () => {
    const api = createCloudflareApi(TOKEN, { fetch: hang(), timeouts: { request: 20 } });
    const err = await api.listD1("a1").catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.message).toBe("Cloudflare API timed out");
  });

  test("limit_d1 only on database creation, not query", async () => {
    const { api } = harness(() => fail(400, 1, "maximum number of rows exceeded"));
    const err = await api.queryD1("a1", "u1", "select 1").catch((e) => e);
    expect(err.code).toBe("api_error");
  });

  test("listAccounts paginates via result_info", async () => {
    const page = (n: number) =>
      new Response(
        JSON.stringify({
          success: true,
          errors: [],
          result: n === 1 ? [{ id: "a1", name: "A" }] : [{ id: "a2", name: "B" }],
          result_info: { page: n, per_page: 50, total_pages: 2 },
        }),
      );
    const { api, calls } = harness((r) => page(r.url.includes("page=2") ? 2 : 1));
    expect((await api.listAccounts()).map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(calls[0]!.url).toContain("per_page=50");
  });

  test("d1 binding is sent with database_id", async () => {
    const { api, calls } = harness(() => env({}));
    await api.putScript("a1", "w", {
      manifest,
      modules: { "index.js": new Uint8Array([1]), "index.js.map": new Uint8Array([2]) },
      assetsJwt: "j",
      bindings: [{ type: "d1", name: "DB", id: "u1" }],
    });
    const meta = JSON.parse(await ((calls[0]!.body as FormData).get("metadata") as File).text());
    expect(meta.bindings).toContainEqual({ type: "d1", name: "DB", database_id: "u1" });
  });

  test("putScript throws when a manifest module is missing", async () => {
    const { api, calls } = harness(() => env({}));
    const err = await api
      .putScript("a1", "w", { manifest, modules: { "index.js": new Uint8Array([1]) }, assetsJwt: "j", bindings: [] })
      .catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.message).toContain("index.js.map");
    expect(calls).toHaveLength(0);
  });

  test("403 on asset upload means expired session, not missing permission", async () => {
    const { api } = harness((r) =>
      r.url.endsWith("/assets-upload-session")
        ? env({ jwt: "s", buckets: [["x"]] })
        : fail(403, 10000, "jwt expired"),
    );
    const err = await api.uploadAssets("a1", "w", { "/a.js": new Uint8Array([1]) }).catch((e) => e);
    expect(err.code).toBe("api_error");
    expect(err.message).toContain("Asset upload session expired");
  });
});
