# Edgebeat Install Plan A — Release Bundle, Installer Core, CLI, Deploy Button

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A developer runs `bunx edgebeat setup` (or `npx`), pastes a Cloudflare API token, and gets a working Edgebeat in their account; `edgebeat update` upgrades it; the repo is ready for a "Deploy to Cloudflare" button. All paths produce the same installation.

**Architecture:** A new npm package `edgebeat` in `cli/` (own `package.json`, not a workspace) holds the installer core (pure TS: `fetch` + Web Crypto, no fs) behind a `CloudflareApi` interface, a REST implementation of that interface, a release-bundle builder/loader, and the CLI. The Worker gains `version` + `installSource` on `/api/v1/health`. Task 0 fixes every shared contract so Tasks 1–5 run in parallel on disjoint directories.

**Tech Stack:** TypeScript strict, Bun (build, `bun test`), Node ≥ 20 compatible output (`npx`), Cloudflare REST API v4, Wrangler 4 (bundling only), existing Worker stack (Hono, D1, Vitest pool).

**Spec:** `docs/superpowers/specs/2026-11-09-edgebeat-install-design.md` (builds on `2026-11-09-edgebeat-design.md`).

## Global Constraints

- Installer core uses only `fetch`, Web Crypto, `TextEncoder`/`TextDecoder`, `atob`/`btoa`: no `node:*`, no `fs`, no Worker-only APIs (it must run in Bun, Node 20 and a Worker).
- Worker name default `edgebeat`; **D1 name = Worker name**; slug rule for names `^[a-z0-9-]{1,63}$`.
- `EDGEBEAT_INSTALL_SOURCE` ∈ `cli | cloud | git`; CLI installs set `cli`; `wrangler.jsonc` sets `git`. CLI/dashboard **refuse to update a `git` install** with: `This install is managed by its git repository. Pull upstream and redeploy to update.`
- Secrets are set **only if absent**: `ENCRYPTION_KEY` = 32 random bytes, standard base64; `ADMIN_PASSWORD` user-given or generated (24 chars from `A–Z a–z 0–9`).
- Admin password rule everywhere: length ≥ 12 and not `change-me`. Error copy: `Admin password must be at least 12 characters and not "change-me".`
- Script uploads always send `keep_bindings: ["secret_text"]` so updates never touch secrets.
- Migrations: drizzle files in `migrations/`, split on `--> statement-breakpoint`, applied in filename order, recorded in wrangler's table `d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)` using the file name (e.g. `0000_foo.sql`).
- Cron `* * * * *`; compatibility date and asset config come from the bundle manifest, never hard-coded in the core.
- Required token permissions (copy shown by CLI): `Account · Workers Scripts · Edit`, `Account · D1 · Edit`, `Account · Account Settings · Read`.
- The token is never written to disk or logs; the generated admin password is printed once.
- Commits: English, lowercase, no `Co-Authored-By`. Bun for everything; no classes; `const` over `let`.

## Review Focus

1. **Setup interrupted midway then re-run** (D1 created, script not uploaded) → resumes, re-uses the D1, does not regenerate existing secrets, ends healthy. Test: Task 4 `resumes after partial install`.
2. **Update on a working install** → new code + pending migrations only; `ADMIN_PASSWORD`/`ENCRYPTION_KEY` and data untouched. Test: Task 4 `update keeps secrets and applies only new migrations`.
3. **Name taken by a non-Edgebeat Worker** → refuses before any change. Test: Task 4 `refuses foreign worker with same name`.
4. **Account with no workers.dev subdomain** → CLI asks for one; non-interactive mode fails with a clear message before creating anything. Tests: Task 4 `requires subdomain before changes`, Task 5 `prompts for subdomain`.
5. **Token missing a permission / free-plan limit reached (10 D1, 100 Workers, cron slots)** → plain-language error naming the missing permission or limit, before any change (cron: mapped from the API error). Tests: Task 3 `maps 403 to missing permission`, Task 4 `stops on d1 limit before changes`.

---

## File Structure

```
src/version.ts                       # VERSION constant (Task 1)
src/api/app.ts, src/env.ts           # health + EDGEBEAT_INSTALL_SOURCE (Task 1)
wrangler.jsonc, .dev.vars.example, README.md   # button prep (Task 1)
package.json, tsconfig.json          # root scripts, packageManager, cloudflare.bindings (Task 0)
cli/
  package.json  tsconfig.json  bunfig.toml  README.md
  src/contracts.ts                   # ALL shared types (Task 0) — read-only for Tasks 1–5
  src/bundle/build.ts (+test)        # build release bundle dir from repo (Task 2)
  src/bundle/load.ts (+test)         # load bundle dir → ReleaseBundle (Task 2, uses node:fs — CLI only)
  src/cf/http.ts  src/cf/api.ts (+test)        # REST impl of CloudflareApi (Task 3)
  src/cf/assets.ts (+test)           # asset hashing + upload session flow (Task 3)
  src/installer/*.ts (+tests)        # core: plan/steps/secrets/migrations (Task 4)
  src/installer/fake-api.ts          # in-memory CloudflareApi for tests (Task 4)
  src/cli/*.ts (+tests)              # args, prompts, checklist, commands (Task 5)
  src/bin.ts                         # entry (Task 5)
  test/e2e.test.ts                   # real REST impl + core + CLI against mocked fetch (Task 6)
```

Parallel execution: **Task 0 first**, then **Tasks 1–5 in parallel** (each owns only the paths listed in its Files block; `cli/src/contracts.ts` is read-only after Task 0 — a needed change is reported, not made), then **Task 6**.

---

### Task 0: Package scaffold and shared contracts

**Files:**
- Create: `cli/package.json`, `cli/tsconfig.json`, `cli/bunfig.toml`, `cli/src/contracts.ts`, `cli/src/contracts.test.ts`
- Modify: root `package.json` (scripts, `packageManager`, `cloudflare.bindings`), root `tsconfig.json` only if `cli/` leaks into it

**Interfaces — Produces (`cli/src/contracts.ts`, exact):**

```ts
export type InstallSource = "cli" | "cloud" | "git";

export type ReleaseManifest = {
  version: string;                       // = root package.json version
  compatibilityDate: string;
  compatibilityFlags: string[];
  mainModule: string;                    // file name inside worker/
  modules: { name: string; contentType: string }[];  // every file in worker/ incl. mainModule
  crons: string[];                       // ["* * * * *"]
  assetsConfig: { run_worker_first: string[]; html_handling?: string; not_found_handling?: string };
  migrations: string[];                  // file names, ordered
  observability: boolean;
};

export type ReleaseBundle = {
  manifest: ReleaseManifest;
  modules: Record<string, Uint8Array>;   // worker/ files by name
  assets: Record<string, Uint8Array>;    // key = "/index.html" style path
  migrations: { name: string; sql: string }[];
};

export type Account = { id: string; name: string };
export type D1Info = { uuid: string; name: string };
export type ScriptBinding =
  | { type: "d1"; name: string; id: string }
  | { type: "assets"; name: string }
  | { type: "plain_text"; name: string; text: string };

export type CloudflareApi = {
  verifyToken(): Promise<{ ok: boolean; missing: string[] }>;   // missing = permission labels from Global Constraints
  listAccounts(): Promise<Account[]>;
  getSubdomain(accountId: string): Promise<string | null>;
  createSubdomain(accountId: string, subdomain: string): Promise<void>;
  countWorkers(accountId: string): Promise<number>;
  scriptExists(accountId: string, name: string): Promise<boolean>;
  listD1(accountId: string): Promise<D1Info[]>;
  createD1(accountId: string, name: string): Promise<D1Info>;
  queryD1(accountId: string, uuid: string, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  uploadAssets(accountId: string, scriptName: string, assets: Record<string, Uint8Array>): Promise<string>; // completion jwt
  putScript(accountId: string, name: string, input: {
    manifest: ReleaseManifest; modules: Record<string, Uint8Array>;
    assetsJwt: string; bindings: ScriptBinding[];
  }): Promise<void>;                     // must send keep_bindings ["secret_text"]
  listSecretNames(accountId: string, scriptName: string): Promise<string[]>;
  putSecret(accountId: string, scriptName: string, name: string, value: string): Promise<void>;
  putSchedules(accountId: string, scriptName: string, crons: string[]): Promise<void>;
  enableWorkersDev(accountId: string, scriptName: string): Promise<void>;
  fetchHealth(url: string): Promise<{ ok: boolean; version?: string; installSource?: InstallSource } | null>;
};

export type InstallErrorCode =
  | "missing_permission" | "no_subdomain" | "limit_workers" | "limit_d1" | "limit_cron"
  | "name_taken" | "already_installed" | "not_installed" | "git_managed"
  | "weak_password" | "invalid_name" | "health_failed" | "api_error";
export type InstallError = { code: InstallErrorCode; message: string };  // thrown as Error with .code via makeInstallError

export type InstallStep =
  | "verify" | "limits" | "subdomain" | "database" | "migrations"
  | "script" | "secrets" | "schedule" | "route" | "health";
export type InstallEvent =
  | { step: InstallStep; status: "start" | "done" | "skip"; detail?: string }
  | { step: InstallStep; status: "fail"; error: InstallError };

export type InstallOptions = {
  accountId: string;
  name: string;                          // worker + D1 name
  source: InstallSource;
  adminPassword?: string;                // undefined → generate if absent
  subdomain?: string;                    // used only if the account has none
  onEvent?: (e: InstallEvent) => void;
};
export type InstallResult = {
  statusUrl: string; adminUrl: string;   // https://<name>.<sub>.workers.dev/ and …/admin
  version: string; generatedPassword: string | null;  // non-null only if generated this run
};
```
(Write `InstallError` as a plain `Error` with a `code` property plus `makeInstallError(code, message)` and `isInstallError(e)` helpers — no classes.)

- [ ] **Step 1:** `cli/package.json`: `name: "edgebeat"`, `version` = root version, `type: "module"`, `bin: { edgebeat: "dist/bin.js" }`, `exports: { "./installer": "./dist/installer.js" }`, `files: ["dist", "bundle"]`, `engines: { node: ">=20" }`, scripts `test: "bun test"`, `build: "bun build src/bin.ts src/installer/index.ts --target node --outdir dist"`, `bundle: "bun src/bundle/build.ts"`, `prepublishOnly: "bun run bundle && bun run build"`. `cli/bunfig.toml`: `[test] root = "src"` plus `test` dir. `cli/tsconfig.json` strict, `lib: ["ES2022", "DOM"]` (for `fetch`/`Response` types), `types: ["bun"]`.
- [ ] **Step 2:** Write `contracts.ts` exactly as above; `contracts.test.ts`: `makeInstallError("weak_password", m)` → `isInstallError` true, `.code === "weak_password"`, `.message === m`; plain `Error` → false.
- [ ] **Step 3:** Root `package.json`: `"packageManager": "bun@<installed version>"`, `"test": "bun test && vitest run && bun --cwd cli test"`, `"cloudflare": { "bindings": { "ADMIN_PASSWORD": { "description": "Password for the Edgebeat admin. **At least 12 characters**, not `change-me`." }, "ENCRYPTION_KEY": { "description": "32 random bytes, base64. Generate with `openssl rand -base64 32`." } } }`.
- [ ] **Step 4:** `bun run test` and `bunx tsc --noEmit -p cli` → pass. Commit `chore(cli): scaffold edgebeat package and install contracts`.

---

### Task 1: Worker health version, install source, button prep

**Files:**
- Create: `src/version.ts`, `test/worker/version.spec.ts`
- Modify: `src/api/app.ts:12`, `src/env.ts`, `wrangler.jsonc`, `.dev.vars.example`, `README.md`, `test/worker/health.spec.ts`

**Interfaces:** Produces `GET /api/v1/health` → `{ ok: true, version: string, installSource: "cli" | "cloud" | "git" | null }` (consumed by Task 3 `fetchHealth`). `Env.EDGEBEAT_INSTALL_SOURCE?: string`.

- [ ] **Step 1:** Failing tests: health returns `version === VERSION`; `installSource === "git"` under the test config (vars from `wrangler.jsonc`); an unknown value maps to `null`. `version.spec.ts`: `VERSION` equals root `package.json` `version`.
- [ ] **Step 2:** `bunx vitest run test/worker/health.spec.ts test/worker/version.spec.ts` → FAIL.
- [ ] **Step 3:** `src/version.ts` `export const VERSION = "0.1.0"`; health handler; `Env` field.
- [ ] **Step 4:** `wrangler.jsonc`: add `"vars": { "EDGEBEAT_INSTALL_SOURCE": "git" }`; **remove `database_id`** (auto-provisioning). Confirm local `vitest run` and `bunx wrangler deploy --dry-run --outdir /tmp/eb` still work without it; if the pool requires an id, keep a local-only override in `vitest.config.ts`, not in `wrangler.jsonc`.
- [ ] **Step 5:** `.dev.vars.example`: `ADMIN_PASSWORD=` with comment `# at least 12 characters, not "change-me"`, keep the `ENCRYPTION_KEY` comment.
- [ ] **Step 6:** README: add "Install" section with three paths in this order — CLI (`bunx edgebeat setup`, token permissions from Global Constraints), Deploy to Cloudflare button (markdown `[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/edgebeat-dev/edgebeat)` with a note "requires a GitHub account; updates by pulling upstream"), manual (existing steps, updated for no `database_id`). Keep curl examples.
- [ ] **Step 7:** `bun run test` + `bun run typecheck` → pass. Commit `feat: report version and install source on health`.

---

### Task 2: Release bundle builder and loader

**Files:** Create `cli/src/bundle/build.ts`, `cli/src/bundle/build.test.ts`, `cli/src/bundle/load.ts`, `cli/src/bundle/load.test.ts`

**Interfaces:**
- Consumes: `ReleaseManifest`, `ReleaseBundle` (Task 0).
- Produces: `buildBundle(repoRoot: string, outDir: string): Promise<ReleaseManifest>` and `loadBundle(dir: string): Promise<ReleaseBundle>`. Layout of `outDir`: `manifest.json`, `worker/*`, `assets/**`, `migrations/*.sql`. `cli/bundle/` is the default `outDir` for publishing (git-ignored).

- [ ] **Step 1:** Failing tests (`build.test.ts`, runs real builds, may take ~30 s): after `buildBundle(repoRoot, tmp)` → `manifest.version` = root version, `compatibilityDate` = `wrangler.jsonc` value, `crons` = `["* * * * *"]`, `assetsConfig.run_worker_first` = `["/api/*", "/beat/*"]`, `migrations` = sorted file names of `migrations/*.sql`, `mainModule` file exists in `worker/`, `assets/index.html` exists and contains `<div id="app">`. `load.test.ts`: round-trip — every manifest module present as bytes, asset keys start with `/`, migrations in manifest order with SQL text.
- [ ] **Step 2:** `bun --cwd cli test src/bundle` → FAIL.
- [ ] **Step 3:** `buildBundle`: run root `vite build`, then `wrangler deploy --dry-run --outdir <tmp>` (bundling only; no network/auth) and copy its output to `worker/`; read `wrangler.jsonc` (strip comments) for compat date/flags/crons/assets/observability; copy `dist/status-page` → `assets/`, `migrations/*.sql` → `migrations/`. Content types: `.js` → `application/javascript+module`, `.map` → `application/source-map`, others `application/octet-stream`.
- [ ] **Step 4:** → PASS. Commit `feat(cli): build and load release bundles`.

---

### Task 3: Cloudflare REST implementation of `CloudflareApi`

**Files:** Create `cli/src/cf/http.ts`, `cli/src/cf/api.ts`, `cli/src/cf/api.test.ts`, `cli/src/cf/assets.ts`, `cli/src/cf/assets.test.ts`

**Interfaces:**
- Consumes: `CloudflareApi` and types (Task 0).
- Produces: `createCloudflareApi(token: string, opts?: { fetch?: typeof fetch; baseUrl?: string }): CloudflareApi` (default base `https://api.cloudflare.com/client/v4`); `assetHash(path: string, bytes: Uint8Array): Promise<string>`.

Endpoints (verify field names against the current API reference while implementing; adjust only internals):
`GET /user/tokens/verify`; `GET /accounts`; `GET|PUT /accounts/{a}/workers/subdomain`; `GET /accounts/{a}/workers/scripts`; `GET /accounts/{a}/workers/scripts/{n}` (404 → false); `GET|POST /accounts/{a}/d1/database`; `POST /accounts/{a}/d1/database/{uuid}/query` `{ sql, params }`; assets: `POST /accounts/{a}/workers/scripts/{n}/assets-upload-session` `{ manifest }` → `{ jwt, buckets }`, then `POST /accounts/{a}/workers/assets/upload?base64=true` (Bearer = session jwt, multipart, one bucket per request) → final completion `jwt`; `PUT /accounts/{a}/workers/scripts/{n}` multipart (`metadata` JSON part + module parts); `GET /accounts/{a}/workers/scripts/{n}/secrets`; `PUT .../secrets` `{ name, text, type: "secret_text" }`; `PUT .../schedules` `[{ cron }]`; `POST .../subdomain` `{ enabled: true, previews_enabled: false }`.

- [ ] **Step 1:** Failing tests with an injected `fetch` that records requests and returns canned Cloudflare envelopes (`{ success, errors, result }`):
  - every request has `Authorization: Bearer <token>`; token never appears in thrown error messages;
  - `putScript` metadata contains `main_module`, `compatibility_date`, `compatibility_flags`, `assets: { jwt, config }` with `run_worker_first`, bindings incl. `{ type: "assets", name: "ASSETS" }`, `keep_bindings: ["secret_text"]`, and one part per module with the manifest content type;
  - `uploadAssets`: only hashes listed in `buckets` are uploaded, one request per bucket, base64 bodies, returns the completion jwt; empty `buckets` → returns the session jwt without uploads;
  - `assetHash` = first 32 hex chars of SHA-256 over `base64(bytes) + extension` (extension without dot; known vector computed in-test);
  - `maps 403 to missing permission`: a 403 / code 10000 error → `InstallError` `missing_permission` whose message names the permission for that endpoint family (scripts → Workers Scripts, d1 → D1, accounts → Account Settings);
  - `getSubdomain` → `null` when the API reports no subdomain;
  - `createD1` error code for D1 limit → `limit_d1`; `putSchedules` cron-limit error → `limit_cron`; other failures → `api_error` with Cloudflare's message;
  - `fetchHealth`: 200 JSON → parsed; network error / non-JSON / non-200 → `null`.
- [ ] **Step 2:** `bun --cwd cli test src/cf` → FAIL. **Step 3:** implement (`http.ts` = request + envelope + error mapping; `api.ts` = the interface; `assets.ts` = hashing + session flow). **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(cli): cloudflare rest client for installs`.

---

### Task 4: Installer core

**Files:** Create `cli/src/installer/index.ts`, `install.ts`, `install.test.ts`, `migrations.ts`, `migrations.test.ts`, `secrets.ts`, `secrets.test.ts`, `fake-api.ts`

**Interfaces:**
- Consumes: `CloudflareApi`, `ReleaseBundle`, `InstallOptions/Result/Event`, error helpers (Task 0).
- Produces (re-exported from `installer/index.ts`, the `edgebeat/installer` entry):
  - `install(api: CloudflareApi, bundle: ReleaseBundle, opts: InstallOptions): Promise<InstallResult>`
  - `update(api: CloudflareApi, bundle: ReleaseBundle, opts: Omit<InstallOptions, "adminPassword" | "subdomain">): Promise<InstallResult>`
  - `validateAdminPassword(p: string): void` (throws `weak_password`), `validateName(n: string): void` (throws `invalid_name`)
  - `pendingMigrations(applied: string[], bundle: ReleaseBundle): { name: string; statements: string[] }[]`
  - `generatePassword(): string`, `generateEncryptionKey(): string`
  - `createFakeApi(seed?: Partial<FakeState>): CloudflareApi & { state: FakeState }` (test helper, exported from `fake-api.ts` only)

Step order and rules (`install`): `verify` (missing → `missing_permission`) → `limits` (D1 count ≥ 10 → `limit_d1`, Workers ≥ 100 → `limit_workers`, both only when the D1/Worker would be **new**) → name checks: script exists + health has a version → `already_installed`; script exists without Edgebeat health → `name_taken` → `subdomain` (none and no `opts.subdomain` → `no_subdomain`; else create) → `database` (find by name or create) → `migrations` (ensure `d1_migrations`, apply pending in order, insert name after each file) → `script` (upload assets, put script with bindings `DB`, `ASSETS`, `EDGEBEAT_INSTALL_SOURCE`=`opts.source`) → `secrets` (list names; set `ENCRYPTION_KEY` if absent; `ADMIN_PASSWORD` if absent: validated given value or generated) → `schedule` → `route` → `health` (poll `fetchHealth` every 3 s up to 90 s until `version === manifest.version`, else `health_failed` with the URL). All checks that can refuse run **before** the first write. Each step emits `start` then `done`/`skip`; a thrown `InstallError` emits `fail` and rethrows.
`update`: requires health with a version (`not_installed` otherwise) and `installSource !== "git"` (`git_managed` with the Global Constraints copy); runs `database` (must exist) → `migrations` → `script` → `schedule` → `route` → `health`; never touches secrets.

- [ ] **Step 1:** Failing tests on `createFakeApi`:
  - fresh account → events in step order, all `done`; fake has D1 named `opts.name`, script with the 3 bindings, both secrets, schedule `["* * * * *"]`, migrations recorded; result URLs `https://edgebeat.<sub>.workers.dev/` and `/admin`; `generatedPassword` length 24.
  - `resumes after partial install`: seed D1 + `d1_migrations` with the first migration + `ENCRYPTION_KEY` present → no new D1, only remaining migrations applied, `ENCRYPTION_KEY` unchanged, `ADMIN_PASSWORD` set once.
  - `update keeps secrets and applies only new migrations`: installed v0.1.0 with secrets → update with a bundle adding `0001_x.sql` → only that migration run, secret values unchanged, script updated with `keep_bindings`.
  - `refuses foreign worker with same name`: script exists, health `null` → `name_taken`, zero write calls recorded.
  - `requires subdomain before changes`: no subdomain, no option → `no_subdomain`, zero writes.
  - `stops on d1 limit before changes`: 10 D1 in account, none named `edgebeat` → `limit_d1`, zero writes.
  - `update` on `installSource: "git"` → `git_managed` with the exact copy; on no install → `not_installed`.
  - weak given password (`"change-me"`, 11 chars) → `weak_password` before any write.
  - `pendingMigrations`: splits on `--> statement-breakpoint`, trims, drops empty statements, keeps file order, skips applied names.
  - `generateEncryptionKey()` decodes to 32 bytes; `generatePassword()` matches `^[A-Za-z0-9]{24}$` and two calls differ.
- [ ] **Step 2:** `bun --cwd cli test src/installer` → FAIL. **Step 3:** implement (fake records every write call in `state.writes`). **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(cli): installer core with resumable install and update`.

---

### Task 5: CLI

**Files:** Create `cli/src/bin.ts`, `cli/src/cli/args.ts`, `args.test.ts`, `cli/src/cli/run.ts`, `run.test.ts`, `cli/src/cli/prompt.ts`, `cli/src/cli/checklist.ts`, `cli/README.md`

**Interfaces:**
- Consumes: `install`, `update`, `validateAdminPassword`, `validateName` (Task 4, via `../installer`), `createCloudflareApi` (Task 3), `loadBundle` (Task 2), contracts (Task 0). Code against these signatures; tests inject fakes.
- Produces: `run(argv: string[], deps: { api: (token: string) => CloudflareApi; bundle: () => Promise<ReleaseBundle>; io: Io }): Promise<number>` (exit code) where `Io = { prompt(q: string, opts?: { secret?: boolean }): Promise<string>; print(line: string): void; isTTY: boolean; env: Record<string, string | undefined> }`. `bin.ts` wires real deps (bundle dir = `<package>/bundle`).

Commands and flags: `edgebeat setup|update|help|--version`; flags `--api-token`, `--account <id>`, `--name <name>` (default `edgebeat`), `--admin-password <p>`, `--subdomain <s>`, `--yes` (non-interactive). Token resolution: `--api-token` → `CLOUDFLARE_API_TOKEN` → interactive paste (secret input) after printing the permission list and `https://dash.cloudflare.com/profile/api-tokens`. Account: single → auto; several → numbered pick; `--account` wins. Password: interactive asks "Choose an admin password (leave empty to generate)"; validated with `validateAdminPassword`, re-asked on failure. Output: checklist line per step (`✓ Database`, `✗ Script — <message>`), then the result block printing status URL, admin URL and, if generated, `Admin password (shown once): <p>`. Exit 0 success, 1 install error, 2 usage error.

- [ ] **Step 1:** Failing tests with fake deps:
  - `args`: parses all flags; unknown flag → usage error (exit 2) listing valid flags.
  - token from env used without prompting; missing token with `--yes` → exit 2 and message naming `CLOUDFLARE_API_TOKEN`.
  - two accounts + interactive → prompt shows both names; `--yes` without `--account` → exit 2.
  - `prompts for subdomain`: install throws `no_subdomain` once in interactive mode → CLI asks for a subdomain, retries with it, succeeds.
  - weak password typed then strong → re-asked once, install called with the strong one.
  - success output contains both URLs and the generated password exactly once; token never printed.
  - `update` with `git_managed` → exit 1 and the exact Global Constraints copy.
- [ ] **Step 2:** `bun --cwd cli test src/cli` → FAIL. **Step 3:** implement (`prompt.ts` with `node:readline/promises`, secret input without echo; colours only when `isTTY`). **Step 4:** → PASS.
- [ ] **Step 5:** `cli/README.md`: usage, flags, token permissions, what gets created, update rules. Commit `feat(cli): edgebeat setup and update commands`.

---

### Task 6: Integration, packaging, docs

**Files:** Create `cli/test/e2e.test.ts`; Modify: `cli/package.json` (only if wiring needs it), `.gitignore` (`cli/bundle`, `cli/dist`), `docs/superpowers/specs/2026-11-09-edgebeat-install-design.md` (status line only)

**Interfaces:** Consumes everything above with real implementations.

- [ ] **Step 1:** Failing e2e test: build a real bundle (`buildBundle`) into a tmp dir; run `run(["setup", "--yes", "--account", "acc1", "--admin-password", "a-strong-password-1"], deps)` where `api` = **real** `createCloudflareApi` with an injected `fetch` that emulates the Cloudflare endpoints in memory (accounts, subdomain, scripts, D1 with a real SQL-free migrations ledger, assets session, secrets, schedules) and whose health URL answers `{ ok: true, version, installSource: "cli" }` after the script is uploaded → exit 0; recorded script upload contains every bundle module and the 3 bindings; then `run(["update", "--yes", "--account", "acc1"])` → exit 0 with no secret writes.
- [ ] **Step 2:** → FAIL until wiring is fixed; fix seams (only in the Task 6 file list, or report). **Step 3:** → PASS.
- [ ] **Step 4:** `cd cli && bun run bundle && bun run build && node dist/bin.js --version` prints the version; `npm pack --dry-run` lists `dist/` and `bundle/` only.
- [ ] **Step 5:** Root `bun run test`, `bun run typecheck`, `bunx tsc --noEmit -p cli` → pass. Commit `test(cli): end-to-end install and update against emulated api`.

---

## Owner verification (not agent work)

After the repo is public and the npm name is reserved: run `bunx edgebeat setup` and the Deploy button once each on a throwaway free account; confirm health, the status page, cron firing, and that `edgebeat update` refuses the button install with the `git_managed` message.
