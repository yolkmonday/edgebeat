# Edgebeat

Open-source uptime monitor and public status page that runs as a single Cloudflare Worker (Hono, D1 via Drizzle, Workers Static Assets). A cron trigger runs checks every minute; the status page is a static page that reads `GET /api/v1/status`.

## Status

Plans 1 and 3. Working: HTTP, TCP and heartbeat monitors, state transitions, 90-day daily stats, public status JSON, static status page, the admin UI at `/admin` (first-run wizard, monitors, heartbeats, groups, status page, settings, API tokens, import/export) and the admin REST API. Not yet built: alert channels, incidents, maintenance windows.

The number of monitors the free Workers plan can handle per tick is a target, not a measurement. It is pending a real benchmark on a free account.

On the free plan a Worker invocation may make 50 subrequests, and every redirect hop counts as one. Each tick therefore caps itself at 44 subrequests (40 checks + 4 retries; 6 stay reserved for alerts): initial fetches, retries, redirect hops and TCP connects all count. A check that cannot get a subrequest is not run this minute; it is carried to the next tick, never marked down. The paid plan caps at 1,000. A `checkBudget` override can lower the free-plan budget of 40 but not raise it.

## Install

Three paths, in order of effort. All of them need a Cloudflare account. Today only the manual path (3) works; the other two are not available yet.

### 1. CLI (coming soon — not yet published)

The `edgebeat` package is not on npm yet, so this command does not work today.

```sh
export CLOUDFLARE_API_TOKEN=...   # preferred over --api-token, which shows up in ps and shell history
bunx edgebeat setup
```

The CLI reads the token from `CLOUDFLARE_API_TOKEN` (or asks for it, hidden) and installs the Worker, its D1 database and secrets. Create the token with these permissions:

- `Account · Workers Scripts · Edit`
- `Account · D1 · Edit`
- `Account · Account Settings · Read`

The token is never written to disk. The generated admin password is printed once.

### 2. Deploy to Cloudflare button (coming soon — not yet verified)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yolkmonday/edgebeat)

Not yet verified end to end on a real account; use the manual path until it is. Requires a GitHub account (Cloudflare copies the repository into it). Updates by pulling upstream and redeploying.

### 3. Manual

Requires [Bun](https://bun.sh).

```sh
bun install
bunx wrangler login
```

`wrangler.jsonc` has no `database_id`: the first deploy creates the `edgebeat` D1 database automatically. Set the secrets and deploy:

```sh
bunx wrangler secret put ADMIN_PASSWORD   # at least 12 characters; login is refused otherwise
bunx wrangler secret put ENCRYPTION_KEY   # base64 of 32 random bytes: openssl rand -base64 32
bun run deploy                            # builds the page, deploys, then applies migrations (remote)
```

`bun run deploy` deploys before migrating because the first deploy is what creates the D1 database. For the few seconds until the migrations finish, the Worker runs without its tables: cron ticks and status requests fail harmlessly and recover on their own.

Then open `https://<your-worker>/admin` to add your first monitor (see [Admin](#admin)).

## Local development

Create `.dev.vars` (git-ignored):

```
ADMIN_PASSWORD=choose-a-password
ENCRYPTION_KEY=<openssl rand -base64 32>
```

```sh
bunx wrangler d1 migrations apply DB --local
bun run dev                                   # http://localhost:8787 (admin: /admin), cron testable
curl "http://localhost:8787/cdn-cgi/handler/scheduled"   # run one tick
bun run test                                  # builds the page, then bun test + vitest
bun run typecheck
```

## Admin

Open `https://<your-worker>/admin` and sign in with `ADMIN_PASSWORD`. With no monitors yet, a first-run wizard adds the first website, server port or cron job and runs a test check on the spot. Everything else lives in the admin: monitors and heartbeats (create, edit, pause, test check, rotate the beat URL), groups, what the status page shows and in which order, the Cloudflare plan and check budget, appearance (system, light, dark), API tokens and backups.

- **Password.** At least 12 characters and not `change-me`. To change or reset it, set a new `ADMIN_PASSWORD` secret (`bunx wrangler secret put ADMIN_PASSWORD`, or the Cloudflare dashboard) and sign in again. Sessions last 12 hours.
- **Protect it.** The admin is a single password behind a rate-limited login. For anything public, put [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) in front of `/admin*` and `/api/admin/*`.
- **Check budget.** A save that would raise the busiest minute above the budget (free plan: 40 checks per minute) is refused with `409 budget_exceeded`. Edits that don't raise it always save.
- **Usage numbers.** The overview shows checks per minute, D1 writes and Worker requests today. Without extra secrets, D1 writes are an estimate of Edgebeat's own writes and requests are not tracked. For real, account-wide numbers add two optional secrets: `CF_ACCOUNT_ID` and `CF_API_TOKEN` (a token with **Account Analytics: Read**). If the query fails, the overview says so and falls back to the estimate.

### API tokens

Create tokens in Settings → API tokens. A token is shown once; Edgebeat stores only its hash. Send it as a header:

```sh
curl -H "Authorization: Bearer eb_..." https://<host>/api/admin/monitors
```

A `read` token may only `GET`; an `admin` token may change anything except tokens themselves (token management needs a signed-in browser session). Bearer requests skip the Origin check.

### Import and export

Settings → Backup exports monitors, groups and settings as JSON. The file has no ids, beat URLs, tokens or history, so it is safe to keep in git. Importing merges by slug: it creates and updates, and deletes nothing unless you tick "Delete monitors and groups that are not in the file". The admin always shows a dry-run summary first. Over the API:

```sh
curl -H "Authorization: Bearer eb_..." https://<host>/api/admin/export > edgebeat.json
curl -H "Authorization: Bearer eb_..." -H 'content-type: application/json' \
  --data @edgebeat.json "https://<host>/api/admin/import?dryRun=true"   # summary, no writes
# add ?prune=true to delete what the file doesn't list; one import is all-or-nothing
```

### Admin API

Everything under `/api/admin` takes either a Bearer token or the `eb_session` cookie from `POST /api/admin/login` (`{"password": "..."}`). Cookie requests that change data must send an `Origin` header equal to the Worker origin.

| Route | Methods |
|---|---|
| `/api/admin/session`, `/overview`, `/events` | `GET` |
| `/api/admin/monitors`, `/monitors/:id` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/api/admin/monitors/:id/check` (test check, writes nothing), `/monitors/:id/rotate-token` | `POST` |
| `/api/admin/groups`, `/groups/:id` | `GET`, `POST`, `PATCH`, `DELETE` |
| `/api/admin/settings` (`siteName`, `plan`: `free` or `paid`, `checkBudget`) | `GET`, `PATCH` |
| `/api/admin/tokens`, `/tokens/:id` (session only) | `GET`, `POST`, `DELETE` |
| `/api/admin/export`, `/api/admin/import` | `GET`, `POST` |

`intervalMin` is one of 1, 2, 3, 5, 10, 15, 30, 60. HTTP monitors follow redirects only when `followRedirects` is `true`, which is the default only when a `keyword` is set; at most 5 hops, each counting as a subrequest.

## Heartbeats

Each heartbeat monitor has a secret URL. Call it from your job when it finishes:

```sh
curl -fsS https://<host>/beat/<token>          # success
curl -fsS https://<host>/beat/<token>/fail     # report failure
```

The monitor goes down when no beat arrives within `heartbeatPeriodS + heartbeatGraceS`. A new heartbeat monitor stays Pending until its first beat. On a heartbeat, `intervalMin` sets how often lateness is checked, not how often your job must beat. Unpausing a heartbeat clears its last beat, so it is Pending again until the next one.

## License

MIT
