# Edgebeat — Design

Date: 2026-11-09
Status: approved by owner 2026-11-09

Edgebeat is an open-source uptime monitor, heartbeat (push) monitor and public
status page that runs entirely on the user's own Cloudflare account, on the
free plan, deployed with one click.

Marked **[owner]** = decided by the owner. Marked **[call]** = Claude's call,
owner may override. Unmarked = derived from research or constraints.

---

## 1. Intent and why

- **Origin [owner context].** Kirimi's status page (`status.kirimi.id`, Better
  Stack) showed "all green, 100%" for weeks while every monitor behind it was
  `not_monitored`. A status page that cannot go red is worse than none.
  Kirimi will be the first production user (dogfood), replacing Better Stack.
- **Own brand, open source, global audience [owner].** Name **Edgebeat**
  ("heartbeat from the edge"). Not a Kirimi-branded tool; Kirimi is just a user.
- **Why another one.** Prior art on Cloudflare (UptimeFlare ~3.9k★, active;
  cf-workers-status-page ~2.8k★, stale since 2024) leaves clear gaps:
  1. No heartbeat/push monitors (UptimeFlare issue #95).
  2. Hitting free-plan CPU / subrequest limits with no batching (#219).
  3. Deploys via Terraform or GitHub Actions; frequent deploy failures (#211, #195).
  4. Config is a file in the repo: change = edit + redeploy.
  5. Security issues (unauthenticated proxy / SSRF #205, CVE-2026-29779).

### Success looks like
- A stranger goes from "Deploy to Cloudflare" click to a working status page
  with their first monitor in under 5 minutes, no CLI required.
- Runs within the Cloudflare **free plan** for up to ~40 monitors at 1-minute
  intervals without ever silently stopping.
- When something is down, the status page is red and an alert fires. A status
  page that cannot go red must be impossible by design (see §6.4 "self-watch").
- `status.kirimi.id` runs on Edgebeat.

### Goals (v1)
- HTTP(S), keyword and TCP checks from Cloudflare's edge.
- Heartbeat monitors (push URL; alert when a beat is late).
- Public status page: groups, current state, 90-day uptime bars, response
  time chart, incidents, scheduled maintenance.
- Alerts: Telegram, Discord, Slack, generic signed webhook, email to the
  owner's verified address.
- Admin UI to manage everything, config stored in D1.
- One-click deploy; free-plan aware scheduling and storage budget.
- SVG badges and a public JSON status API.

### Non-goals (v1)
- True multi-region checks (planned v2 via Durable Object `locationHint`;
  placement is best-effort, so we will never claim exact cities).
- Email/SMS subscriptions for visitors.
- Multi-user / teams / RBAC. One admin.
- On-call schedules, escalation policies.
- DNS, SSL-expiry, database-protocol checks (SSL expiry may come in v1.x).
- Running anywhere other than Cloudflare.

### Anti-goals (failure even if it "works")
- A page that stays green when checks have stopped running.
- Requiring a paid plan, Terraform, GitHub Actions or a separate server to
  get started.
- Exceeding a free-plan daily quota and going dark until 00:00 UTC.
- Alert storms from single blips (false positives destroy trust fast).
- Shipping an endpoint that lets anonymous users make the Worker fetch
  arbitrary URLs.

---

## 2. Constraints (Cloudflare, verified 2026-11-09)

| Limit | Free | Paid ($5) | Impact |
|---|---|---|---|
| Cron triggers | 5 / account | 250 | Edgebeat uses exactly **1** (`* * * * *`). |
| Cron CPU / invocation | 10 ms | 30 s | fetch/I/O wait does not count; JSON + DB work does. |
| Cron wall clock | 15 min | 15 min | Fine. |
| Subrequests / invocation | 50 | 10,000 | Hard cap on checks + alerts per tick. |
| Simultaneous connections | 6 | 6 | Checks run with concurrency 6. |
| Requests / day | 100k | — | Status page + heartbeats + cron. |
| D1 rows written / day | 100k | 50M/mo | **Main design constraint** (~69 writes/min). |
| D1 rows read / day | 5M | 25B/mo | Status page must read precomputed data. |
| D1 queries / invocation | 50 | 1,000 | Batch writes. |
| D1 DB size | 500 MB | 10 GB | Retention needed. |
| TCP `connect()` | yes; port 25 blocked, private IPs and CF ranges blocked | same | |
| Email (`send_email`) | only to verified destination addresses | arbitrary recipients | Owner-only email alerts on free. |
| Static assets | free, unlimited requests | | Admin SPA + status page assets. |
| Deploy button | provisions D1/KV/DO, runs `deploy` script | | No monorepo; one self-contained package. |

Sources: developers.cloudflare.com limits/pricing pages for Workers, D1,
Durable Objects, Email Service, Deploy Buttons, Static Assets.

---

## 3. Architecture

One Worker, one D1 database, static assets. Nothing else required.

```
                ┌──────────────── Edgebeat Worker ────────────────┐
cron * * * * *  │ scheduled(): scheduler → checker → evaluator →   │
───────────────▶│              alerter → writer                    │
                │                                                  │
HTTP            │ fetch(): Hono router                              │
 /              │   status page (SSR, Hono JSX)                    │
 /admin/*       │   admin SPA (static assets) + /api/admin/* (JWT) │
 /api/v1/*      │   public JSON API, badges, RSS                   │
 /beat/:token   │   heartbeat ingest                               │
                └───────────────┬──────────────────────────────────┘
                                │
                             D1 (Drizzle)
```

### Stack [call]
- TypeScript, Bun for package management and scripts.
- **Hono** on Workers for routing.
- **Drizzle ORM** + D1, migrations via `drizzle-kit`, applied by
  `wrangler d1 migrations apply DB` inside the `deploy` script (Deploy button
  runs it).
- **Status page**: a static HTML/CSS/JS shell served from Workers Static
  Assets (free, unlimited, no Worker invocation) that renders from
  `GET /api/v1/status` (see §6.5 for why). Small vanilla TS bundle, no
  framework; Tailwind for styles. [call]
- **Admin**: React + Vite SPA, Tailwind + shadcn/ui, TanStack Query, served
  from Workers Static Assets under `/admin`.
- Tests: pure logic (scheduler, evaluator, budget, rollups) with `bun test`;
  Worker/D1 integration with `@cloudflare/vitest-pool-workers`.
- Single package repo (Deploy button does not support monorepos).

---

## 4. Monitors

### 4.1 Types (v1)
- **HTTP(S)**: method, URL, headers, optional body, expected status
  (default 2xx/3xx), timeout (default 10 s, max 30 s), follow redirects,
  optional **keyword** must/must-not appear in body (first 64 KB only).
- **TCP**: host + port via `cloudflare:sockets` `connect()`; success = socket
  opens within timeout.
- **Heartbeat**: Edgebeat gives a secret URL `/beat/:token`. The monitored job
  calls it (GET or POST). Down when no beat within `period + grace`.
  Optional `/beat/:token/fail` to report an explicit failure.

### 4.2 Per-monitor settings
`interval` (1, 2, 3, 5, 10, 15, 30, 60 min), `confirmations` (consecutive
failures before DOWN, default 2), `degraded_threshold_ms` (response time above
= DEGRADED, optional), group, public name, public/private visibility,
paused flag, alert channels.

### 4.3 States
`UP`, `DEGRADED`, `DOWN`, `MAINTENANCE`, `PAUSED`, `PENDING` (never checked).

---

## 5. The tick (scheduled handler)

Every minute:

1. **Self-watch stamp.** Write `last_tick_at` into the snapshot (part of the
   batched write below).
2. **Scheduler** selects due monitors (`next_due_at <= now`), ordered by
   lateness. Takes at most `CHECK_BUDGET` per tick:
   - free plan: `50 subrequests − reserved (alerts 6, retries 4) = 40`.
   - paid plan: configurable, default 500.
   Plan is a setting in admin (`free` default). If due monitors exceed the
   budget, the rest roll to the next tick (they are not dropped) and the admin
   UI shows a "budget pressure" warning with the suggested fix (raise
   intervals or switch to paid).
3. **Checker** runs selected checks with concurrency 6. Records status,
   latency, HTTP code, error class.
4. **Fail-fast retry.** A check that fails is retried once immediately in the
   same tick (uses reserved budget). Still failing → counts as one failure.
5. **Evaluator** (pure function): previous state + result + confirmations +
   maintenance windows → new state. State change → event.
6. **Alerter** sends notifications for state-change events only
   (DOWN, recovered UP, DEGRADED optional). Max 6 sends per tick; overflow is
   queued in D1 and sent next tick.
7. **Writer** does all writes in one D1 `batch()`.

CPU budget: the 10 ms free limit counts only JS work. Keep per-check work
tiny (no full body parsing; keyword match on a capped prefix). Heavy work
moves off the per-minute path: the snapshot's **current states** are
rewritten every tick, but the **90-day bars** part is rebuilt only every
15 min together with `daily_stats`. Channel secrets are decrypted only when
an alert is actually sent. [call]

The "~40 monitors at 1 minute on free" number is a target, not a promise:
`vitest-pool-workers` does not enforce real CPU time, so the builder
measures CPU on a real free account (Workers observability `cpuTime`) with a
synthetic 40-monitor setup. **If it does not fit, the advertised number
shrinks; the design does not get more complex to hit it.** [call] The
`CHECK_BUDGET` default follows the measurement.

---

## 6. Storage and the write budget

100k rows written/day free ≈ 69/min. Writing one row per check (40 monitors ×
1440) plus index updates would blow it. So:

### 6.1 Tables [call]
- `monitors` — config (rarely written).
- `monitor_state` — one row per monitor: state, consecutive failures,
  `next_due_at`, last latency. **Only written when it changes in a way that
  matters** (state change, failure counter change, `next_due_at`). To avoid
  one write per check, `next_due_at` is derived (`last_checked_at + interval`)
  and `last_checked_at` lives in the tick row, not here.
- `ticks` — **one row per minute** holding all results of that tick as a
  compact JSON array `[monitorId, status, latencyMs, code]`. 1,440 rows/day.
  Retention 7 days, pruned by the tick.
- `heartbeats` — one row per heartbeat monitor with `last_beat_at`. A beat
  writes only if the previous write is older than 30 s (coalescing), so a job
  beating every 5 s costs ≤ 2,880 writes/day; admin shows the cost.
- `daily_stats` — one row per monitor per day: checks, failures, downtime
  seconds, latency p50/p95. Updated from ticks every 15 min (not every tick).
  Retention 400 days.
- `events` — state changes (the source of incident timelines and uptime
  calculation). Small.
- `incidents`, `incident_updates`, `maintenances` — written by admin.
- `alert_channels`, `alert_queue`.
- `snapshot` — **single row** with the precomputed public status JSON
  (current states, 90-day bars). Rewritten once per tick. The status page
  reads only this row.
- `settings`, `admin_sessions`.

Projected writes (40 monitors, 5 heartbeats @ 1 min, free plan):
ticks 1,440 + snapshot 1,440 + tick-lock update 1,440 + daily_stats 40×96 =
3,840 + heartbeats 7,200 + hourly prune of old ticks ~1,440 + rollup/state
changes ~small ≈ **17–18k/day**, ~18% of the free quota. Admin shows a
live **budget meter** (writes, reads, subrequests) with projections.

### 6.2 Reads
Status JSON: 1 row (`snapshot`), served through the Cache API with
`s-maxage=30`. Admin pages may read more; they are low traffic.

### 6.3 Uptime math
Uptime % per day = `1 − downtime_seconds / observed_seconds`, where downtime
comes from `events` (DOWN intervals), not from sampling. Maintenance time is
excluded from both. Days with no observation show grey "no data" — never
green.

### 6.4 Self-watch (the Kirimi lesson)
- Status page renders a banner "Monitoring delayed — last check N min ago"
  when `now − last_tick_at > 3 min`, and stops showing green for
  monitors whose last check is older than `3 × interval` (shown as
  "unknown", grey).
- Optional: a **dead-man's switch** — Edgebeat pings an external heartbeat
  URL (e.g. a second Edgebeat on another account, or healthchecks.io) each
  tick, so the monitor itself is monitored. Setting in admin.
- Paused monitors are listed as "paused", never green.

### 6.5 Request quota (100k/day free) [call]
Every Worker invocation counts, and the Cache API does not avoid one. A
traffic spike on the status page must never silence monitoring.
- The status page HTML and assets are **static assets** (free, unlimited,
  no invocation). Only the JSON fetch invokes the Worker; the shell
  refreshes it every 60 s while visible, and the JSON is edge-cached 30 s.
- Heartbeat ingest: max 1 accepted beat per token per 30 s; extra beats get
  `429` without a D1 write.
- Per-IP rate limit on `/api/v1/*` and badges (Workers Rate Limiting
  binding, falls back to a cheap in-isolate counter).
- The budget meter (§6.1) also tracks **requests/day** from the Cloudflare
  GraphQL analytics if an optional API token is set; otherwise it counts
  invocations itself (approximate). At 80% it warns in admin and alerts.
- README documents the residual risk: on the free plan an extreme spike can
  still exhaust the quota; recommended mitigations are Workers Paid or a
  `public/` static snapshot fallback (v1.x).
- Whether cron keeps firing after the request quota is exhausted is
  unverified; the builder must test it on a real free account and document
  the result.

---

## 7. Alerts

Channels v1: Telegram (bot token + chat id), Discord webhook, Slack webhook,
generic webhook (JSON body, `X-Edgebeat-Signature` HMAC-SHA256).

Email is **optional and off by default** [call]: it needs Email Routing on a
domain and a verified destination, which a fresh one-click user won't have.
The default deploy config does not declare the `send_email` binding; docs
explain how to add it. Free plan: verified destinations only.

Rules: alert on DOWN (after confirmations), on recovery (with downtime
duration), optional on DEGRADED. Per-monitor channel selection. Global
"quiet during maintenance". Test-send button per channel.

Channel secrets are stored encrypted in D1 (AES-GCM, key from the
`ENCRYPTION_KEY` secret). [call]

---

## 8. Status page

- Route `/` (custom domain via Workers custom domains, e.g.
  `status.kirimi.id`).
- Header: logo, name, overall state ("All systems operational" / "Partial
  outage" / "Major outage" / "Maintenance").
- Active incidents and upcoming maintenance on top.
- Groups of monitors; each row: name, current state, 90-day bars (tooltip:
  date, uptime %, downtime minutes, incidents), uptime %. Optional response
  time chart per monitor.
- Incident history page `/history`, RSS/Atom `/feed.xml`.
- Theming: logo, primary color, dark/light/auto, custom footer links. [call]
- English UI; strings in one file so translations can be added later. [call]
- Public API: `GET /api/v1/status` (summary JSON), `GET /badge/:slug.svg`
  (uptime or status badge). Only public monitors are exposed.

---

## 9. Admin

- `/admin` SPA. Pages: overview (budget meter, tick health), monitors,
  heartbeats, groups, incidents (create/update/resolve, timeline),
  maintenance, alert channels, status page settings, import/export (JSON).
- **Auth [call]**: single admin; password set as Worker secret
  `ADMIN_PASSWORD` (Deploy button prompts for it via `.dev.vars.example`).
  Login issues a signed JWT in an `HttpOnly; Secure; SameSite=Strict` cookie,
  12 h expiry, rate-limited login. Docs recommend putting `/admin` behind
  Cloudflare Access as an extra layer (optional).
- **Import/export** a JSON config so people who want config-as-code can keep
  it in git [call]:
  - Every entity (monitor, group, channel, maintenance) has a stable,
    user-editable `slug`; import matches on slug.
  - Import is **merge-only** by default (create/update, never delete);
    `?prune=true` deletes entities missing from the file.
  - Export **never includes secrets**; channels are exported without their
    secret fields and import keeps the existing secret when the field is
    absent. Heartbeat tokens and all history survive import.
  - Machine access uses **API tokens** created in admin (`api_tokens` table,
    hashed, scoped `read` or `admin`, revocable), sent as
    `Authorization: Bearer`.

---

## 10. Security

- No public endpoint makes the Worker fetch a user-supplied URL. Only the
  admin can create monitors.
- Workers already block private IPs and Cloudflare ranges for TCP; for HTTP,
  validate monitor URLs (scheme http/https only, reject localhost/private
  literals) as defence in depth.
- Heartbeat tokens: 128-bit random, revocable, rate-limited per token.
- CSRF: SameSite=Strict cookie + `Origin` check on admin mutations.
- Secrets never returned by the API after save (write-only fields).
- `SECURITY.md` with private disclosure address.

---

## 11. Deploy and operations

- **Deploy to Cloudflare** button in README: provisions D1, prompts for
  `ADMIN_PASSWORD` and `ENCRYPTION_KEY`, runs `deploy` script
  (`vite build && wrangler d1 migrations apply DB --remote && wrangler deploy`).
- Manual path documented: `bun install`, `bunx wrangler login`,
  `bun run deploy`.
- Upgrades: users pull upstream (the Deploy button creates a fork-like repo in
  their account wired to Workers Builds), migrations run on deploy.
- First-run wizard in admin when no monitors exist.

---

## 12. Repo and project

- Location: `~/Dev/edgebeat` [owner]. Single package.
- GitHub org: `edgebeat-dev` (`edgebeat` user name is taken) [owner].
- Docs site / domain: `edgebeat.sh` [owner]. `.com/.dev/.io/.app` are
  registered by someone else (all at IONOS, possible future name conflict).
- License: MIT [owner].
- README, CONTRIBUTING, SECURITY, screenshots, demo deployment (Kirimi's page
  can serve as the live demo if the owner agrees).

---

## 13. Kirimi rollout (dogfood, not part of the OSS repo)

1. Deploy Edgebeat to Kirimi's Cloudflare account.
2. Monitors: landing, dashboard, API health, webhook, each engine
   `go.kirimi.id/svN` health; heartbeats for `kirimi-v2-workers` and the
   107 backup / ClickHouse sync crons.
3. Alerts to the Kirimi Telegram.
4. Run in parallel with Better Stack for one week, compare, then move the
   `status.kirimi.id` DNS and cancel Better Stack.

Exact endpoint list is decided during rollout, not in this design.

---

## 14. Amendments from planning (2026-11-09)

- **Scheduling** uses deterministic slots instead of a stored `next_due_at`:
  a monitor is due when `epochMinute % interval == hash(id) % interval`.
  Overflow beyond the budget is carried in `snapshot.carry`. No per-check
  write. (§5, §6.1)
- **Tick lock**: a conditional update on `snapshot.lockUntil` prevents two
  overlapping ticks; a 50 s wall-clock deadline carries unstarted checks.
- **Rollup is incremental**: every 15 min only new `ticks` rows are folded
  into `daily_stats`; p50/p95 come from a fixed latency histogram stored on
  the row; the 90-day bars update only today's entry. (§5, §6.1)
- **Heartbeat coalescing** returns `200 { coalesced: true }` (not 429) so
  `curl -f` in user jobs never fails; still no D1 write. (§6.5)
- **Subrequest accounting** (final review, R17): the tick caps outbound
  subrequests per invocation (free 44 = 40 checks + 4 retries, paid 1,000),
  counting the initial fetch, retries, every redirect hop and each TCP
  connect. HTTP redirects are followed manually (max 5 hops, each hop
  re-checked by the SSRF guard). A check that cannot get a subrequest is not
  run and is carried, never evaluated. `followRedirects` defaults to off
  unless a keyword is set. A free-plan `checkBudget` override is clamped to
  40. (§2, §5)
- **Overall status order** (final review, R18): stale → unknown; any down →
  partial/major outage; any non-paused public monitor unknown → unknown; any
  degraded → degraded; any maintenance → maintenance; all pending (or none) →
  unknown; else operational. A grey row never sits under a green banner. The
  status page also ages the status it holds and shows it stale/unknown once
  the last tick is over 180 s old, even when refreshes fail. (§8)

## 15. Left to the builder

- Exact Drizzle schema, indexes, JSON shapes of `ticks` and `snapshot`.
- Chart library on the status page (must be tiny or hand-rolled SVG).
- shadcn components used in admin.
- Error classes taxonomy for checks.
- File layout inside the package.

## 16. v2 ideas (not now)
- Multi-region checks via Durable Objects with `locationHint`
  (`wnam, enam, sam, weur, eeur, apac, oc, afr, me`), quorum-based DOWN.
- Visitor subscriptions (email via paid plan, RSS already in v1).
- SSL certificate expiry, DNS checks.
- Multiple status pages per deployment.
- i18n.
