// End-to-end: real bundle + real REST client + real installer + real CLI, against an
// in-memory Cloudflare emulator behind an injected fetch. No network, no real account.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildBundle } from "../src/bundle/build";
import { loadBundle } from "../src/bundle/load";
import { createCloudflareApi } from "../src/cf/api";
import type { ReleaseBundle } from "../src/contracts";
import { run, type Deps, type Installer, type Io } from "../src/cli/run";
import { install, update, validateAdminPassword, validateName } from "../src/installer";

const TOKEN = "cf-e2e-token-SECRET";
const API = "https://api.cloudflare.com/client/v4";
const SUBDOMAIN = "me";
const NAME = "upflare";
const HEALTH_HOST = `${NAME}.${SUBDOMAIN}.workers.dev`;
const PASSWORD = "a-strong-password-1";
const SESSION_JWT = "assets-session-jwt";
const COMPLETION_JWT = "assets-completion-jwt";
const COLD_START_HEALTH_MISSES = 2;

// ---------- in-memory Cloudflare ----------

type Logged = { method: string; path: string };
type UploadedScript = {
  metadata: Record<string, unknown>;
  parts: Record<string, { type: string; bytes: Uint8Array }>;
};
type Database = { uuid: string; name: string; tables: Set<string>; ledger: string[] | null };

const ok = (result: unknown, extra: Record<string, unknown> = {}, status = 200): Response =>
  new Response(JSON.stringify({ success: true, errors: [], messages: [], result, ...extra }), {
    status,
    headers: { "content-type": "application/json" },
  });
const fail = (status: number, code: number, message: string): Response =>
  new Response(JSON.stringify({ success: false, errors: [{ code, message }], messages: [], result: null }), {
    status,
    headers: { "content-type": "application/json" },
  });

// Independent of src/cf/assets.ts: first 32 hex of sha256(base64(bytes) + extension).
const expectedAssetHash = (path: string, base64: string): string => {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return createHash("sha256").update(base64 + ext).digest("hex").slice(0, 32);
};

type Part = { name: string; type: string; bytes: Uint8Array };

// Reads multipart parts straight from the wire. Bun's Request.formData() replaces each
// part's Content-Type with one guessed from the filename, which would hide what we send.
const parseMultipart = async (req: Request): Promise<Part[]> => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers.get("content-type") ?? "");
  if (!boundary) throw new Error("multipart request without boundary");
  const raw = Buffer.from(await req.arrayBuffer());
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts: Part[] = [];
  let at = raw.indexOf(delimiter);
  while (at >= 0) {
    const start = at + delimiter.length;
    if (raw.subarray(start, start + 2).toString() === "--") break;
    const next = raw.indexOf(delimiter, start);
    if (next < 0) throw new Error("unterminated multipart body");
    const chunk = raw.subarray(start + 2, next - 2); // drop CRLF after delimiter and before the next one
    const split = chunk.indexOf("\r\n\r\n");
    const headers = chunk.subarray(0, split).toString();
    parts.push({
      name: /name="([^"]*)"/.exec(headers)?.[1] ?? "",
      type: /^content-type:\s*(.+)$/im.exec(headers)?.[1]?.trim() ?? "",
      bytes: new Uint8Array(chunk.subarray(split + 4)),
    });
    at = next;
  }
  return parts;
};

// D1 executes every statement of a multi-statement query and answers one result per statement.
const splitStatements = (sql: string): string[] =>
  sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

// What an ISP that blocks *.workers.dev serves instead (seen: resolver -> blockpage.xlaxiata.id).
const BLOCK_PAGE = "<html><body>Internet Positif: this site is blocked</body></html>";

const createEmulator = (opts: { version: string; workersDevBlocked?: boolean }) => {
  const accounts = [
    { id: "acc1", name: "Main" },
    { id: "acc2", name: "Side" },
  ];
  const state = {
    otherScripts: ["hello-world", "api-proxy"],
    d1: [{ uuid: "uuid-other", name: "other-db", tables: new Set(["notes"]), ledger: null }] as Database[],
    script: null as UploadedScript | null,
    workersDev: false,
    secrets: new Map<string, string>(),
    schedules: [] as string[],
    storedAssets: new Set<string>(),
    pendingAssets: new Map<string, string>(), // hash -> path, for the open upload session
    healthCalls: 0,
    log: [] as Logged[],
    authFailures: [] as string[],
    unhandled: [] as string[],
  };
  let nextUuid = 1;

  const query = (db: Database, sql: string): Response => {
    const results: { results: Record<string, unknown>[]; success: true; meta: Record<string, unknown> }[] = [];
    for (const stmt of splitStatements(sql)) {
      const s = stmt.replace(/\s+/g, " ");
      let rows: Record<string, unknown>[] = [];
      if (/^CREATE TABLE IF NOT EXISTS d1_migrations\b/i.test(s)) {
        db.ledger ??= [];
      } else if (/^SELECT name FROM sqlite_master WHERE type = 'table'/i.test(s)) {
        rows = [...db.tables, ...(db.ledger ? ["d1_migrations", "sqlite_sequence"] : [])].map((name) => ({ name }));
      } else if (/^SELECT name FROM d1_migrations\b/i.test(s)) {
        if (!db.ledger) return fail(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        rows = db.ledger.map((name, i) => ({ id: i + 1, name }));
      } else if (/^INSERT INTO d1_migrations \(name\) VALUES \('(.+)'\)$/i.test(s)) {
        const name = /VALUES \('(.+)'\)$/i.exec(s)![1]!.replaceAll("''", "'");
        if (!db.ledger) return fail(400, 7500, "no such table: d1_migrations: SQLITE_ERROR");
        if (db.ledger.includes(name)) return fail(400, 7500, "UNIQUE constraint failed: d1_migrations.name");
        db.ledger.push(name);
      } else if (/^CREATE TABLE `?(\w+)`?/i.test(s)) {
        const table = /^CREATE TABLE `?(\w+)`?/i.exec(s)![1]!;
        if (db.tables.has(table)) return fail(400, 7500, `table \`${table}\` already exists: SQLITE_ERROR`);
        db.tables.add(table);
      } else if (!/^(CREATE (UNIQUE )?INDEX|PRAGMA|ALTER TABLE|INSERT INTO|DROP)/i.test(s)) {
        state.unhandled.push(`sql: ${s.slice(0, 80)}`);
        return fail(400, 7500, `emulator cannot run: ${s.slice(0, 40)}`);
      }
      results.push({ results: rows, success: true, meta: {} });
    }
    return ok(results);
  };

  const api = async (req: Request, path: string, search: URLSearchParams): Promise<Response> => {
    const m = req.method;
    const auth = req.headers.get("authorization");
    const isAssetUpload = path === "/accounts/acc1/workers/assets/upload";
    const expectedAuth = `Bearer ${isAssetUpload ? SESSION_JWT : TOKEN}`;
    if (auth !== expectedAuth) {
      state.authFailures.push(`${m} ${path}`);
      return fail(401, 10000, "Authentication error");
    }
    const body = async () => JSON.parse(await req.text()) as Record<string, unknown>;

    if (m === "GET" && path === "/user/tokens/verify") return ok({ id: "tok1", status: "active" });
    if (m === "GET" && path === "/accounts") {
      // One account per page so the client must follow result_info.total_pages.
      const page = Number(search.get("page") ?? "1");
      return ok(accounts.slice(page - 1, page), {
        result_info: { page, per_page: 1, count: 1, total_count: accounts.length, total_pages: accounts.length },
      });
    }

    const acc = /^\/accounts\/([^/]+)(\/.*)$/.exec(path);
    if (!acc) return fail(404, 7003, "Could not route");
    if (acc[1] !== "acc1" && acc[1] !== "acc2") return fail(403, 10000, "Authentication error");
    const rest = acc[2]!;

    if (rest === "/workers/subdomain" && m === "GET") return ok({ subdomain: SUBDOMAIN });
    if (rest === "/workers/scripts" && m === "GET") {
      const names = [...state.otherScripts, ...(state.script ? [NAME] : [])];
      return ok(names.map((id) => ({ id })));
    }
    if (rest === "/d1/database" && m === "GET") {
      const perPage = Number(search.get("per_page") ?? "100");
      const page = Number(search.get("page") ?? "1");
      const list = state.d1.slice((page - 1) * perPage, page * perPage).map(({ uuid, name }) => ({ uuid, name }));
      return ok(list);
    }
    if (rest === "/d1/database" && m === "POST") {
      const { name } = await body();
      if (state.d1.some((d) => d.name === name)) return fail(400, 7502, "A database with that name already exists");
      const db: Database = { uuid: `uuid-${nextUuid++}`, name: String(name), tables: new Set(), ledger: null };
      state.d1.push(db);
      return ok({ uuid: db.uuid, name: db.name, created_at: "2026-11-09T00:00:00Z" });
    }
    const q = /^\/d1\/database\/([^/]+)\/query$/.exec(rest);
    if (q && m === "POST") {
      const db = state.d1.find((d) => d.uuid === q[1]);
      if (!db) return fail(404, 7404, "database not found");
      const sent = await body();
      expect(sent).toEqual({ sql: expect.any(String) }); // no params key when there are none (M6)
      const { sql } = sent;
      return query(db, String(sql));
    }

    if (isAssetUpload && m === "POST") {
      expect(search.get("base64")).toBe("true");
      for (const { name: hash, bytes } of await parseMultipart(req)) {
        const path = state.pendingAssets.get(hash);
        if (!path) {
          state.unhandled.push(`asset upload: unrequested hash ${hash}`);
          return fail(400, 8000, "unexpected file");
        }
        expect(expectedAssetHash(path, new TextDecoder().decode(bytes))).toBe(hash);
        state.storedAssets.add(hash);
        state.pendingAssets.delete(hash);
      }
      return ok(state.pendingAssets.size === 0 ? { jwt: COMPLETION_JWT } : {}, {}, 201);
    }

    const s = /^\/workers\/scripts\/([^/]+)(\/.*)?$/.exec(rest);
    if (s && s[1] === NAME) {
      const sub = s[2] ?? "";
      if (sub === "" && m === "PUT") {
        const all = await parseMultipart(req);
        const meta = all.find((p) => p.name === "metadata");
        if (!meta) return fail(400, 10021, "metadata part missing");
        const parts: UploadedScript["parts"] = {};
        for (const p of all) if (p.name !== "metadata") parts[p.name] = { type: p.type, bytes: p.bytes };
        state.script = {
          metadata: JSON.parse(new TextDecoder().decode(meta.bytes)) as Record<string, unknown>,
          parts,
        };
        return ok({ id: NAME, etag: "e1" });
      }
      if (sub === "/assets-upload-session" && m === "POST") {
        const { manifest } = (await body()) as { manifest: Record<string, { hash: string; size: number }> };
        state.pendingAssets.clear();
        for (const [path, { hash }] of Object.entries(manifest)) {
          if (!state.storedAssets.has(hash)) state.pendingAssets.set(hash, path);
        }
        const missing = [...state.pendingAssets.keys()];
        // Two buckets when there is work, so multi-request uploads are exercised.
        const half = Math.ceil(missing.length / 2);
        const buckets = missing.length === 0 ? [] : [missing.slice(0, half), missing.slice(half)].filter((b) => b.length);
        return ok({ jwt: SESSION_JWT, buckets });
      }
      if (!state.script && sub !== "") return fail(404, 10007, "This Worker does not exist on your account.");
      if (sub === "/settings" && m === "GET") {
        // Script and version settings: bindings as uploaded (d1 answers with `id`), plus secrets by name.
        const uploaded = (state.script!.metadata.bindings ?? []) as Record<string, unknown>[];
        const bindings = [
          ...uploaded.map(({ database_id, ...b }) => (database_id ? { ...b, id: database_id } : b)),
          ...[...state.secrets.keys()].map((name) => ({ type: "secret_text", name })),
        ];
        return ok({ bindings, compatibility_date: state.script!.metadata.compatibility_date, logpush: false });
      }
      if (sub === "/secrets" && m === "GET") {
        return ok([...state.secrets.keys()].map((name) => ({ name, type: "secret_text" })));
      }
      if (sub === "/secrets" && m === "PUT") {
        const { name, text, type } = await body();
        expect(type).toBe("secret_text");
        state.secrets.set(String(name), String(text));
        return ok({ name, type });
      }
      if (sub === "/schedules" && m === "PUT") {
        const list = (await req.json()) as { cron: string }[];
        state.schedules = list.map((c) => c.cron);
        return ok({ schedules: list });
      }
      if (sub === "/subdomain" && m === "POST") {
        const { enabled } = await body();
        state.workersDev = enabled === true;
        return ok({ enabled: state.workersDev, previews_enabled: false });
      }
    }
    state.unhandled.push(`${m} ${path}`);
    return fail(404, 7003, `No route for ${m} ${path}`);
  };

  const health = (): Response => {
    state.healthCalls++;
    if (opts.workersDevBlocked) return new Response(BLOCK_PAGE, { headers: { "content-type": "text/html" } });
    if (!state.script || !state.workersDev) return new Response("There is nothing here yet", { status: 404 });
    // A fresh deploy answers 503 for a moment before it serves the new code.
    if (state.healthCalls <= COLD_START_HEALTH_MISSES) return new Response("starting", { status: 503 });
    const bindings = (state.script.metadata.bindings ?? []) as { name: string; text?: string }[];
    const source = bindings.find((b) => b.name === "UPFLARE_INSTALL_SOURCE")?.text ?? null;
    return Response.json({ ok: true, version: opts.version, installSource: source });
  };

  const fetchImpl = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    if (url.host === HEALTH_HOST && url.pathname === "/api/v1/health" && req.method === "GET") return health();
    if (!req.url.startsWith(`${API}/`)) {
      state.unhandled.push(`${req.method} ${req.url}`);
      throw new TypeError(`emulator: no network for ${req.url}`);
    }
    const path = url.pathname.slice(new URL(API).pathname.length);
    state.log.push({ method: req.method, path });
    return api(req, path, url.searchParams);
  };

  return { state, fetch: fetchImpl as unknown as typeof fetch };
};

// ---------- harness ----------

const repoRoot = resolve(import.meta.dir, "../..");
let bundleDir = "";
let bundle: ReleaseBundle;
const realFetch = globalThis.fetch;
const strayFetches: string[] = [];

beforeAll(async () => {
  // Anything that bypasses the injected fetch would reach the network: fail loudly instead.
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    strayFetches.push(String(input instanceof Request ? input.url : input));
    throw new TypeError("network disabled in e2e");
  }) as unknown as typeof fetch;
  bundleDir = await mkdtemp(join(tmpdir(), "upflare-e2e-bundle-"));
  await buildBundle(repoRoot, bundleDir);
  bundle = await loadBundle(bundleDir);
}, 240_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (bundleDir) await rm(bundleDir, { recursive: true, force: true });
});

const FAST_POLL = { pollIntervalMs: 5, pollTimeoutMs: 5_000 };

// The CLI has no poll flags; inject short health polling through deps.installer.
const fastInstaller: Installer = {
  install: (api, b, o) => install(api, b, { ...o, ...FAST_POLL }),
  update: (api, b, o) => update(api, b, { ...o, ...FAST_POLL }),
  validateAdminPassword,
  validateName,
};

const makeDeps = (emu: ReturnType<typeof createEmulator>, installer: Installer = fastInstaller) => {
  const out: string[] = [];
  const tokens: string[] = [];
  const io: Io = {
    prompt: async (q) => {
      throw new Error(`unexpected prompt in --yes mode: ${q}`);
    },
    print: (line) => out.push(line),
    isTTY: false,
    env: { CLOUDFLARE_API_TOKEN: TOKEN },
  };
  const deps: Deps = {
    api: (token) => {
      tokens.push(token);
      return createCloudflareApi(token, { fetch: emu.fetch });
    },
    bundle: () => loadBundle(bundleDir),
    io,
    installer,
    version: "0.0.0-test",
  };
  return { deps, out, tokens };
};

const writesTo = (log: Logged[], suffix: string, method: string) =>
  log.filter((l) => l.method === method && l.path.endsWith(suffix));

describe("e2e: setup then update against emulated Cloudflare", () => {
  test("setup installs everything, update ships code without touching secrets", async () => {
    const emu = createEmulator({ version: bundle.manifest.version });
    const { state } = emu;

    // ---- setup ----
    const setup = makeDeps(emu);
    const setupCode = await run(
      ["setup", "--yes", "--account", "acc1", "--admin-password", PASSWORD],
      setup.deps,
    );
    const setupOut = setup.out.join("\n");
    expect({ code: setupCode, out: setupOut }).toEqual({ code: 0, out: expect.any(String) });
    expect(setup.tokens).toEqual([TOKEN]);
    expect(state.unhandled).toEqual([]);
    expect(state.authFailures).toEqual([]);
    expect(strayFetches).toEqual([]);

    // Account listing followed pagination during the permission probe.
    expect(state.log.filter((l) => l.path === "/accounts").length).toBe(2);
    // Permission probes hit the chosen account only (R15).
    expect(state.log.some((l) => l.method === "GET" && l.path === "/accounts/acc1/workers/scripts")).toBe(true);
    expect(state.log.some((l) => l.path.startsWith("/accounts/acc2/"))).toBe(false);

    // D1: created with the worker's name, schema migrated, ledger recorded.
    const db = state.d1.find((d) => d.name === NAME);
    expect(db).toBeDefined();
    expect(db!.ledger).toEqual(bundle.manifest.migrations);
    expect(db!.tables.has("events")).toBe(true);
    expect(state.d1.find((d) => d.name === "other-db")!.ledger).toBeNull();

    // Script upload: metadata and every module part.
    const script = state.script!;
    expect(script).not.toBeNull();
    const meta = script.metadata as {
      main_module: string;
      compatibility_date: string;
      compatibility_flags: string[];
      keep_bindings: string[];
      bindings: Record<string, unknown>[];
      assets: { jwt: string; config: { run_worker_first: string[] } };
    };
    expect(meta.main_module).toBe(bundle.manifest.mainModule);
    expect(meta.compatibility_date).toBe(bundle.manifest.compatibilityDate);
    expect(meta.compatibility_flags).toEqual(bundle.manifest.compatibilityFlags);
    expect(meta.keep_bindings).toEqual(["secret_text"]);
    expect(meta.assets.jwt).toBe(COMPLETION_JWT);
    expect(meta.assets.config.run_worker_first).toEqual(["/api/*", "/beat/*", "/admin", "/admin/*"]);
    expect(meta.bindings).toHaveLength(4);
    expect(meta.bindings).toContainEqual({
      type: "plain_text",
      name: "UPFLARE_VERSION",
      text: bundle.manifest.version,
    });
    expect(meta.bindings).toContainEqual({ type: "d1", name: "DB", database_id: db!.uuid });
    expect(meta.bindings).toContainEqual({ type: "assets", name: "ASSETS" });
    expect(meta.bindings).toContainEqual({ type: "plain_text", name: "UPFLARE_INSTALL_SOURCE", text: "cli" });
    expect(Object.keys(script.parts).sort()).toEqual(bundle.manifest.modules.map((m) => m.name).sort());
    for (const m of bundle.manifest.modules) {
      expect(script.parts[m.name]!.type).toBe(m.contentType);
      expect(script.parts[m.name]!.bytes).toEqual(bundle.modules[m.name]!);
    }

    // Every static asset reached the asset store.
    const assetHashes = new Set(
      Object.entries(bundle.assets).map(([p, b]) => expectedAssetHash(p, Buffer.from(b).toString("base64"))),
    );
    expect(assetHashes.size).toBeGreaterThan(0);
    expect(state.storedAssets).toEqual(assetHashes);
    expect(state.pendingAssets.size).toBe(0);

    // Secrets set once; given password kept verbatim; key is 32 bytes base64.
    expect(writesTo(state.log, "/workers/scripts/upflare/secrets", "PUT")).toHaveLength(2);
    expect(state.secrets.get("ADMIN_PASSWORD")).toBe(PASSWORD);
    expect(atob(state.secrets.get("ENCRYPTION_KEY")!).length).toBe(32);
    expect(state.schedules).toEqual(["* * * * *"]);
    expect(state.workersDev).toBe(true);
    expect(state.healthCalls).toBeGreaterThan(COLD_START_HEALTH_MISSES);

    // CLI output.
    expect(setupOut).toContain(`Upflare ${bundle.manifest.version} is ready.`);
    expect(setupOut).toContain(`https://${HEALTH_HOST}/`);
    expect(setupOut).toContain(`https://${HEALTH_HOST}/admin`);
    expect(setupOut).not.toContain("Admin password (shown once)");
    expect(setupOut).not.toContain(TOKEN);
    expect(setupOut).not.toContain(PASSWORD);
    expect(setupOut).not.toContain("✗");

    // ---- update ----
    const secretsBefore = new Map(state.secrets);
    const uploadsBefore = state.script;
    state.log = [];
    const upd = makeDeps(emu);
    const updateCode = await run(["update", "--yes", "--account", "acc1"], upd.deps);
    const updateOut = upd.out.join("\n");
    expect({ code: updateCode, out: updateOut }).toEqual({ code: 0, out: expect.any(String) });
    expect(state.unhandled).toEqual([]);
    expect(state.authFailures).toEqual([]);
    expect(strayFetches).toEqual([]);

    expect(writesTo(state.log, "/secrets", "PUT")).toEqual([]);
    expect(state.secrets).toEqual(secretsBefore);
    expect(writesTo(state.log, "/d1/database", "POST")).toEqual([]);
    expect(db!.ledger).toEqual(bundle.manifest.migrations);
    expect(writesTo(state.log, `/workers/scripts/${NAME}`, "PUT")).toHaveLength(1);
    expect(state.script).not.toBe(uploadsBefore);
    expect((state.script!.metadata as { keep_bindings: string[] }).keep_bindings).toEqual(["secret_text"]);
    // Assets already stored: the session asks for nothing, the session jwt is used directly.
    expect(writesTo(state.log, "/workers/assets/upload", "POST")).toEqual([]);
    expect((state.script!.metadata as { assets: { jwt: string } }).assets.jwt).toBe(SESSION_JWT);
    expect(updateOut).toContain(`Upflare ${bundle.manifest.version} is ready.`);
    expect(updateOut).not.toContain("Admin password (shown once)");
    expect(updateOut).not.toContain(TOKEN);
  }, 60_000);
});

describe("e2e: workers.dev blocked on this network (I1)", () => {
  const SHORT_POLL = { pollIntervalMs: 5, pollTimeoutMs: 100 };
  const blockedInstaller: Installer = {
    ...fastInstaller,
    install: (api, b, o) => install(api, b, { ...o, ...SHORT_POLL }),
    update: (api, b, o) => update(api, b, { ...o, ...SHORT_POLL }),
  };

  test("setup succeeds with a warning, a re-run sees the install, update works", async () => {
    const emu = createEmulator({ version: bundle.manifest.version, workersDevBlocked: true });
    const { state } = emu;
    const warning = `workers.dev isn't reachable from this network — open https://${HEALTH_HOST}/ in a browser or try another network.`;

    const setup = makeDeps(emu, blockedInstaller);
    const code = await run(["setup", "--yes", "--account", "acc1"], setup.deps);
    const out = setup.out.join("\n");
    expect({ code, out }).toEqual({ code: 0, out: expect.any(String) });
    expect(out).toContain(`Upflare ${bundle.manifest.version} is ready.`);
    expect(out).toContain(`! Installed, but ${warning}`);
    expect(out).not.toContain("✗");
    // Generated password printed exactly once, right after the secrets were set.
    const pw = state.secrets.get("ADMIN_PASSWORD")!;
    expect(out.split(pw)).toHaveLength(2);
    expect(state.healthCalls).toBeGreaterThan(0);
    expect(state.schedules).toEqual(["* * * * *"]);

    // Identity comes from the API: the blocked health endpoint does not make it look foreign.
    state.log = [];
    const again = makeDeps(emu, blockedInstaller);
    expect(await run(["setup", "--yes", "--account", "acc1"], again.deps)).toBe(1);
    expect(again.out.join("\n")).toContain(`Upflare ${bundle.manifest.version} is already installed as "${NAME}"`);
    expect(state.log.filter((l) => l.method !== "GET" && !l.path.endsWith("/query"))).toEqual([]);

    const upd = makeDeps(emu, blockedInstaller);
    expect(await run(["update", "--yes", "--account", "acc1"], upd.deps)).toBe(0);
    expect(upd.out.join("\n")).toContain(`! Updated, but ${warning}`);
    expect(state.unhandled).toEqual([]);
    expect(state.authFailures).toEqual([]);
    expect(strayFetches).toEqual([]);
  }, 60_000);
});
