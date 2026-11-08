# Edgebeat Plan 1 — Core Engine, Status Page, Admin API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Edgebeat Worker that checks HTTP/TCP/heartbeat monitors every minute within free-plan limits, stores results in D1 within the write budget, serves a public status page that can never show stale data as green, and exposes an authenticated admin JSON API to manage monitors.

**Architecture:** One Cloudflare Worker (Hono) with a `scheduled` handler (tick) and a `fetch` handler (public API, heartbeat ingest, admin API). D1 via Drizzle. The status page is a static Vite-built shell served from Workers Static Assets that renders `GET /api/v1/status`. Pure decision logic (scheduler, evaluator, uptime, snapshot) lives in `src/core/` with no I/O.

**Tech Stack:** TypeScript (strict), Bun (package manager + `bun test` for pure logic), Hono, Drizzle ORM + D1, drizzle-kit, Zod + `@hono/zod-validator`, Vite + Tailwind v4 (status page), Vitest + `@cloudflare/vitest-pool-workers` (Worker/D1 integration), Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-11-09-edgebeat-design.md`

## Global Constraints

- Free-plan per-tick budget: `CHECK_BUDGET` free = **40**, retries per tick ≤ **4**, reserved alert sends **6** (Plan 2) → total ≤ 50 subrequests. Paid default `CHECK_BUDGET` = **500**.
- Check concurrency: **6**.
- Tick wall-clock deadline: **50 000 ms** from tick start; checks not started by then are carried to the next tick.
- Check timeout default **10 000 ms**, max **30 000 ms**.
- `confirmations` default **2**, min 1, max 10.
- Allowed `intervalMin`: **1, 2, 3, 5, 10, 15, 30, 60**.
- Heartbeat token: **128-bit** random, base64url. Beats coalesce: a beat within **30 s** of the stored `lastBeatAt` is accepted (200) without a D1 write.
- Keyword match reads at most the first **65 536 bytes** of the body.
- Retention: `ticks` **7 days**; `daily_stats` **400 days**.
- Staleness: tick stale when `now − lastTickAt > 180 000 ms`; a monitor is `unknown` publicly when `now − lastCheckedAt > 3 × intervalMin × 60 000 ms` or the tick is stale.
- Bars: **90** days; a day with `observedS = 0` has `uptime: null` (grey), never 100.
- Writes per tick: 1 `ticks` row + 1 `snapshot` update + `monitor_state` rows **only when changed** + `events` rows on state change.
- Package manager Bun (`bun install`, `bun run`, `bunx`). No classes; functional style; `const` over `let`.
- Commit messages: English, lowercase, concise, no `Co-Authored-By` lines.
- UI copy in English. License MIT.

## Review Focus

1. **Cron stops or every tick throws** → status JSON must report `overall: "unknown"`, `stale: true`, and every monitor `state: "unknown"`, never `up`. Test owned by Task 9.
2. **Brand-new monitor / day with no checks** → bar `uptime: null`, monitor `pending`/`unknown`, never 100%. Tests owned by Task 4 and Task 9.
3. **Many targets time out at once** → tick returns before the 50 s deadline, unstarted monitors are carried, a second overlapping tick does nothing. Tests owned by Task 6 and Task 7.
4. **Heartbeat abuse** → unknown token 404 with no write; a job beating every second costs at most one write per 30 s. Test owned by Task 8.
5. **Huge or never-ending response body with keyword checks** → reads ≤ 65 536 bytes then cancels the stream; no hang past timeout. Test owned by Task 5.

---

## File Structure

```
edgebeat/
  package.json  bunfig.toml  tsconfig.json  wrangler.jsonc  drizzle.config.ts
  vite.config.ts  vitest.config.ts  .dev.vars.example  .gitignore  LICENSE
  migrations/                       # drizzle-kit output, applied by wrangler
  src/
    index.ts                        # Worker entry: { fetch, scheduled }
    env.ts                          # Env type
    db/schema.ts                    # all Drizzle tables (Plan 1 set)
    db/client.ts                    # getDb(env)
    core/types.ts                   # shared domain types
    core/schedule.ts (+ .test.ts)   # slot scheduling + budget selection
    core/evaluate.ts (+ .test.ts)   # state machine
    core/stats.ts (+ .test.ts)      # latency histogram, daily rollup math, bars
    core/public-status.ts (+ .test.ts) # snapshot → public JSON, staleness
    checks/http.ts  checks/tcp.ts  checks/run.ts
    tick/tick.ts  tick/rollup.ts
    api/app.ts  api/public.ts  api/beat.ts
    api/admin/auth.ts  api/admin/monitors.ts  api/admin/groups.ts  api/admin/settings.ts
    lib/ids.ts  lib/url-guard.ts (+ .test.ts)  lib/keys.ts
    status-page/index.html  status-page/main.ts  status-page/style.css
  test/worker/*.spec.ts             # vitest-pool-workers integration tests
```

`bun test` runs only `src/**/*.test.ts` (`bunfig.toml`: `[test] root = "src"`). Vitest runs only `test/worker/**/*.spec.ts`.

---

### Task 1: Scaffold, schema, migrations, empty Worker

**Files:**
- Create: `package.json`, `bunfig.toml`, `tsconfig.json`, `wrangler.jsonc`, `drizzle.config.ts`, `vitest.config.ts`, `.dev.vars.example`, `.gitignore`, `LICENSE` (MIT, "Edgebeat contributors"), `src/env.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/index.ts`, `src/api/app.ts`, `migrations/0000_*.sql`
- Test: `test/worker/health.spec.ts`

**Interfaces:**
- Produces:
  - `type Env = { DB: D1Database; ASSETS: Fetcher; ADMIN_PASSWORD: string; ENCRYPTION_KEY: string }`
  - `getDb(env: Env): DrizzleD1Database<typeof schema>`
  - `app: Hono<{ Bindings: Env }>` exported from `src/api/app.ts`
  - Worker default export `{ fetch: app.fetch, scheduled(event, env, ctx) }` (scheduled calls `runTick` from Task 7; stub no-op until then)
  - Tables (Drizzle names → SQL names, all timestamps are integer epoch ms):
    - `groups` (`groups`): `id` text pk, `slug` text unique not null, `name` text not null, `sort` int default 0.
    - `monitors` (`monitors`): `id` text pk, `slug` unique, `name`, `type` (`'http'|'tcp'|'heartbeat'`), `groupId` nullable fk groups, `url`, `method` default `'GET'`, `headers` text JSON default `'{}'`, `body` nullable, `expectedStatus` default `'200-399'`, `timeoutMs` default 10000, `followRedirects` int default 1, `keyword` nullable, `keywordMode` (`'contains'|'not_contains'`) default `'contains'`, `host` nullable, `port` nullable, `intervalMin` default 1, `confirmations` default 2, `degradedThresholdMs` nullable, `heartbeatPeriodS` nullable, `heartbeatGraceS` nullable, `heartbeatToken` nullable unique, `isPublic` int default 1, `paused` int default 0, `sort` int default 0, `createdAt`, `updatedAt`.
    - `monitor_state`: `monitorId` pk fk monitors on delete cascade, `state` (`MonitorState`), `consecutiveFailures` int, `lastChangeAt`.
    - `ticks`: `minute` int pk (epoch minute), `at` int, `results` text JSON.
    - `events`: `id` int pk autoincrement, `monitorId`, `fromState`, `toState`, `at`, `reason` text; index `(monitorId, at)`.
    - `heartbeats`: `monitorId` pk fk cascade, `lastBeatAt` nullable, `lastFailAt` nullable.
    - `daily_stats`: pk `(monitorId, day)`, `day` text `YYYY-MM-DD` UTC, `checks` int, `failures` int, `downtimeS` int, `observedS` int, `hist` text JSON (number[]).
    - `snapshot`: `id` int pk (always 1), `lastTickAt` int, `lockUntil` int default 0, `current` text JSON, `bars` text JSON, `carry` text JSON default `'[]'`, `lastRollupMinute` int default 0.
    - `settings`: `key` text pk, `value` text JSON.

- [ ] **Step 1:** `bun init`, then `bun add hono drizzle-orm zod @hono/zod-validator` and `bun add -d wrangler drizzle-kit typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types vite tailwindcss @tailwindcss/vite`. Use whatever versions are current; record them in the commit.
- [ ] **Step 2:** `wrangler.jsonc`: `name: "edgebeat"`, `main: "src/index.ts"`, `compatibility_date: "2026-11-01"`, `triggers.crons: ["* * * * *"]`, `d1_databases: [{ binding: "DB", database_name: "edgebeat", database_id: "<set by deploy>", migrations_dir: "migrations" }]`, `assets: { directory: "./dist/status-page", binding: "ASSETS", run_worker_first: ["/api/*", "/beat/*"] }`, `observability: { enabled: true }`. `.dev.vars.example`: `ADMIN_PASSWORD=change-me` and `ENCRYPTION_KEY=` with a comment "32 random bytes, base64: openssl rand -base64 32".
- [ ] **Step 3:** Write `src/db/schema.ts` exactly per the Interfaces block; `drizzle.config.ts` with `dialect: "sqlite"`, `out: "migrations"`; run `bunx drizzle-kit generate`. Expected: one `migrations/0000_*.sql` creating all 9 tables.
- [ ] **Step 4:** Write failing test `test/worker/health.spec.ts`: `GET /api/v1/health` returns `200` with JSON `{ ok: true }`. `vitest.config.ts` uses `defineWorkersConfig` with `wrangler.configPath`, and a setup file that calls `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` (migrations read via `readD1Migrations("migrations")` in the config).
- [ ] **Step 5:** Run `bunx vitest run test/worker/health.spec.ts`. Expected: FAIL (404).
- [ ] **Step 6:** Implement `app` with the health route and the Worker entry.
- [ ] **Step 7:** Run `bunx vitest run` → PASS; run `bunx tsc --noEmit` → no errors.
- [ ] **Step 8:** Scripts in `package.json`: `"test": "bun test && vitest run"`, `"build": "vite build"`, `"deploy": "vite build && wrangler d1 migrations apply DB --remote && wrangler deploy"`, `"dev": "vite build && wrangler dev"`, `"db:generate": "drizzle-kit generate"`. Commit: `chore: scaffold worker, schema and migrations`.

---

### Task 2: Domain types and slot scheduler

**Files:**
- Create: `src/core/types.ts`, `src/core/schedule.ts`
- Test: `src/core/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type MonitorState = 'pending' | 'up' | 'degraded' | 'down' | 'maintenance' | 'paused'`
  - `type ErrorClass = 'timeout' | 'dns' | 'connect' | 'tls' | 'status' | 'keyword' | 'heartbeat_late' | 'heartbeat_fail' | 'other'`
  - `type CheckResult = { monitorId: string; ok: boolean; latencyMs: number | null; code: number | null; error: ErrorClass | null }`
  - `type SchedMonitor = { id: string; intervalMin: number; type: 'http' | 'tcp' | 'heartbeat' }`
  - `slotOf(monitorId: string, intervalMin: number): number` — stable offset in `[0, intervalMin)` from FNV-1a 32-bit hash of the id.
  - `isDue(m: SchedMonitor, epochMinute: number): boolean` — `epochMinute % intervalMin === slotOf(id, intervalMin)`.
  - `selectChecks(monitors: SchedMonitor[], carry: string[], epochMinute: number, budget: number): { run: string[]; carry: string[] }` — candidates = carried ids (still existing, first, in carry order) then due non-heartbeat monitors (sorted by id), deduplicated; `run` = first `budget`; `carry` = rest. Heartbeat monitors never enter `run` (they need no subrequest).
  - `checkBudget(plan: 'free' | 'paid', override?: number): number` — free 40, paid 500, override wins when set.

Scheduling replaces the spec's stored `next_due_at` (no per-check write needed); carried overflow lives in `snapshot.carry`. Spec §5 is updated accordingly.

- [ ] **Step 1:** Write failing tests:
  - `slotOf` is deterministic and within range for intervals `[1,2,3,5,10,15,30,60]` across 1 000 random ids; `slotOf(x, 1) === 0`.
  - With 100 monitors at `intervalMin: 5`, over 5 consecutive minutes each monitor is due exactly once.
  - `selectChecks` with 50 due monitors and budget 40 → `run.length === 40`, `carry.length === 10`; next minute with those 10 carried and 0 due → carried 10 run first.
  - Carried id of a deleted monitor is dropped.
  - Heartbeat monitors never appear in `run`.
  - `checkBudget('free') === 40`, `checkBudget('paid') === 500`, `checkBudget('free', 25) === 25`.
- [ ] **Step 2:** `bun test src/core/schedule.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement `types.ts` and `schedule.ts`.
- [ ] **Step 4:** `bun test src/core/schedule.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat(core): slot scheduler with free-plan budget`.

---

### Task 3: State evaluator

**Files:**
- Create: `src/core/evaluate.ts`
- Test: `src/core/evaluate.test.ts`

**Interfaces:**
- Consumes: `MonitorState`, `CheckResult` (Task 2).
- Produces:
  - `type PrevState = { state: MonitorState; consecutiveFailures: number }`
  - `type EvalOpts = { confirmations: number; degradedThresholdMs: number | null; inMaintenance: boolean; paused: boolean }`
  - `evaluate(prev: PrevState, r: CheckResult, o: EvalOpts): { next: PrevState; changed: boolean; transition: { from: MonitorState; to: MonitorState } | null }`
  - `changed` is true when `state` or `consecutiveFailures` differ (decides the `monitor_state` write); `transition` only when `state` differs (decides the `events` row).

Rules: paused → `paused`, failures 0. Maintenance → `maintenance`, failures 0. OK → failures 0, state `degraded` if `degradedThresholdMs !== null && latencyMs > degradedThresholdMs` else `up`. Fail → failures + 1; state `down` when failures ≥ confirmations, otherwise unchanged (so `pending` stays `pending`, `up` stays `up`).

- [ ] **Step 1:** Failing tests, one per rule, plus:
  - `up` + one failure with confirmations 2 → `{ state: 'up', consecutiveFailures: 1 }`, `changed: true`, `transition: null`.
  - second failure → `down`, `transition: { from: 'up', to: 'down' }`.
  - `down` + OK → `up`, failures 0, transition `down→up`.
  - `up` + OK with failures already 0 → `changed: false`.
  - latency 900 with threshold 800 → `degraded`.
- [ ] **Step 2:** `bun test src/core/evaluate.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS. Commit `feat(core): monitor state evaluator`.

---

### Task 4: Stats, histogram, bars

**Files:**
- Create: `src/core/stats.ts`
- Test: `src/core/stats.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `MonitorState`.
- Produces:
  - `LATENCY_BUCKETS_MS = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000, 30000]` (last bucket = overflow, `hist.length === 14`).
  - `type DayStats = { checks: number; failures: number; downtimeS: number; observedS: number; hist: number[] }`
  - `emptyDay(): DayStats`
  - `addTickResults(day: DayStats, results: CheckResult[], intervalMin: number): DayStats` — per result: `checks+1`, `failures+1` if `!ok`, `observedS += intervalMin*60`, latency into histogram when `ok && latencyMs !== null`.
  - `percentile(hist: number[], p: number): number | null` — upper bound of the bucket containing the p-th sample; `null` when empty.
  - `downtimeSeconds(events: { toState: MonitorState; at: number }[], stateAtStart: MonitorState, from: number, to: number, maintenance?: [number, number][]): number` — sum of time in `down` within `[from, to)`, minus overlap with maintenance windows.
  - `type Bar = { day: string; uptime: number | null; downtimeS: number }`
  - `uptimeOf(d: DayStats): number | null` — `null` if `observedS === 0`, else `max(0, 1 − downtimeS / observedS)` rounded to 4 decimals.
  - `rollBars(bars: Bar[], today: string, todayStats: DayStats, days = 90): Bar[]` — replaces today's bar or appends it, drops bars older than `days`, fills missing days between last bar and today with `{ uptime: null, downtimeS: 0 }`.
  - `utcDay(ms: number): string` → `YYYY-MM-DD`.

- [ ] **Step 1:** Failing tests:
  - `uptimeOf(emptyDay()) === null` (Review Focus 2).
  - 1 440 OK one-minute checks, downtimeS 0 → `1`; downtimeS 864 over 86 400 observed → `0.99`.
  - `percentile` of 100 samples at 120 ms → `200`; empty → `null`.
  - `downtimeSeconds` with `up@0, down@10_000, up@70_000`, range `[0, 100_000)` → `60`; with maintenance `[20_000, 40_000]` → `40`; with `stateAtStart: 'down'` and no events over `[0, 30_000)` → `30`.
  - `rollBars([], '2026-11-09', …)` → length 1; gap of 3 days → 3 grey bars inserted; 95 bars in → 90 out, oldest dropped.
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(core): daily stats, latency histogram and uptime bars`.

---

### Task 5: Checks (HTTP, TCP) with URL guard

**Files:**
- Create: `src/lib/url-guard.ts`, `src/checks/http.ts`, `src/checks/tcp.ts`
- Test: `src/lib/url-guard.test.ts`, `test/worker/checks.spec.ts`

**Interfaces:**
- Consumes: `CheckResult`, `ErrorClass`.
- Produces:
  - `assertMonitorUrl(url: string): void` — throws `Error('invalid_url')` unless scheme is `http:`/`https:` and host is not `localhost`, `*.localhost`, `0.0.0.0`, IPv4 in 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, or IPv6 `::1`, `fc00::/7`, `fe80::/10`.
  - `type HttpMonitor = { id: string; url: string; method: string; headers: Record<string,string>; body: string | null; expectedStatus: string; timeoutMs: number; followRedirects: boolean; keyword: string | null; keywordMode: 'contains' | 'not_contains' }`
  - `matchesStatus(code: number, spec: string): boolean` — spec is comma-separated codes or ranges (`"200-399"`, `"200,204,301-302"`).
  - `runHttpCheck(m: HttpMonitor, timeoutMs: number): Promise<CheckResult>` — never throws. Sets `User-Agent: Edgebeat/1 (+https://edgebeat.sh)`. Keyword: read the body stream up to 65 536 bytes, decode UTF-8, then `reader.cancel()`. Errors map to `ErrorClass` (`AbortError`/timeout → `timeout`; status mismatch → `status`; keyword → `keyword`; other fetch errors → `connect` or `other`).
  - `type TcpMonitor = { id: string; host: string; port: number }`
  - `runTcpCheck(m: TcpMonitor, timeoutMs: number): Promise<CheckResult>` — `connect({ hostname, port })` from `cloudflare:sockets`, await `socket.opened` raced with timeout, then `socket.close()`.

- [ ] **Step 1:** Failing unit tests for `assertMonitorUrl` (accepts `https://kirimi.id/health`; rejects `ftp://x`, `http://localhost`, `http://10.1.2.3`, `http://[::1]/`, `http://169.254.169.254/`) and `matchesStatus` (`(204, "200-299")` true, `(404, "200-399")` false, `(302, "200,301-302")` true).
- [ ] **Step 2:** Failing integration tests in `test/worker/checks.spec.ts` using `fetchMock` from `cloudflare:test` (`fetchMock.activate(); fetchMock.disableNetConnect()`):
  - 200 + body containing keyword with `contains` → `ok: true`, `code: 200`.
  - 500 → `ok: false`, `error: 'status'`, `code: 500`.
  - Keyword missing → `error: 'keyword'`.
  - Body of 5 MB streamed without the keyword in the first 64 KB but present after → `error: 'keyword'` (proves the cap), and the call resolves in < 1 s (Review Focus 5).
  - Response delayed beyond `timeoutMs: 200` → `error: 'timeout'`.
- [ ] **Step 3:** Run both → FAIL. **Step 4:** implement. **Step 5:** → PASS. (TCP is covered by the real-account verification in Task 11; `cloudflare:sockets` cannot target a local listener in the test pool.)
- [ ] **Step 6:** Commit `feat(checks): http and tcp checks with url guard`.

---

### Task 6: Check runner with concurrency, retry and deadline

**Files:**
- Create: `src/checks/run.ts`
- Test: `test/worker/run.spec.ts`

**Interfaces:**
- Consumes: `runHttpCheck`, `runTcpCheck`, `CheckResult`.
- Produces:
  - `type RunnableMonitor = ({ type: 'http' } & HttpMonitor) | ({ type: 'tcp' } & TcpMonitor)`
  - `runChecks(ms: RunnableMonitor[], o: { concurrency: number; retryBudget: number; deadlineAt: number; now: () => number }): Promise<{ results: CheckResult[]; notStarted: string[] }>`
  - A worker pool of `concurrency` pulls monitors in order; before starting one it stops if `now() >= deadlineAt` (the rest go to `notStarted`). Per-check timeout = `min(m.timeoutMs, deadlineAt − now())`. A failed check is retried once immediately while `retryBudget` remains and time remains; the retry's result replaces the first.

- [ ] **Step 1:** Failing tests with `fetchMock`:
  - 12 monitors, concurrency 6, each response delayed 100 ms → all 12 results, at most 6 in flight (track with a counter in the mock).
  - 3 failing monitors, `retryBudget: 2` → exactly 2 retries made (count mock hits).
  - Flaky target (500 then 200) with retry budget → `ok: true`.
  - 20 monitors each hanging, `deadlineAt = now + 300`, `timeoutMs: 10000` → resolves in < 1 s, `notStarted.length > 0`, and every started result is `timeout` (Review Focus 3).
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(checks): bounded runner with retry and deadline`.

---

### Task 7: Tick orchestration and rollup

**Files:**
- Create: `src/tick/tick.ts`, `src/tick/rollup.ts`
- Modify: `src/index.ts` (scheduled → `ctx.waitUntil(runTick(env, Date.now()))`)
- Test: `test/worker/tick.spec.ts`

**Interfaces:**
- Consumes: Tasks 2–6, schema.
- Produces:
  - `runTick(env: Env, now: number, deps?: { runChecks?: typeof runChecks }): Promise<{ ran: boolean; checked: number; carried: number; transitions: Transition[] }>`
  - `type Transition = { monitorId: string; from: MonitorState; to: MonitorState; at: number; error: ErrorClass | null }` — Plan 2's alerter consumes this list.
  - `runRollup(env: Env, now: number): Promise<void>`
  - Snapshot `current` JSON shape: `Record<monitorId, { state: MonitorState; lastCheckedAt: number | null; latencyMs: number | null }>`; `bars` JSON: `Record<monitorId, Bar[]>`.

`runTick` steps:
1. **Lock:** `UPDATE snapshot SET lockUntil = now + 55_000 WHERE id = 1 AND lockUntil < now` (insert row id 1 if missing). 0 rows changed → return `{ ran: false }`.
2. Read in parallel: non-paused monitors, all `monitor_state`, `snapshot`, `settings` (`plan`, `checkBudget`), `heartbeats`.
3. `selectChecks(…, epochMinute = floor(now / 60_000), checkBudget(plan, override))`.
4. `runChecks(run, { concurrency: 6, retryBudget: 4, deadlineAt: now + 50_000 })`; `notStarted` is appended to the new carry.
5. Heartbeat monitors due this minute: `ok = lastBeatAt !== null && now − lastBeatAt ≤ (periodS + graceS) * 1000`; `lastFailAt > lastBeatAt` → `ok: false, error: 'heartbeat_fail'`; late → `'heartbeat_late'`. Never-beaten heartbeat stays `pending` (do not evaluate until first beat).
6. `evaluate` each result (`inMaintenance: false` until Plan 4).
7. One `db.batch([...])`: insert `ticks` row `{ minute, at: now, results: JSON [[id, ok?1:0, latencyMs, code]] }`; upsert changed `monitor_state`; insert `events` for transitions; update `snapshot` (`current` merged, `carry`, `lastTickAt: now`, `lockUntil: 0`); when `epochMinute % 60 === 0`, delete `ticks` older than 7 days and `daily_stats` older than 400 days.
8. When `epochMinute % 15 === 0`, `await runRollup(env, now)`.

`runRollup`: read ticks with `minute > lastRollupMinute`; group results by monitor and UTC day; for each touched `(monitor, day)` load `daily_stats` (or `emptyDay()`), `addTickResults`, recompute `downtimeS` with `downtimeSeconds` from that day's events (state at day start = last event before day start, else `pending`); upsert; update the monitor's bars with `rollBars`; write `snapshot.bars` and `lastRollupMinute` in the same batch.

- [ ] **Step 1:** Failing tests (D1 from the pool, `runChecks` injected as a fake returning scripted results):
  - Two concurrent `runTick` calls at the same `now` → exactly one returns `ran: true` (Review Focus 3).
  - Monitor failing twice with confirmations 2 → second tick returns transition `up→down` (after an initial OK tick), one `events` row, `monitor_state.state === 'down'`.
  - Steady OK monitor over 3 ticks → `monitor_state` written once (first tick from absent row), not three times (assert via `lastChangeAt` unchanged and a write counter on the batch wrapper).
  - 45 due monitors on free plan → `checked: 40`, `carried: 5`; next tick checks the 5 first.
  - Heartbeat with `periodS 60, graceS 30`, last beat 100 s ago → `heartbeat_late` failure.
  - `runRollup` after 15 ticks of one OK 1-minute monitor → `daily_stats` `checks 15, observedS 900, downtimeS 0`; `snapshot.bars[id]` has today's bar with `uptime 1`.
  - Monitor created today with zero ticks → no bar row for today (`uptime null` once rendered) (Review Focus 2).
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(tick): per-minute tick with lock, batching and rollup`.

---

### Task 8: Heartbeat ingest

**Files:**
- Create: `src/api/beat.ts`, `src/lib/ids.ts`
- Modify: `src/api/app.ts` (mount)
- Test: `test/worker/beat.spec.ts`

**Interfaces:**
- Produces:
  - `newId(): string` (ULID-like, sortable, 26 chars) and `newToken(): string` (16 random bytes, base64url, 22 chars) in `src/lib/ids.ts`.
  - `GET|POST /beat/:token` → 200 `{ ok: true, coalesced: boolean }`; unknown token → 404 `{ ok: false }` with no write; paused monitor → 200 `{ ok: true, paused: true }` with no write.
  - `GET|POST /beat/:token/fail` → sets `lastFailAt = now` (always written, not coalesced) → 200.
  - Coalescing: write `lastBeatAt = now` only when stored `lastBeatAt` is null or older than 30 000 ms.

- [ ] **Step 1:** Failing tests: unknown token 404 and `heartbeats` table unchanged; first beat writes; second beat 5 s later returns `coalesced: true` with `lastBeatAt` unchanged; beat 31 s later writes; `/fail` sets `lastFailAt` (Review Focus 4).
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(api): heartbeat ingest with coalescing`.

---

### Task 9: Public status API

**Files:**
- Create: `src/core/public-status.ts`, `src/api/public.ts`
- Test: `src/core/public-status.test.ts`, `test/worker/public.spec.ts`

**Interfaces:**
- Consumes: snapshot shapes (Task 7), `Bar`, `uptimeOf` semantics.
- Produces:
  - `type PublicState = 'up' | 'degraded' | 'down' | 'maintenance' | 'paused' | 'pending' | 'unknown'`
  - `type Overall = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown'`
  - `buildPublicStatus(input: { now: number; siteName: string; lastTickAt: number | null; groups: { slug: string; name: string; sort: number }[]; monitors: { id: string; slug: string; name: string; groupSlug: string | null; intervalMin: number; isPublic: boolean; paused: boolean; sort: number }[]; current: SnapshotCurrent; bars: Record<string, Bar[]> }): PublicStatus`
  - `PublicStatus = { siteName: string; generatedAt: number; lastTickAt: number | null; stale: boolean; overall: Overall; groups: { slug: string; name: string; monitors: { slug: string; name: string; state: PublicState; lastCheckedAt: number | null; uptime90: number | null; bars: Bar[] }[] }[] }`
  - Ungrouped monitors go to `{ slug: 'other', name: 'Other' }`, placed last. Private monitors are excluded. Paused monitors are listed with `state: 'paused'` (spec §6.4) and excluded from `overall`.
  - `uptime90` = observed-weighted average of non-null bars, `null` if none.
  - Overall: `stale` → `unknown`; any `down` → `major_outage` if all non-paused are down else `partial_outage`; any `degraded` → `degraded`; any `maintenance` → `maintenance`; else `operational` (all `pending` → `unknown`).
  - `GET /api/v1/status` → `PublicStatus` with `Cache-Control: public, max-age=15, s-maxage=30`; served through the Cache API keyed by URL.


- [ ] **Step 1:** Failing unit tests (Review Focus 1 and 2):
  - `lastTickAt = now − 181_000` → `stale: true`, `overall: 'unknown'`, every monitor `unknown` even if `current` says `up`.
  - `lastTickAt = null` → stale.
  - 5-minute monitor with `lastCheckedAt = now − 16 min` → `unknown`; with `now − 14 min` → its stored state.
  - Never-checked monitor → `pending`.
  - One down of three → `partial_outage`; all down → `major_outage`; paused excluded from overall.
  - Private monitor absent from output.
  - Bars `[{uptime: null}, {uptime: 1}]` → `uptime90` computed only from the non-null day.
- [ ] **Step 2:** Failing integration test: seed monitors + snapshot, `GET /api/v1/status` → 200, schema matches, cache header present.
- [ ] **Step 3:** → FAIL. **Step 4:** implement. **Step 5:** → PASS.
- [ ] **Step 6:** Commit `feat(api): public status json with staleness rules`.

---

### Task 10: Admin API (auth, monitors, groups, settings)

**Files:**
- Create: `src/lib/keys.ts`, `src/api/admin/auth.ts`, `src/api/admin/monitors.ts`, `src/api/admin/groups.ts`, `src/api/admin/settings.ts`
- Modify: `src/api/app.ts`
- Test: `test/worker/admin.spec.ts`

**Interfaces:**
- Produces:
  - `jwtKey(env: Env): Promise<CryptoKey>` — HKDF-SHA256 from `ENCRYPTION_KEY` (base64 decoded), info `"edgebeat-jwt"`; Plan 2 adds `channelKey` with info `"edgebeat-channels"` in the same file.
  - `POST /api/admin/login` `{ password }` → constant-time compare (`crypto.subtle.timingSafeEqual` over SHA-256 digests) → sets cookie `eb_session` (HS256 JWT `{ sub: 'admin', exp: now + 12h }`, `HttpOnly; Secure; SameSite=Strict; Path=/`) → 204. Wrong password → 401 after a fixed 500 ms delay; more than 10 failures per isolate per minute → 429.
  - `POST /api/admin/logout` → clears cookie → 204.
  - `requireAdmin` middleware on `/api/admin/*` (except login): valid cookie JWT, and for non-GET requests the `Origin` header must equal the request origin, else 403. Plan 3 extends it with Bearer API tokens.
  - Monitors: `GET /api/admin/monitors`, `POST /api/admin/monitors`, `GET|PATCH|DELETE /api/admin/monitors/:id`, `POST /api/admin/monitors/:id/rotate-token`. Zod schema `monitorInput` enforces Global Constraints (interval set, timeout ≤ 30 000, confirmations 1–10, slug `^[a-z0-9-]{1,64}$`), `type`-specific required fields (`url` for http, `host`+`port` for tcp, `heartbeatPeriodS ≥ 60` + `heartbeatGraceS ≥ 0` for heartbeat), and `assertMonitorUrl`. Creating a heartbeat sets `heartbeatToken = newToken()` and inserts the `heartbeats` row. Responses include `beatUrl` for heartbeats.
  - Groups: `GET|POST /api/admin/groups`, `PATCH|DELETE /api/admin/groups/:id` (delete sets members' `groupId` null).
  - Settings: `GET|PATCH /api/admin/settings` with keys `siteName` (string ≤ 80, default `"Status"`), `plan` (`'free'|'paid'`, default `'free'`), `checkBudget` (int 1–10 000 or null).

- [ ] **Step 1:** Failing tests:
  - Unauthenticated `GET /api/admin/monitors` → 401.
  - Wrong password → 401; right password → 204 + cookie; cookie then lists monitors.
  - `POST` with cookie but foreign `Origin` → 403.
  - Create http monitor with `http://10.0.0.1` → 400; with `intervalMin: 4` → 400; valid → 201 with id.
  - Create heartbeat → response has `beatUrl` ending in a 22-char token; `rotate-token` changes it and the old token then 404s on `/beat/`.
  - `DELETE` monitor cascades `monitor_state` and `heartbeats`.
  - `PATCH /api/admin/settings { plan: 'paid' }` → subsequent `checkBudget('paid')` used by tick (assert via settings read).
- [ ] **Step 2:** → FAIL. **Step 3:** implement. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(api): admin auth and monitor, group, settings endpoints`.

---

### Task 11: Status page shell, real-account verification

**Files:**
- Create: `vite.config.ts`, `src/status-page/index.html`, `src/status-page/main.ts`, `src/status-page/style.css`, `README.md` (minimal: what it is, manual deploy steps, curl examples for the admin API)
- Test: `test/worker/assets.spec.ts`

**Interfaces:**
- Consumes: `GET /api/v1/status` (`PublicStatus`).
- Produces: `dist/status-page/` (Vite `root: src/status-page`, `outDir: ../../dist/status-page`, Tailwind via `@tailwindcss/vite`).

Page behavior: fetch status on load and every 60 s while `document.visibilityState === 'visible'`. Render: site name; overall banner (`operational` "All systems operational", `degraded` "Degraded performance", `partial_outage` "Partial outage", `major_outage` "Major outage", `maintenance` "Under maintenance", `unknown` "Status unknown"); a stale banner "Monitoring delayed — last check N min ago" when `stale`; groups with monitor rows (name, state pill, `uptime90` as `99.98%` or `—`); 90 bars per monitor coloured by uptime (`null` grey, `1` green, `≥ 0.99` yellow-green, `≥ 0.95` amber, else red) with `title` tooltip `"<day>: <uptime%> · <downtime min> min down"`. Colours via CSS variables; `prefers-color-scheme` dark support. No framework.

- [ ] **Step 1:** Failing test: after `vite build`, `GET /` via `SELF.fetch` returns 200 HTML containing `<div id="app">` (assets served without invoking app routes).
- [ ] **Step 2:** → FAIL. **Step 3:** implement page + Vite config; `bun run build`. **Step 4:** → PASS.
- [ ] **Step 5:** Local smoke: `bun run dev`, log in with curl, create an http monitor for `https://example.com`, trigger the cron with `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` (requires `wrangler dev --test-scheduled`; add it to the `dev` script), open `/` and confirm the monitor shows `up`.
- [ ] **Step 6: Real free-account verification (owner runs or approves; needs their Cloudflare login).**
  - Deploy to a free account with 40 HTTP monitors pointing at a fast public endpoint plus 1 TCP monitor (`1.1.1.1:443`) and 5 heartbeats.
  - After 30 minutes, read Workers Observability for the scheduled handler: record p50/p95 `cpuTime` and any `exceededCpu` errors.
  - Verify TCP monitor is `up` (confirms `connect()` on free).
  - Stop the cron (remove trigger, redeploy) and confirm the page shows the stale banner within 4 minutes.
  - Record the measured numbers in `docs/benchmarks/2026-11-free-plan.md`. If p95 CPU ≥ 9 ms, set the free `checkBudget` default to the largest count that measured < 7 ms and update Global Constraints and README.
- [ ] **Step 7:** Commit `feat(status-page): static status page shell and free-plan benchmark`.

---

## Roadmap (separate plans, written after Plan 1 ships)

- **Plan 2 — Alerts:** `alert_channels` (encrypted secrets, AES-GCM via `channelKey`), `alert_queue`, Telegram/Discord/Slack/webhook (HMAC) senders, optional email binding, per-monitor channel selection, test-send, ≤ 6 sends per tick with overflow queue, consumes `Transition[]` from `runTick`. **Kirimi rollout can start after Plan 2.**
- **Plan 3 — Admin SPA:** React + Vite + shadcn under `/admin`, first-run wizard, budget meter (writes/reads/subrequests/requests), API tokens (`api_tokens`), import/export by slug (merge, `?prune=true`, secrets excluded).
- **Plan 4 — Public polish and OSS launch:** incidents + updates, maintenance windows (feeds `inMaintenance`), `/history`, `/feed.xml`, badges `/badge/:slug.svg`, theming, dead-man's switch URL, per-IP rate limit on public API, Deploy to Cloudflare button (`cloudflare.bindings` in `package.json`, verified end-to-end), README/CONTRIBUTING/SECURITY, GitHub org `edgebeat-dev`, docs on `edgebeat.sh`.
