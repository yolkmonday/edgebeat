# Edgebeat — Install Design

Date: 2026-11-09
Status: approved by owner 2026-11-09
Builds on: `2026-11-09-edgebeat-design.md` (Plan 1 merged to `main` at `fa2fb60`).

Marked **[owner]** = decided by the owner in conversation. Marked **[call]** =
Claude's call, owner may override. Unmarked = from research or constraints.

---

## 1. Intent and why

Edgebeat runs on the user's own Cloudflare account. Today the only install
path is the README's manual steps: create a D1, put its id in
`wrangler.jsonc`, generate secrets, run migrations, deploy. That stops anyone
who does not write code, and slows down everyone who does.

The owner wants two audiences served from day one **[owner]**:

1. **Non-technical people.** They sign up on a hosted web dashboard, connect
   their Cloudflare account, click install, and get a working status page.
   No terminal, no GitHub, no code.
2. **Developers.** They install from their terminal or self-host from the
   repo, with full control and no dependency on the hosted dashboard.

The hosted dashboard is **only an installer ("tukang pasang") [owner]**. After
install, the user manages monitors in the admin of their own Edgebeat
Worker. The dashboard never becomes the place where monitoring lives.

### Success looks like
- A non-technical person goes from "Get started" on the dashboard to an
  installed Edgebeat with its status page URL in under 5 minutes, without
  creating an API token by hand.
- A developer runs one command and gets the same result.
- A developer with a GitHub account can click "Deploy to Cloudflare" in the
  README and get the same result.
- All three paths produce the **same** installation (same Worker name
  pattern, same D1, same secrets, same migrations), so docs and support are
  written once.
- An installed Edgebeat keeps working if the dashboard or `edgebeat.sh` is
  down or disappears forever.

### Goals
- One shared **installer core** that installs and updates Edgebeat in a
  Cloudflare account through the Cloudflare REST API.
- **CLI** for developers, built on the installer core.
- **Deploy to Cloudflare button** in the README.
- **Hosted installer dashboard** for non-technical users, built on the
  installer core.
- **Update** path for CLI and dashboard installs (new version → new
  migrations + new Worker code, secrets and data untouched).

### Non-goals
- The dashboard managing monitors, showing statuses, or aggregating many
  instances. That is the instance's own admin (Plan 3).
- Billing, plans, teams on the dashboard.
- Installing anywhere other than Cloudflare.
- Custom domains during install (users add them in Cloudflare afterwards;
  docs explain). [call]

### Anti-goals (failure even if it "works")
- The dashboard **keeps standing access** to users' Cloudflare accounts.
- An installed Edgebeat **depends on** the dashboard or `edgebeat.sh` at
  runtime.
- The three paths drift and produce different installations.
- Install half-fails and leaves the user with a broken Worker and no clear
  next step. Every step must be safe to re-run.
- The admin password is shown in a place that persists (dashboard database,
  logs, URLs).

---

## 2. Constraints (verified 2026-11-09)

- **Cloudflare OAuth for third-party apps exists** (launched 2026-06-03).
  Authorization Code flow; server apps use a client secret; CLIs use PKCE
  (S256). Scope names match API token permission names. A client is private
  until made **public**, which needs a name, logo, client URL, scopes and DNS
  verification of its domain, and is permanent. Account admins can block
  public OAuth apps for their account. Endpoints:
  `dash.cloudflare.com/oauth2/{auth,token,revoke}`.
- **Deploy to Cloudflare button**: repo must be public on github.com or
  gitlab.com; it clones the repo into the user's own GitHub/GitLab account
  and deploys it with Workers Builds (Bun available, version from
  `packageManager`). It provisions D1 from the wrangler config. It prompts
  for secrets listed in `.dev.vars.example`, with descriptions from
  `cloudflare.bindings.<NAME>.description` in `package.json`. It runs the
  `deploy` script, which must apply migrations itself. ID-less D1 bindings
  are auto-provisioned by wrangler ≥ 4.45 (open beta; not yet proven inside
  Workers Builds).
- **Deploying without wrangler**: Workers Static Assets direct upload
  (`assets-upload-session` → upload buckets → script `PUT` with `assets.jwt`),
  D1 create + D1 query API for migrations, script secrets API, schedules API,
  account workers.dev subdomain API. Wrangler has no programmatic deploy API.
- **Free-plan limits that can block an install**: 5 cron triggers per
  account (Edgebeat uses 1), 100 Workers, 10 D1 databases, workers.dev
  subdomain must exist at account level.
- Minimal permissions: Workers Scripts Edit (scripts, secrets, schedules,
  subdomain), D1 Edit, Account Settings Read. Exact OAuth scope ids are to be
  read from `GET /client/v4/oauth/scopes` when the client is registered.

---

## 3. Architecture

```
            ┌──────────── installer core (TypeScript, no Node/Worker-only APIs) ─────────┐
            │ plan(account) → steps → apply(step) … idempotent, resumable, reports progress│
            │ Cloudflare REST client (token in, nothing stored)                            │
            └───────▲───────────────────────────────▲──────────────────────────────────────┘
                    │                               │
   CLI `edgebeat` (npm)                      Hosted installer (Worker on edgebeat.sh)
   OAuth PKCE or --api-token                 OAuth code flow, token in memory only
                    │                               │
                    └──────────► user's Cloudflare account ◄──────┘
                                 Worker "edgebeat" + D1 "edgebeat" + cron + secrets

   Deploy button (README) ──► Workers Builds runs `bun run deploy` (wrangler) ──► same result
```

### 3.1 Release bundle [call]
Every Edgebeat version produces one **release bundle**: the bundled Worker
module(s), the built status-page assets, the SQL migrations, and a
`manifest.json` (version, compatibility date, bindings, cron, asset config
incl. `run_worker_first`, migration list). Built by a repo script from the
same sources `wrangler deploy` uses, so the button path and the API paths
deploy identical code. Published with each release (GitHub Release asset and
inside the npm package). The installer core only ever deploys a release
bundle, never raw source.

### 3.2 Installer core [call]
- Pure TypeScript using `fetch` and Web Crypto only, so it runs in Bun/Node
  (CLI) and in a Worker (dashboard).
- Input: an access token (OAuth or API token), an account id, options
  (worker name, default `edgebeat`; site name; admin password or "generate").
- Steps, each idempotent and checked before it acts:
  1. Verify token and permissions; list accounts the token can see.
  2. Check limits up front (cron slots, Worker count, D1 count) and fail
     with a plain-language message before changing anything.
  3. Ensure account workers.dev subdomain (if missing, ask the user for one).
  4. Find or create D1 `edgebeat` (re-use if it exists and has Edgebeat
     tables).
  5. Apply pending migrations through the D1 query API, recording them in
     wrangler's `d1_migrations` table format so `wrangler d1 migrations
     apply` keeps working for people who later switch to the repo.
  6. Upload assets and the Worker script with bindings (`DB`, `ASSETS`),
     compatibility date and observability from the manifest.
  7. Set secrets **only if absent**: `ENCRYPTION_KEY` always generated (32
     random bytes, base64); `ADMIN_PASSWORD` from the user or generated.
  8. Set the cron schedule; enable the workers.dev route for the script.
  9. Smoke check: `GET https://<worker>.<subdomain>.workers.dev/api/v1/health`.
- **Update** = same steps with a newer bundle; secrets and D1 data are never
  overwritten; migrations are forward-only.
- Output: status page URL, admin URL, and the admin password **once** (only
  when it was generated).
- Progress is reported as step events so the CLI and the web UI can show the
  same checklist.

### 3.3 CLI [call]
- npm package `edgebeat`, run with `bunx edgebeat <cmd>` or
  `npx edgebeat <cmd>`; ships the release bundle of its own version.
- `edgebeat setup`: interactive (account picker, worker name, password
  choice), then the installer core with a live checklist.
- `edgebeat update`: deploys the bundle of the installed CLI version to an
  existing install.
- Auth: Cloudflare OAuth with PKCE through Edgebeat's public OAuth client and
  a localhost callback; `--api-token` / `CLOUDFLARE_API_TOKEN` for CI and for
  people who prefer tokens. The token is used for the run and discarded.
- Non-interactive flags for scripting (`--account`, `--name`,
  `--admin-password`, `--yes`).

### 3.4 Deploy to Cloudflare button
- README button pointing at the public repo.
- `wrangler.jsonc` D1 binding without `database_id` (auto-provisioning);
  `deploy` script already applies migrations; `packageManager` set to Bun.
- `.dev.vars.example` prompts `ADMIN_PASSWORD` and `ENCRYPTION_KEY` with
  `cloudflare.bindings` descriptions (how to generate the key).
- Must be proven end to end on a throwaway account before it goes in the
  README. If ID-less D1 does not work in Workers Builds, the fallback is a
  `deploy` script step that creates/looks up the D1 by name. [call]

### 3.5 Hosted installer dashboard [owner: installer only]
- Lives at `edgebeat.sh` (e.g. `edgebeat.sh/install`) [call]; a separate
  Worker in its own repo (`edgebeat-dev/edgebeat-cloud`) [call], so the OSS
  repo stays self-contained. Stack per owner defaults: Hono on Workers, React
  + Vite + Tailwind + shadcn for the UI.
- **Sign-up = "Continue with Cloudflare"** (OAuth). No separate password,
  no email collection, no dashboard account. [owner]
- Flow: Continue with Cloudflare → pick account → choose name and password
  (or generate) → Install (live checklist from installer core) → "Done":
  status page link, admin link, password shown once with a copy button.
- **No standing access**: the access token lives only in the request /
  session memory for the install; it is revoked (`oauth2/revoke`) when the
  install finishes or fails. No refresh token requested. [call]
- **Update**: the user comes back, signs in again, the dashboard detects the
  installed version (from the Worker's `/api/v1/health` version field) and
  offers "Update to vX".
- Stores at most: Cloudflare user id (from OAuth), account id, worker URL,
  installed version, timestamps — to show "your installations" and update
  notices. Never tokens, never passwords, never email. [call]
- The dashboard is never contacted by an installed Edgebeat.

### 3.6 Changes needed in the Edgebeat Worker itself
- `/api/v1/health` returns `{ ok, version }` so installers can detect what
  is installed.
- The admin first-run experience (Plan 3) is where every path lands after
  install. Until Plan 3 ships, the installer "Done" screen links to the
  status page and shows README instructions for adding monitors.

---

## 4. Order of work [owner agreed the order]

1. ~~Plan 1 merged~~ (done, `fa2fb60`).
2. **Install plan A**: release bundle, installer core, CLI, health version,
   Deploy button (button verified on a real account by the owner).
3. **Plan 3**: admin UI with first-run wizard (both audiences need it to add
   monitors without curl).
4. **Install plan B**: hosted installer dashboard (needs the public OAuth
   client and domain verification on `edgebeat.sh`).

---

## 5. Owner actions (cannot be done by agents)

- Create GitHub org `edgebeat-dev` and make the repo public (Deploy button
  needs a public repo).
- Register a Cloudflare **public OAuth client** for Edgebeat (name, logo,
  `edgebeat.sh` DNS verification, redirect URIs for the CLI localhost
  callback and the dashboard).
- Reserve npm package name `edgebeat`.
- Run the Deploy-button and CLI installs once on a throwaway free account.

---

## 6. Decisions from the builder check [call]

- **Install source is recorded.** Every install sets a plain-text Worker
  variable `EDGEBEAT_INSTALL_SOURCE` = `cli`, `cloud` or `git` (the Deploy
  button / repo path sets `git` in `wrangler.jsonc` `vars`). `/api/v1/health`
  returns it with the version. The CLI and the dashboard **refuse to update a
  `git` install** and explain: "this install is managed by your repo — pull
  upstream to update". This keeps the button's Workers Builds from fighting
  the installer.
- **D1 name = Worker name.** The installer finds or creates a D1 named
  exactly like the Worker (default `edgebeat`). Two instances never share a
  database. "Already installed" = a Worker with that name whose health
  endpoint answers with an Edgebeat version.
- **Where the code lives.** The OSS repo root stays the Worker (the Deploy
  button needs a self-contained root). The installer core and the CLI live in
  one npm package `edgebeat`, in `cli/` with its own `package.json` (not a
  Bun workspace, so the button's `bun install` at the root is unaffected). It
  has two entry points: the `edgebeat` binary and `edgebeat/installer` (the
  core). The hosted dashboard depends on that npm package at an exact
  version, so there is one copy of the install logic. The release bundle is
  produced in the OSS repo and embedded in the npm package at publish time.
- **CLI auth in plan A.** Plan A ships with `--api-token` /
  `CLOUDFLARE_API_TOKEN` and a guided prompt: the CLI prints the exact
  permissions to choose and a link to the Cloudflare API tokens page, then
  asks the user to paste the token. OAuth PKCE is added as soon as the public
  OAuth client exists. The client id is a constant in the package (it is not
  secret).
- **Dashboard session (plan B).** The core keeps no hidden state between
  steps: every step re-checks the account, so an install can be resumed from
  any step. Plan B holds the access token in a Durable Object for the length
  of one install session (memory only, not persisted storage), streams the
  checklist to the browser, and revokes the token at the end or after 15
  minutes idle. Exact mechanics are decided when plan B is written.
- **Admin password rule is the same everywhere.** At least 12 characters and
  not `change-me`, the rule the Worker already enforces at login. The CLI and
  the dashboard validate it before setting the secret. The Deploy button's
  prompt description states the rule. `.dev.vars.example` ships with an empty
  `ADMIN_PASSWORD`, not `change-me`.

## 7. Left to the builder

- Release bundle format details and how it is produced from the Vite +
  wrangler build.
- REST client structure, retry/backoff, pagination.
- How the CLI renders the checklist and prompts.
- Exact OAuth scope ids (read from the API at registration time).
- Dashboard page layout within the flow above.

## 8. Owner answers

- **Q1.** Sign-up is "Continue with Cloudflare" only; no email, no separate
  dashboard account. [owner, 2026-11-09]
