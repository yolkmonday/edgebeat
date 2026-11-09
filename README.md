# Edgebeat

Open-source uptime monitor and public status page that runs as a single Cloudflare Worker (Hono, D1 via Drizzle, Workers Static Assets). A cron trigger runs checks every minute; the status page is a static page that reads `GET /api/v1/status`.

## Status

Plan 1 (core engine) only. Working: HTTP, TCP and heartbeat monitors, state transitions, 90-day daily stats, public status JSON, admin REST API, static status page. Not yet built: admin UI, alert channels, incidents, maintenance windows.

The number of monitors the free Workers plan can handle per tick is a target, not a measurement. It is pending a real benchmark on a free account.

On the free plan a Worker invocation may make 50 subrequests, and every redirect hop counts as one. Each tick therefore caps itself at 44 subrequests (40 checks + 4 retries; 6 stay reserved for alerts): initial fetches, retries, redirect hops and TCP connects all count. A check that cannot get a subrequest is not run this minute; it is carried to the next tick, never marked down. The paid plan caps at 1,000. A `checkBudget` override can lower the free-plan budget of 40 but not raise it.

## Install

Three paths, in order of effort. All of them need a Cloudflare account.

### 1. CLI

```sh
bunx edgebeat setup
```

The CLI asks for a Cloudflare API token and installs the Worker, its D1 database and secrets. Create the token with these permissions:

- `Account · Workers Scripts · Edit`
- `Account · D1 · Edit`
- `Account · Account Settings · Read`

The token is never written to disk. The generated admin password is printed once.

### 2. Deploy to Cloudflare button

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/edgebeat-dev/edgebeat)

Requires a GitHub account (Cloudflare copies the repository into it). Updates by pulling upstream and redeploying.

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
bun run deploy                            # builds the page, applies migrations (remote), deploys
```

## Local development

Create `.dev.vars` (git-ignored):

```
ADMIN_PASSWORD=choose-a-password
ENCRYPTION_KEY=<openssl rand -base64 32>
```

```sh
bunx wrangler d1 migrations apply DB --local
bun run dev                                   # http://localhost:8787, cron testable
curl "http://localhost:8787/cdn-cgi/handler/scheduled"   # run one tick
bun run test                                  # builds the page, then bun test + vitest
bun run typecheck
```

## Admin API

All admin routes live under `/api/admin`. Log in once and keep the session cookie (`eb_session`). Non-GET requests must send an `Origin` header equal to the worker origin.

```sh
HOST=https://edgebeat.example.workers.dev
curl -c jar -H "Origin: $HOST" -H 'content-type: application/json' \
  -d '{"password":"<ADMIN_PASSWORD>"}' $HOST/api/admin/login
```

Create monitors (`intervalMin` is one of 1, 2, 3, 5, 10, 15, 30, 60). HTTP monitors do not follow redirects unless `followRedirects` is `true`; it defaults to `true` only when a `keyword` is set. Followed redirects are capped at 5 hops, and each hop counts as a subrequest.

```sh
# http
curl -b jar -H "Origin: $HOST" -H 'content-type: application/json' $HOST/api/admin/monitors \
  -d '{"name":"Website","slug":"website","type":"http","url":"https://example.com","intervalMin":1,"expectedStatus":"200-399"}'

# tcp
curl -b jar -H "Origin: $HOST" -H 'content-type: application/json' $HOST/api/admin/monitors \
  -d '{"name":"DNS","slug":"dns","type":"tcp","host":"1.1.1.1","port":443}'

# heartbeat (response includes beatUrl)
curl -b jar -H "Origin: $HOST" -H 'content-type: application/json' $HOST/api/admin/monitors \
  -d '{"name":"Nightly backup","slug":"backup","type":"heartbeat","heartbeatPeriodS":86400,"heartbeatGraceS":900}'
```

List monitors and read or change settings (`siteName`, `plan`: `free` or `paid`, `checkBudget`):

```sh
curl -b jar $HOST/api/admin/monitors
curl -b jar $HOST/api/admin/settings
curl -b jar -X PATCH -H "Origin: $HOST" -H 'content-type: application/json' \
  -d '{"siteName":"Acme Status","plan":"free"}' $HOST/api/admin/settings
```

## Heartbeats

Each heartbeat monitor has a secret URL. Call it from your job when it finishes:

```sh
curl -fsS https://<host>/beat/<token>          # success
curl -fsS https://<host>/beat/<token>/fail     # report failure
```

The monitor goes down when no beat arrives within `heartbeatPeriodS + heartbeatGraceS`. A new heartbeat monitor stays Pending until its first beat. On a heartbeat, `intervalMin` sets how often lateness is checked, not how often your job must beat. Unpausing a heartbeat clears its last beat, so it is Pending again until the next one.

## License

MIT
