# Edgebeat Plan 3 — Admin SPA, First-Run Wizard, API Tokens, Import/Export

**Status:** done (2026-11-09). Tasks 0–7 merged on `feat/admin-plan-3`; browser-verified in Task 7 (light, dark, 390 px). Built-screen screenshots were kept outside the repo. Open: the public status page still uses its own slate tokens (decision 11, Plan 4).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in owner manages everything from `/admin` in the browser: first-run wizard to the first monitor, overview with tick health and free-plan usage, monitors and heartbeats (list, create, edit, detail, pause, rotate token, test check), groups, status-page visibility and order, settings (plan, check budget, appearance, API tokens, JSON import/export). No curl needed.

**Architecture:** A React + Vite SPA in `src/admin/`, built to `dist/status-page/admin/` (the existing Workers Static Assets directory) and served under `/admin`. `/admin` and `/admin/*` run the Worker first: real files pass through `ASSETS`, every other path gets the SPA `index.html` with security headers. The SPA talks only to `/api/admin/*` (cookie session, Origin check). Shared contract types and the monitor Zod schema live in `src/shared/` and are imported by both the Worker and the SPA. New backend endpoints fill the gaps the UI needs (status per monitor, overview, events, test check, budget guard, API tokens, import/export). Task 0 fixes every contract so Tasks 2–6 run in parallel on disjoint files.

**Tech Stack:** existing Worker stack (Hono, Drizzle + D1, Zod 4, Vitest pool) + React 19, Vite 8, Tailwind v4, `@vitejs/plugin-react`, react-router 7 (declarative mode), TanStack Query 5, Zustand 5, react-hook-form 7 + `@hookform/resolvers`, `radix-ui` (single package) + `class-variance-authority` + `clsx` + `tailwind-merge` (shadcn/ui style), lucide-react, sonner, date-fns, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`. No recharts (no chart in the admin design), no axios, no component-test DOM library.

**Spec:** `docs/superpowers/specs/2026-11-09-edgebeat-design.md` §9, §10, §11 (first-run wizard), §6.1 budget meter; `docs/superpowers/specs/2026-11-09-edgebeat-install-design.md` §3.6 (every install path lands in the admin first-run experience), §6 password rule.

**Design:** Pego project `2ln70n8d`, page "Admin" (`a80zcttt`), components and tokens on page "Design system" (`eanjw8se`). Exported screenshots: `docs/superpowers/plans/plan-3-design/*.png`. Illustration sources: `/Users/yolk/Pego/edgebeat/illustrations/` (`*.png`, dark-safe cut-outs in `transparent/`).

## Global Constraints

- Admin URL base `/admin`; SPA router `basename="/admin"`. API base `/api/admin`. Everything English, strings inline (no i18n layer in the admin).
- Auth stays as built in Plan 1: cookie `eb_session` (HS256 JWT, 12 h, `HttpOnly; Secure; SameSite=Strict; Path=/`), login rate limit 10 failures/isolate/minute, 500 ms fail delay, password rule ≥ 12 chars and not `change-me`. The SPA never stores the password or the JWT; it only learns "signed in" from `GET /api/admin/session`.
- CSRF: every non-GET admin request from the SPA is same-origin `fetch` with `credentials: "same-origin"`; the existing Origin check stays. Bearer-token requests skip the Origin check (not cookie-based), but a `read` token may only use `GET`/`HEAD`, and token management endpoints refuse any Bearer request (`403 session_required`).
- API tokens: `eb_` + 32 random bytes base64url (46 chars). Stored as hex SHA-256 only, plus a 10-char display prefix. Plaintext is returned exactly once (create response). Max 20 tokens. `lastUsedAt` written at most once per 10 minutes per token, in `waitUntil`.
- Secrets never leave the Worker: no endpoint returns `ADMIN_PASSWORD`, `ENCRYPTION_KEY`, `CF_API_TOKEN` or token hashes. Export never contains ids, `heartbeatToken` or `beatUrl`. (Channel secret encryption is Plan 2; Plan 3 stores no third-party secrets in D1.)
- Admin reads never write D1. `POST /api/admin/monitors/:id/check` writes nothing. The only new per-request write is the throttled `lastUsedAt`.
- Check budget guard: `peakChecksPerMinute` = max over the 60 minutes of an hour of due non-paused http/tcp monitors (exact, from `slotOf`; all intervals divide 60). A create/patch/import that would raise the peak above `effectiveBudget` (free: 40, paid: `checkBudget ?? 500`) and above the current peak is refused `409 budget_exceeded`. Edits that do not raise the peak are always allowed (an install already over budget can still be edited).
- Usage limits shown: free plan `d1WritesPerDay 100_000`, `requestsPerDay 100_000`; paid → `limit: null` (no bar). D1 writes come from Cloudflare GraphQL when the optional `CF_ACCOUNT_ID` + `CF_API_TOKEN` secrets are set (account-wide, which is what the quota counts), otherwise from `estimateWritesToday` (labelled "estimated"). Requests today only from GraphQL; otherwise `null` ("Not tracked"). GraphQL results cached 300 s via the Cache API.
- Import: one atomic `db.batch`; multi-row upserts chunked by `MAX_PARAMS` (100 bound params); ≤ 45 statements per request, else `413 too_large`. Merge-only unless `?prune=true`. `?dryRun=true` returns the same summary with zero writes.
- Polling: overview 15 s, monitor list 30 s, monitor detail 15 s (5 s while a heartbeat is `pending`), only while `document.visibilityState === "visible"` (TanStack `refetchIntervalInBackground: false`).
- Frontend file naming: `components/ui/*` kebab-case (shadcn style); feature/page components PascalCase (`MonitorsPage.tsx`); hooks `use-kebab-case.ts`; utils kebab-case. `@/` = `src/admin/` inside the SPA, `@shared/` = `src/shared/`. Files in `src/shared/` use only relative imports, `zod`, and type-only imports from `src/core/`.
- Bun for everything; no classes (errors are plain `Error` objects with fields via helper functions); `const` over `let`; arrow functions; early returns.
- Commits: English, lowercase, concise, no `Co-Authored-By` lines.

## Review Focus

1. **Cron stopped** → overview tick card switches to the stale variant (`z2e8zbii`), every non-paused monitor counts as `unknown`, nothing shows green. Tests: Task 2 `overview reports stale tick and unknown states`.
2. **Read token tries to mutate / Bearer tries to mint tokens / cross-site POST with cookie** → 403 each. Tests: Task 3 `read token cannot mutate`, `bearer cannot manage tokens`; existing `forbidden_origin` test still passes.
3. **Secrets in responses** → export has no `heartbeatToken`/ids; token list has no hash; plaintext token only in the create response. Tests: Task 3 `export contains no secrets`, `token plaintext shown once`.
4. **Budget** → 41st one-minute http monitor on free → `409 budget_exceeded`; renaming a monitor in an over-budget install still saves. Tests: Task 0 unit, Task 2 `budget guard`.
5. **Deep links** → `GET /admin/monitors/abc` returns the SPA HTML with CSP; `/admin/assets/missing.js` returns 404 (never HTML); `/` is still the status page. Tests: Task 2 `admin spa fallback`.
6. **Partial import** → one invalid monitor → 400 and zero rows changed; prune only with the flag. Tests: Task 3 `import is atomic`, `prune deletes only with flag`.
7. **Write budget** → admin GETs and the test check perform zero D1 writes. Tests: Task 2 `admin reads do not write` (compare `changes()` / row counts before and after).

---

## Design map (Pego `2ln70n8d`)

| Screen (node id) | File in `plan-3-design/` | Route | Task |
|---|---|---|---|
| 01 Login `jm1szg6w` | `01-login.png` | `/admin/login` | 4 |
| 01b Login / wrong password `uebbpfjy` | `01b-login-wrong-password.png` | `/admin/login` (401 state) | 4 |
| 02a Setup / welcome `8cwa753j` | `02a-setup-welcome.png` | `/admin/setup` step 1 | 4 |
| 02b Setup / pick type `dwf70g26` | `02b-setup-pick-type.png` | step 2 | 4 |
| 02c Setup / configure `hpiw3kad` | `02c-setup-configure.png` | step 3 (http shown; tcp/heartbeat variants derived) | 4 |
| 02d Setup / done `wt8aab69` | `02d-setup-done.png` | step 4 | 4 |
| 03 Overview `sv2afuvz` | `03-overview.png` | `/admin` | 6 |
| 03b Overview stale tick card `z2e8zbii` | `03b-overview-stale.png` | `/admin` (stale) | 6 |
| 04 Monitors `urxsgxkq` | `04-monitors.png` | `/admin/monitors`, `/admin/heartbeats` | 5 |
| 07 Monitors / empty `0soliclh` | `07-monitors-empty.png` | `/admin/monitors` (0 monitors) | 5 |
| 05 Add monitor `l8wtr2kp` | `05-add-monitor.png` | `/admin/monitors/new`, `/admin/monitors/:id/edit` | 5 |
| 06 Heartbeat detail `zjua5wcc` | `06-heartbeat-detail.png` | `/admin/monitors/:id` (heartbeat) | 5 |
| 08 Settings `0wb4os0c` | `08-settings.png` | `/admin/settings` | 6 |
| Design system / Components `gefc0vf8` | `ds-components.png` | — | 1 |
| Design system / Illustrations `qipatjyp` | `ds-illustrations.png` | — | 0, 1 |

Flow (Pego connectors): login → setup when no monitors, else overview; wrong password stays on login; welcome "Skip for now" → monitors empty; "Start setup" → pick type → configure → done; done "Add another" → pick type, "Go to dashboard" → overview; stale tick → overview stale variant.

**Not in the design (built from Design-system components, same layout grid):** HTTP/TCP monitor detail, Heartbeats list (= monitors table filtered to heartbeats), Groups, Status page, Events ("View all"), Settings sections Appearance / API tokens / Backup, edit mode of the monitor form, not-found, dark mode, mobile. Wizard welcome and heartbeat-detail image placeholders use `welcome.png` and `heartbeat.png`.

**Components used** (Design system ids): Logo/Mark `uxatfzi5` (SVG below), Logo/Lockup `yoprihbv`, Button/Primary `1e0iec0i`, Secondary `0gcnu4sz`, Ghost `cizcvkb2`, Destructive `wm7zw64o` (+ `sm` variants `r1p6syuf` `5p4idgpw` `4e690g7s` `0lwbtai3`), Field `b8psr2qc`, Select `5of9mrt6` + menu `8j296j8h`, Radio card `j5nv6drz`/`e5850dhx`, Switch `oqvent5l`/`ouzrxhlm`, Tabs `7al02k8c`, Table header `d0lkktea`, Table row `28cj2xxq`, Admin/Monitor row `amr-row`, Card `quqgtcnz`, Code block `t1884ri3`, Badge `73qhtiog`/`b30m8ep8`, Empty state `x3jft7gt`, Toast `czwss4gu`/`gjox43fk`, Nav item `nav-item-active`/`nav-item-default`, Pills `i55o54gs` `fjmeckwc` `7sjlumhe` `zdxvsna5` `uf8wkxcd` `xeps86in` `19bi7880` `gg0pxp4r` (+ `/Dark` twins), Uptime bar row `aberweu8`/`zvo16m2c`, Tooltip `vgl5npy3`, Card/Dark `card-dark`.

Logo mark (exact): 32×32, `rect rx=8 fill=var(--accent)`, path `M5 20 H10.5 L13.5 11 L17.5 25 L20.5 20 H26.5 V6`, stroke white 2.5, round caps/joins. Wordmark "edgebeat" in Geist semibold, `letter-spacing: -0.02em`.

### Tokens (from Pego variables; source of `src/shared/tokens.css`)

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FAFAFB` | `#0B0B0E` |
| `--surface` / `-2` / `-3` | `#FFFFFF` / `#F4F4F6` / `#EBEBEF` | `#131317` / `#1B1B21` / `#24242B` |
| `--border` / `--border-strong` | `#E4E4E9` / `#CDCDD6` | `#26262D` / `#3A3A44` |
| `--text` / `--text-muted` | `#131317` / `#5F5F6B` | `#EDEDF0` / `#A1A1AE` |
| `--accent` / `-hover` / `-text` / `-bg` / `-border` | `#5B45E8` / `#4A35D1` / `#4F38DB` / `#F1EFFF` / `#D9D3FF` | `#6550F5` / `#7462FF` / `#A99DFF` / `#1C1838` / `#383070` |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` |
| `--up` / `-text` / `-bg` / `-border` | `#16A34A` / `#15803D` / `#ECFDF3` / `#BBF0CF` | `#22C55E` / `#4ADE80` / `#0D2117` / `#1A4D30` |
| `--degraded` (…) | `#F59E0B` / `#B45309` / `#FFF8EB` / `#FCE3B0` | `#F59E0B` / `#FBBF24` / `#261C08` / `#5C420F` |
| `--partial` (…) | `#EA580C` / `#C2410C` / `#FFF4ED` / `#FDD5BC` | `#F97316` / `#FB923C` / `#2A1608` / `#63300F` |
| `--down` (…) | `#DC2626` / `#B91C1C` / `#FEF2F2` / `#FAD0D0` | `#EF4444` / `#F87171` / `#2A1010` / `#5F1D1D` |
| `--maint` (…) | `#2563EB` / `#1D4ED8` / `#EFF5FF` / `#C9DAFC` | `#3B82F6` / `#60A5FA` / `#0D1A33` / `#1E3A6E` |
| `--paused` / `--pending` | `#5F5F6B` / `#8A8A96` | `#8A8A96` / `#5F5F6B` |
| `--unknown` / `-bg` / `-border` | `#C2C2CC` / `#F4F4F6` / `#E4E4E9` | `#3A3A44` / `#1B1B21` / `#26262D` |
| `--lime` | `#84CC16` | `#A3E635` |
| `--focus-ring` | `#5B45E840` | `#5B45E840` |
| `--overlay` | `#13131766` | `#13131766` |
| `--tooltip-bg` / `-text` / `-muted` | `#24242B` / `#EDEDF0` / `#A1A1AE` | same |
| `--shadow` / `--shadow-2` | `#0000000F` / `#0000000A` | `#FFFFFF14` ring instead (`--dark-ring`) |

Fonts: `Geist Variable` (sans), `Geist Mono Variable` (URLs, slugs, numbers, timestamps, badges). Type scale px: 12 / 14 / 16 / 18 / 24 / 32 / 48. Spacing px: 4 8 12 16 24 32 48 64 96. Radius px: 2 / 4 / 8 (inputs, buttons) / 12 (cards) / 999 (pills). Control heights: sm 32, md 40, lg 48. Layout: sidebar 240 px, top bar 64 px, content padding 32 px, max content width 1136 px, form column 772 px + side column 340 px (screen 05).

---

## File Structure

```
package.json                         # deps + scripts (Task 0)
vite.admin.config.ts                 # SPA build (Task 0)
tsconfig.json                        # exclude src/admin (Task 0)
wrangler.jsonc                       # run_worker_first += /admin, /admin/* (Task 0)
.dev.vars.example                    # optional CF_ACCOUNT_ID / CF_API_TOKEN (Task 2)
test/worker/global-setup.ts          # bun run build (Task 0)
cli/src/bundle/build.ts (+test), cli/test/e2e.test.ts   # bun run build, new run_worker_first (Task 0)
migrations/0001_*.sql + meta         # api_tokens (Task 3)
src/
  shared/
    tokens.css                       # design tokens light/dark (Task 0)
    admin-api.ts                     # ALL admin API contract types (Task 0) — read-only after
    monitor-schema.ts (+test)        # monitor Zod schema moved from monitors.ts (Task 0) — read-only after
  core/budget.ts (+test)             # peakChecksPerMinute, effectiveBudget (Task 0)
  core/usage.ts (+test)              # estimateWritesToday (Task 2)
  core/public-status.ts              # export monitorStateAt (Task 2)
  core/types.ts                      # CurrentEntry + code, error (Task 2)
  tick/tick.ts                       # writes code/error into snapshot.current (Task 2)
  lib/cf-analytics.ts                # optional GraphQL usage (Task 2)
  lib/api-tokens.ts (+test)          # generate/hash/prefix (Task 3)
  db/schema.ts                       # api_tokens table (Task 3)
  env.ts                             # CF_ACCOUNT_ID?, CF_API_TOKEN? (Task 2)
  api/app.ts                         # mounts all routers (Task 0) — read-only after
  api/admin-spa.ts                   # /admin static + fallback (stub Task 0, real Task 2)
  api/admin/monitor-columns.ts       # DEFAULTS, toColumns, toApi helpers moved from monitors.ts (Task 0) — read-only after
  api/admin/monitors.ts              # status enrichment, detail, test check, budget guard (Task 2)
  api/admin/groups.ts, settings.ts   # monitorCount; effectiveBudget, checksPerMinute (Task 2)
  api/admin/session.ts, overview.ts, events.ts   # (stub Task 0, real Task 2)
  api/admin/auth.ts                  # Bearer tokens in requireAdmin (Task 3)
  api/admin/tokens.ts, transfer.ts   # (stub Task 0, real Task 3)
  admin/
    index.html  main.tsx  app.tsx  routes.tsx  tsconfig.json  styles/globals.css     # Task 0
    public/favicon.svg  public/illustrations/*.webp                                   # Task 0
    lib/api.ts  lib/query-client.ts  lib/utils.ts  lib/format.ts (+test)              # Task 0
    api/use-*.ts                     # TanStack Query hooks per resource (Task 0)
    stores/ui.ts                     # Zustand: theme, setupDismissed, sidebarOpen (Task 0)
    components/ui/*.tsx              # shadcn-style primitives (Task 1)
    components/shared/*.tsx          # Logo, Illustration, PageHeader, StatePill, UptimeBars, … (Task 1)
    features/shell/*  features/auth/*  features/setup/*          # Task 4
    features/monitors/*                                           # Task 5
    features/overview/*  features/events/*  features/groups/*  features/status-page/*  features/settings/*   # Task 6
test/worker/admin-overview.spec.ts  admin-monitor-status.spec.ts  admin-spa.spec.ts   # Task 2
test/worker/admin-tokens.spec.ts  admin-transfer.spec.ts                              # Task 3
```

`bun test` (root `src`) also runs `src/admin/**/*.test.ts` and `src/shared/**/*.test.ts`; Bun resolves `@/` per nearest `tsconfig.json` (verified: `src/admin/tsconfig.json` wins inside `src/admin`). Admin tests are pure logic only (no DOM).

**Parallel execution:** **Task 0 first.** Then **Tasks 1, 2, 3 in parallel.** Tasks **4, 5, 6** start when Task 1 is done (they may overlap with 2 and 3: they code against `src/shared/admin-api.ts`, not against a running backend). **Task 7** last.

```
Task 0 ──┬── Task 1 (ui kit) ──┬── Task 4 (shell, login, wizard)
         │                     ├── Task 5 (monitors)
         │                     └── Task 6 (overview, groups, status page, settings, events)
         ├── Task 2 (backend: status, overview, events, check, budget, spa) ─┐
         └── Task 3 (backend: tokens, bearer, import/export) ────────────────┤
                                              Tasks 2,3,4,5,6 ───────────────┴── Task 7 (integration)
```

Each task owns only the paths in its Files block. Files marked read-only after Task 0 (`src/shared/*`, `src/api/app.ts`, `src/admin/routes.tsx`, `src/admin/api/*`, `src/api/admin/monitor-columns.ts`, `src/core/budget.ts`) are not edited by Tasks 1–6: a needed change is reported to the integrator, not made.

---

### Task 0: Foundation — scaffold, tokens, contracts, shared schema, client, hooks

**Files:**
- Create: `vite.admin.config.ts`, `src/admin/{index.html,main.tsx,app.tsx,routes.tsx,tsconfig.json}`, `src/admin/styles/globals.css`, `src/admin/public/favicon.svg`, `src/admin/public/illustrations/{welcome,done,all-good,stale,error,empty-monitors,heartbeat}.webp` + `transparent/{welcome,done,all-good,stale,error}.webp`, `src/admin/lib/{api.ts,query-client.ts,utils.ts,format.ts,format.test.ts,api.test.ts}`, `src/admin/api/{use-session.ts,use-overview.ts,use-monitors.ts,use-groups.ts,use-settings.ts,use-events.ts,use-tokens.ts,use-transfer.ts,keys.ts}`, `src/admin/stores/ui.ts`, `src/shared/{tokens.css,admin-api.ts,monitor-schema.ts,monitor-schema.test.ts}`, `src/core/budget.ts`, `src/core/budget.test.ts`, `src/api/admin/monitor-columns.ts`, stub routers `src/api/admin/{session,overview,events,tokens,transfer}.ts`, `src/api/admin-spa.ts`, one placeholder component per page module listed in `routes.tsx`
- Modify: `package.json`, `tsconfig.json`, `wrangler.jsonc`, `src/api/app.ts`, `src/api/admin/monitors.ts` (move only, no behaviour change), `test/worker/global-setup.ts`, `cli/src/bundle/build.ts`, `cli/src/bundle/build.test.ts`, `cli/test/e2e.test.ts`

**Interfaces — Produces:**

`src/shared/monitor-schema.ts` (moved verbatim from `src/api/admin/monitors.ts`, behaviour identical):
- `INTERVALS = [1, 2, 3, 5, 10, 15, 30, 60] as const`, `SLUG_RE = /^[a-z0-9-]{1,64}$/`, `monitorShape`, `monitorInput` (with the `superRefine`), `monitorPatch = z.object(monitorShape).partial()`, `type MonitorInput = z.input<typeof monitorInput>`, `slugify(name: string): string` (lowercase, non `[a-z0-9]` runs → `-`, trimmed, ≤ 64, empty → `"monitor"`).

`src/api/admin/monitor-columns.ts` (moved): `DEFAULTS`, `toColumns`, `toApiMonitor(row, origin)` (old `toApi`, without status), `withoutUndefined`, `isUnique`, `parseHeaders`, `pauseLifecycle(db, row, paused, now)` (old `pauseLifecycle`, takes the db instead of the Hono context).

`src/core/budget.ts`:
- `type BudgetMonitor = { id: string; type: MonitorType; intervalMin: number; paused: boolean }`
- `peakChecksPerMinute(ms: BudgetMonitor[]): number` — max over `m ∈ [0, 60)` of `#{ http|tcp, !paused, isDue(m) }`.
- `effectiveBudget(plan: "free" | "paid", override: number | null): number` — `checkBudget(plan, override ?? undefined)` (free stays clamped to 40).
- `budgetVerdict(before: BudgetMonitor[], after: BudgetMonitor[], budget: number): { ok: true } | { ok: false; used: number; after: number; budget: number }` — refuse only when `peak(after) > budget && peak(after) > peak(before)`.

`src/shared/admin-api.ts` (exact; type-only imports from `../core/types` and `../core/stats`):

```ts
import type { ErrorClass, MonitorState, MonitorType, KeywordMode } from "../core/types";
import type { Bar } from "../core/stats";
import type { MonitorInput } from "./monitor-schema";

export type Plan = "free" | "paid";
export type AdminState = "up" | "degraded" | "down" | "maintenance" | "paused" | "pending" | "unknown";
export type Issue = { path: (string | number)[]; message: string };
export type ApiErrorBody = { error: string; issues?: Issue[]; [k: string]: unknown };

export type Session = {
  version: string; installSource: "cli" | "cloud" | "git" | null;
  siteName: string; plan: Plan;
  auth: "cookie" | "token"; scope: "admin" | "read";
  analytics: boolean;                                   // CF_ACCOUNT_ID + CF_API_TOKEN set
  counts: { monitors: number; heartbeats: number; groups: number };  // monitors = http + tcp
};

export type MonitorStatus = {
  state: AdminState;                                    // same rules as public (stale → unknown), incl. private monitors
  lastCheckedAt: number | null; latencyMs: number | null;
  code: number | null; error: ErrorClass | null;
  lastBeatAt: number | null;                            // heartbeats only
  uptime30: number | null;                              // observed-weighted, from snapshot bars, null if no data
};
export type Monitor = {
  id: string; slug: string; name: string; type: MonitorType; groupId: string | null;
  url: string | null; method: string; headers: Record<string, string>; body: string | null;
  expectedStatus: string; timeoutMs: number; followRedirects: boolean;
  keyword: string | null; keywordMode: KeywordMode; host: string | null; port: number | null;
  intervalMin: number; confirmations: number; degradedThresholdMs: number | null;
  heartbeatPeriodS: number | null; heartbeatGraceS: number | null;
  isPublic: boolean; paused: boolean; sort: number; createdAt: number; updatedAt: number;
  beatUrl?: string;                                     // heartbeats only
  status: MonitorStatus;
};
export type StateEvent = {
  id: number; monitorId: string; monitorName: string; monitorType: MonitorType;
  from: MonitorState; to: MonitorState; at: number;
  reason: string;                                       // ErrorClass | "ok" | "paused" | "unpaused"
  prevDurationS: number | null;                         // seconds spent in `from` (previous event of the same monitor)
};
export type MonitorDetail = Monitor & { bars: Bar[]; events: StateEvent[] };   // 90 aligned bars, last 20 events
export type MonitorCreate = MonitorInput;
export type MonitorPatch = Partial<MonitorInput>;
export type TestCheckResult = { ok: boolean; latencyMs: number | null; code: number | null; error: ErrorClass | null; at: number };
export type BudgetExceeded = { error: "budget_exceeded"; used: number; after: number; budget: number };

export type Group = { id: string; slug: string; name: string; sort: number; monitorCount: number };
export type GroupCreate = { slug: string; name: string; sort?: number };
export type GroupPatch = Partial<GroupCreate>;

export type Settings = {
  siteName: string; plan: Plan; checkBudget: number | null;
  effectiveBudget: number; checksPerMinute: number;     // peakChecksPerMinute of current monitors
};
export type SettingsPatch = { siteName?: string; plan?: Plan; checkBudget?: number | null };

export type UsageSource = "analytics" | "estimate";
export type Overview = {
  now: number;
  tick: { lastTickAt: number | null; stale: boolean };  // DB lastTickAt 0 → null
  counts: Record<AdminState, number>;
  totals: { all: number; checks: number; heartbeats: number };
  usage: {
    checksPerMinute: { used: number; budget: number; plan: Plan };
    d1WritesToday: { value: number; projected: number; limit: number | null; source: UsageSource };
    requestsToday: { value: number; limit: number | null } | null;   // null = not tracked
  };
  recentEvents: StateEvent[];                           // last 7 days, newest first, max 5
};
export type EventsPage = { items: StateEvent[]; nextBefore: number | null };

export type ApiTokenScope = "read" | "admin";
export type ApiToken = { id: string; name: string; scope: ApiTokenScope; prefix: string; createdAt: number; lastUsedAt: number | null };
export type ApiTokenCreate = { name: string; scope: ApiTokenScope };
export type ApiTokenCreated = ApiToken & { token: string };   // only time the plaintext exists

export type ExportFile = {
  edgebeat: 1; exportedAt: string;
  settings: { siteName: string; plan: Plan; checkBudget: number | null };
  groups: { slug: string; name: string; sort: number }[];
  monitors: (Omit<MonitorInput, "groupId"> & { group: string | null })[];   // group = group slug
};
export type ImportSummary = {
  dryRun: boolean; prune: boolean; settingsChanged: boolean;
  groups: { created: string[]; updated: string[]; deleted: string[] };     // slugs
  monitors: { created: string[]; updated: string[]; deleted: string[] };
};
```

Endpoint table (implemented in Tasks 2/3; all under `/api/admin`, `Cache-Control: no-store`, errors `ApiErrorBody`):

| Method path | Request | 2xx response | Errors | Task |
|---|---|---|---|---|
| `POST /login` | `{ password }` | 204 + cookie | 401 `invalid_credentials`, 429 `too_many_attempts`, 500 `weak_admin_password` / `server_misconfigured` | existing |
| `POST /logout` | — | 204 | — | existing |
| `GET /session` | — | `Session` | 401 | 2 |
| `GET /overview` | — | `Overview` | 401 | 2 |
| `GET /monitors` | — | `Monitor[]` | | 2 |
| `POST /monitors` | `MonitorCreate` | 201 `Monitor` | 400 `validation`/`invalid_url`, 409 `slug_conflict`/`budget_exceeded` | 2 |
| `GET /monitors/:id` | — | `MonitorDetail` | 404 | 2 |
| `PATCH /monitors/:id` | `MonitorPatch` | `Monitor` | as POST + 404 | 2 |
| `DELETE /monitors/:id` | — | 204 | 404 | existing |
| `POST /monitors/:id/rotate-token` | — | `Monitor` | 400 `not_heartbeat`, 404 | existing |
| `POST /monitors/:id/check` | — | `TestCheckResult` | 400 `not_checkable`, 404, 429 `too_many_checks` | 2 |
| `GET /events?monitorId&before&limit` | limit ≤ 100, default 50 | `EventsPage` | | 2 |
| `GET /groups` | — | `Group[]` | | 2 |
| `POST /groups`, `PATCH /groups/:id`, `DELETE /groups/:id` | `GroupCreate` / `GroupPatch` | 201 `Group` / `Group` / 204 | 400, 404, 409 `slug_conflict` | existing + `monitorCount` (2) |
| `GET /settings`, `PATCH /settings` | `SettingsPatch` | `Settings` | 400 | 2 |
| `GET /tokens` | — | `ApiToken[]` | 403 `session_required` | 3 |
| `POST /tokens` | `ApiTokenCreate` | 201 `ApiTokenCreated` | 400, 403, 409 `too_many_tokens` | 3 |
| `DELETE /tokens/:id` | — | 204 | 403, 404 | 3 |
| `GET /export` | — | `ExportFile` (`Content-Disposition: attachment; filename="edgebeat-config-YYYY-MM-DD.json"`) | | 3 |
| `POST /import?prune&dryRun` | `ExportFile` | `ImportSummary` | 400 `validation`, 409 `budget_exceeded`, 413 `too_large` | 3 |

`src/admin/lib/api.ts`:
- `type ApiError = Error & { status: number; code: string; issues: Issue[]; body: ApiErrorBody | null }`; `isApiError(e): e is ApiError`; `makeApiError(status, body)`.
- `api.get<T>(path)`, `api.post<T>(path, body?)`, `api.patch<T>(path, body)`, `api.del(path)`, `api.download(path): Promise<Blob>` — base `/api/admin`, `credentials: "same-origin"`, JSON in/out, 204 → `undefined`; non-2xx → throws `ApiError` (network failure → `status: 0, code: "network"`).
- `setUnauthorizedHandler(fn: () => void)` — called on any 401 except `/login`.
- `fieldErrors(e: ApiError): Record<string, string>` — maps `issues[].path.join(".")` → message; `invalid_url` → `{ url: "Private addresses like 10.0.0.1 aren't allowed. Use a public hostname." }`; `slug_conflict` → `{ slug: "Another monitor already uses this slug." }`.

`src/admin/api/keys.ts`: `qk = { session: ["session"], overview: ["overview"], monitors: ["monitors"], monitor: (id) => ["monitors", id], groups: ["groups"], settings: ["settings"], events: (f) => ["events", f], tokens: ["tokens"] } as const`.

Hooks (each file exports exactly these; invalidations as listed):
- `use-session.ts`: `useSession()`, `useLogin()` (→ invalidate all), `useLogout()` (→ `queryClient.clear()`).
- `use-overview.ts`: `useOverview()` (refetch 15 s).
- `use-monitors.ts`: `useMonitors()` (30 s), `useMonitor(id, { fast?: boolean })` (15 s / 5 s), `useCreateMonitor()`, `useUpdateMonitor(id)`, `useDeleteMonitor()`, `useRotateToken(id)`, `useTestCheck(id)`. Mutations invalidate `monitors`, `monitor(id)`, `overview`, `session`, `groups`, `settings`.
- `use-groups.ts`: `useGroups()`, `useCreateGroup()`, `useUpdateGroup()`, `useDeleteGroup()` (invalidate `groups`, `monitors`, `session`).
- `use-settings.ts`: `useSettings()`, `useUpdateSettings()` (invalidate `settings`, `session`, `overview`).
- `use-events.ts`: `useEvents(filter: { monitorId?: string })` (infinite query on `nextBefore`).
- `use-tokens.ts`: `useTokens()`, `useCreateToken()`, `useDeleteToken()`.
- `use-transfer.ts`: `useExport()` (download → `URL.createObjectURL` + anchor), `useImport()` (`{ file: ExportFile; prune: boolean; dryRun: boolean }`; non-dry-run invalidates everything).

`src/admin/stores/ui.ts` (Zustand + `persist`, key `edgebeat-admin-ui`): `{ theme: "system" | "light" | "dark"; setupDismissed: boolean; sidebarOpen: boolean; setTheme; dismissSetup; resetSetup; setSidebarOpen }` (`sidebarOpen` not persisted).

`src/admin/lib/format.ts`: `ago(ms, now)` → `"12 s ago" | "3 min ago" | "7 h ago" | "Nov 7"`; `duration(s)` → `"4 min" | "1 h 10 min" | "2 d 3 h"`; `intervalLabel(min)` → `"1 min" | "24 h"`; `periodLabel(s)`; `pct(uptime)` → `"99.98%"` / `"100%"` / `"—"`; `ms(n)` → `"182 ms"`; `compact(n)` → `"6.2k"`; `errorLabel(ErrorClass)` → `"Timeout" | "DNS error" | "Connection failed" | "TLS error" | "Wrong status" | "Keyword rule failed" | "Heartbeat late" | "Job reported failure" | "Error"`; `stateLabel(AdminState)`.

`src/admin/routes.tsx` (read-only after Task 0) — `createRoutesFromElements` / `<Routes>` with lazy page modules:

| Path | Module (default export) | Owner |
|---|---|---|
| `login` | `@/features/auth/LoginPage` | 4 |
| `setup` | `@/features/setup/SetupPage` | 4 |
| layout element | `@/features/shell/AppLayout` (renders `<Outlet/>`, guards session) | 4 |
| `index` | `@/features/overview/OverviewPage` | 6 |
| `monitors` | `@/features/monitors/MonitorsPage` | 5 |
| `heartbeats` | `@/features/monitors/HeartbeatsPage` | 5 |
| `monitors/new` | `@/features/monitors/MonitorFormPage` | 5 |
| `monitors/:id` | `@/features/monitors/MonitorDetailPage` | 5 |
| `monitors/:id/edit` | `@/features/monitors/MonitorFormPage` | 5 |
| `groups` | `@/features/groups/GroupsPage` | 6 |
| `status-page` | `@/features/status-page/StatusPageSettingsPage` | 6 |
| `settings` | `@/features/settings/SettingsPage` | 6 |
| `events` | `@/features/events/EventsPage` | 6 |
| `*` | `@/features/shell/NotFoundPage` | 4 |

- [ ] **Step 1:** `bun add react react-dom react-router @tanstack/react-query zustand react-hook-form @hookform/resolvers radix-ui class-variance-authority clsx tailwind-merge lucide-react sonner date-fns @fontsource-variable/geist @fontsource-variable/geist-mono` and `bun add -d @vitejs/plugin-react @types/react @types/react-dom`. Current versions; record them in the commit body.
- [ ] **Step 2:** Scripts: `"build": "vite build && vite build -c vite.admin.config.ts"`, `"dev": "bun run build && wrangler dev --test-scheduled"`, `"dev:admin": "vite -c vite.admin.config.ts"`, `"typecheck": "tsc --noEmit && tsc --noEmit -p src/status-page && tsc --noEmit -p src/admin"`. Root `tsconfig.json`: add `"src/admin"` to `exclude`. `src/admin/tsconfig.json`: like the status-page one plus `"jsx": "react-jsx"`, `"paths": { "@/*": ["./*"], "@shared/*": ["../shared/*"] }`, `"types": ["vite/client", "bun"]`, include `.` and `../shared`.
- [ ] **Step 3:** `vite.admin.config.ts`: `root: "src/admin"`, `base: "/admin/"`, plugins `react()`, `tailwindcss()`, aliases `@` → `src/admin`, `@shared` → `src/shared`, `build: { outDir: "../../dist/status-page/admin", emptyOutDir: true, sourcemap: false }`, dev `server.proxy` for `/api` and `/beat` → `http://localhost:8787` with `headers: { origin: "http://localhost:8787" }` (the Worker's Origin check compares against its own origin). The status-page build runs first because it empties `dist/status-page`.
- [ ] **Step 4:** `src/shared/tokens.css`: every token from the Tokens table as CSS custom properties on `:root` (light) and `.dark` (dark); `src/admin/styles/globals.css`: `@import "tailwindcss"; @import "../../shared/tokens.css"; @custom-variant dark (&:where(.dark, .dark *));` and `@theme inline` mapping (`--color-bg`, `--color-surface`, `--color-surface-2/3`, `--color-border`, `--color-text`, `--color-muted`, `--color-accent*`, state colors, `--font-sans: "Geist Variable", ui-sans-serif, system-ui`, `--font-mono: "Geist Mono Variable", ui-monospace`, `--radius-*`), base `body { background: var(--bg); color: var(--text) }`, `:focus-visible` ring `0 0 0 3px var(--focus-ring)`, `@media (prefers-reduced-motion: reduce)` kills transitions.
- [ ] **Step 5:** Illustrations: `cwebp -q 82 -resize 640 0` for 1536×1024 sources and `-resize 480 0` for square ones, from `/Users/yolk/Pego/edgebeat/illustrations/` (and `transparent/`) into `src/admin/public/illustrations/` (each ≤ 60 KB; commit the `.webp` outputs, not the PNGs). `favicon.svg` = logo mark.
- [ ] **Step 6:** Move the schema to `src/shared/monitor-schema.ts` and the column helpers to `src/api/admin/monitor-columns.ts`; `monitors.ts` imports them. Write `src/core/budget.ts`, `admin-api.ts`, `api.ts`, `format.ts`, hooks, `stores/ui.ts`, `query-client.ts` (`retry: (n, e) => !isApiError(e) || e.status >= 500 ? n < 2 : false`, `staleTime: 10_000`), `utils.ts` (`cn`).
- [ ] **Step 7:** `index.html` (`<div id="root">`, `<meta name="robots" content="noindex">`, title `Edgebeat admin`), `main.tsx` (fonts, globals.css, `createRoot`), `app.tsx` (`QueryClientProvider`, `BrowserRouter basename="/admin"`, `<Toaster/>` placeholder from sonner, theme sync effect: `.dark` on `<html>` from `ui.theme` + `matchMedia("(prefers-color-scheme: dark)")`), `routes.tsx` + placeholder page modules (each renders its route name; owners replace them).
- [ ] **Step 8:** Backend wiring: stub routers (`new Hono<{ Bindings: Env }>()` with no routes) for `session`, `overview`, `events`, `tokens`, `transfer`; mount in `app.ts` at `/api/admin/session`, `/overview`, `/events`, `/tokens`, and `transfer` at `/api/admin` (routes `/export`, `/import`). `src/api/admin-spa.ts` stub: `adminSpa` handler `c => c.env.ASSETS.fetch(c.req.raw)`; mount `app.get("/admin", …)` and `app.get("/admin/*", …)`. `wrangler.jsonc` `run_worker_first: ["/api/*", "/beat/*", "/admin", "/admin/*"]`.
- [ ] **Step 9:** `test/worker/global-setup.ts` runs `bun run build`. `cli/src/bundle/build.ts` runs `bun run build` instead of `vite build`; `build.test.ts` and `cli/test/e2e.test.ts` expect the new `run_worker_first` and `build.test.ts` also asserts `assets/admin/index.html` contains `<div id="root">`.
- [ ] **Step 10:** Failing-then-passing unit tests:
  - `monitor-schema.test.ts`: the existing validation cases from `test/worker/admin.spec.ts` (interval 4 rejected, tcp port 25, GET with body, HEAD with keyword) hold on the shared schema; `slugify("Acme API!") === "acme-api"`, `slugify("!!!") === "monitor"`.
  - `budget.test.ts`: 40 one-minute http monitors → peak 40; heartbeats and paused excluded; 60 five-minute monitors → peak equals the max slot bucket (compute expected in-test with `slotOf`); `budgetVerdict` refuses 41st on free, allows a rename when already at 45 (peak unchanged), allows lowering.
  - `format.test.ts`: one case per formatter branch, including `pct(null) === "—"` and `pct(1) === "100%"`.
  - `api.test.ts` (inject `fetch` via `globalThis.fetch` override): 204 → `undefined`; 400 with issues → `ApiError` with `issues`; 401 on `/monitors` calls the unauthorized handler, 401 on `/login` does not; network error → `code: "network"`; `fieldErrors` maps `invalid_url` and nested paths.
- [ ] **Step 11:** `bun run build` → `dist/status-page/index.html` and `dist/status-page/admin/index.html` exist; `bun run typecheck` → clean; `bun run test` → all existing + new tests pass. Commit `chore(admin): scaffold admin spa, shared contracts and budget core`.

---

### Task 1: UI kit (shadcn-style primitives and shared pieces)

**Files:**
- Create: `src/admin/components/ui/{button,input,textarea,label,field,select,switch,switch-card,tabs,radio-card,card,badge,table,dialog,confirm-dialog,dropdown-menu,tooltip,collapsible,code-block,copy-button,empty-state,meter,skeleton,toaster,breadcrumb}.tsx`, `src/admin/components/shared/{Logo,Illustration,PageHeader,StatePill,UptimeBars,KeyValueList,InfoCard}.tsx`. No gallery route, no README.
- Modify: `src/admin/app.tsx` only to swap the placeholder Toaster for `components/ui/toaster`.

**Interfaces — Produces** (props are the contract for Tasks 4–6):
- `Button` — `variant: "primary" | "secondary" | "ghost" | "destructive"`, `size: "md" | "sm"` (40 / 32 px), `icon?: LucideIcon` (leading), `loading?: boolean`, `asChild?` (Radix Slot). Pego `1e0iec0i` `0gcnu4sz` `cizcvkb2` `wm7zw64o` + sm twins.
- `Input` — `mono?: boolean`, `invalid?: boolean`, `trailing?: ReactNode` (lock icon in screen 08). `Field` — `{ label, helper?, error?, optional?: boolean, htmlFor, children }`; error replaces helper, red, `CircleAlert` icon, `aria-describedby` / `aria-invalid` wiring. Pego `b8psr2qc`.
- `Select` (Radix) — `{ value, onValueChange, options: { value: string; label: string }[], placeholder?, invalid? }`, menu shows a check on the selected item. Pego `5of9mrt6` / `8j296j8h`.
- `Switch`, `SwitchCard` (`{ title, description, checked, onCheckedChange }`, screen 05 "Show on status page"). Pego `oqvent5l` / `ouzrxhlm`.
- `Tabs` (segmented; `{ value, onValueChange, items: { value; label; count? }[] }`, counts in mono muted). Pego `7al02k8c`.
- `RadioCards` (Radix RadioGroup; `{ value, onValueChange, items: { value; title; description; icon: LucideIcon }[], columns: 2 | 3 }`). Pego `j5nv6drz` / `e5850dhx`.
- `Card` (`title?`, `description?`, `actions?`, `footer?` with `bg-surface-2` sticky footer variant). Pego `quqgtcnz`.
- `Badge` (`variant: "neutral" | "accent"`, mono uppercase 11 px). `StatePill` (`state: AdminState | "partial"`, dot + label, tokens per state; `pending` hollow dot, `paused` pause glyph). Pego pills ids above.
- `Table` set (`Table`, `THead`, `TRow`, `TCell`, numeric right-aligned mono). Pego `d0lkktea` / `28cj2xxq` / `amr-row`.
- `Dialog`, `ConfirmDialog` (`{ title, body, confirmLabel, destructive?, onConfirm, open, onOpenChange }`), `DropdownMenu`, `Tooltip`, `Collapsible`.
- `CodeBlock` (`{ caption, code }`, header with `CopyButton`). `CopyButton` (`{ value, label?: "Copy" }`, `navigator.clipboard`, toast "Copied"). Pego `t1884ri3`.
- `EmptyState` (`{ illustration?: IllustrationName; title; body; actions }`). Pego `x3jft7gt`.
- `Meter` (`{ value: number; max: number | null; tone?: "accent" | "neutral" | "warn" | "bad" }`, auto `warn` ≥ 80 %, `bad` ≥ 100 %).
- `Toaster` (sonner, styled as Pego `czwss4gu` / `gjox43fk`, bottom-right, close button).
- `Breadcrumb` (`items: { label; to? }[]`). `PageHeader` (`{ title, breadcrumb?, pill?, actions? }`).
- `Logo` (`{ wordmark?: boolean; size?: number }`, exact SVG from the Design map). `Illustration` (`{ name: "welcome" | "done" | "all-good" | "stale" | "error" | "empty-monitors" | "heartbeat"; className? }` → `/admin/illustrations/<name>.webp`; in dark theme uses `transparent/<name>.webp` when it exists, otherwise wraps the light image in a rounded `#EDEDF0` plate; `alt=""` decorative, `loading="lazy"`, explicit width/height).
- `UptimeBars` (`{ bars: Bar[] }`, 90 bars, colors as the status page: `null` unknown, `1` up, `≥ 0.99` lime, `≥ 0.95` degraded, else down; Tooltip with day, uptime %, downtime minutes; shows last 60/30 bars below 640/400 px). Pego `aberweu8` / `vgl5npy3`.
- `KeyValueList` (`{ items: { label; value: ReactNode; mono? }[] }`, screen 06 right card). `InfoCard` (`{ title, children }`, `bg-surface-2`, "When is it Down?").

Rules: every interactive element keyboard reachable with visible focus ring; icon-only buttons have `aria-label`; hit targets ≥ 32 px; colors only via tokens (no raw hex in components); `prefers-reduced-motion` respected.

- [ ] **Step 1:** Implement the primitives (shadcn/ui source as the starting point, restyled to the tokens and the Pego component screenshots `ds-components.png`).
- [ ] **Step 2:** `tsc --noEmit -p src/admin` clean; `bun run build` passes; bundle check: `ls -la dist/status-page/admin/assets` — initial JS ≤ 250 KB gzip (`gzip -c <file> | wc -c`).
- [ ] **Step 3:** Commit `feat(admin): ui kit with design-system components`.

---

### Task 2: Backend — monitor status, overview, events, test check, budget guard, SPA serving

**Files:**
- Modify: `src/core/types.ts` (`CurrentEntry` + `code: number | null; error: ErrorClass | null`, both optional when reading old snapshots), `src/tick/tick.ts` (write them), `src/core/public-status.ts` (export `monitorStateAt` = current `stateOf`, no behaviour change), `src/api/admin/monitors.ts`, `src/api/admin/groups.ts`, `src/api/admin/settings.ts`, `src/env.ts` (`CF_ACCOUNT_ID?: string; CF_API_TOKEN?: string`), `.dev.vars.example` (commented optional vars), fill `src/api/admin/{session,overview,events}.ts`, `src/api/admin-spa.ts`
- Create: `src/core/usage.ts`, `src/core/usage.test.ts`, `src/lib/cf-analytics.ts`
- Test: `test/worker/admin-overview.spec.ts`, `test/worker/admin-monitor-status.spec.ts`, `test/worker/admin-spa.spec.ts`; existing `admin.spec.ts`, `tick.spec.ts`, `public.spec.ts` must stay green.

**Interfaces:**
- Consumes: Task 0 contracts, `peakChecksPerMinute`, `budgetVerdict`, `effectiveBudget`, `monitor-columns.ts`, `runHttpCheck`, `runTcpCheck`, `alignBars`, `TICK_STALE_MS`.
- Produces (rows of the endpoint table marked Task 2):
  - `GET /session` → `Session` (`auth: "cookie"`, `scope: "admin"` until Task 3 sets them from the request; read them from `c.get("auth")` if present, else cookie defaults).
  - `GET /monitors` adds `status` to every monitor (one `db.batch` of monitors + snapshot + heartbeats; `uptime30` from the last 30 aligned bars, observed-weighted).
  - `GET /monitors/:id` → `MonitorDetail` (bars aligned 90 days, last 20 events with `prevDurationS`).
  - `POST /monitors/:id/check` → `TestCheckResult`; http uses `runHttpCheck(m, min(m.timeoutMs, 15_000), takeSubrequest)` with at most 6 subrequests; tcp `runTcpCheck`; heartbeat → 400 `not_checkable`; per-isolate fixed window 6 checks/minute → 429 `too_many_checks`; **no D1 writes**.
  - Budget guard on `POST`/`PATCH /monitors` (create, unpause, interval change, type http/tcp) → 409 `BudgetExceeded`.
  - `GET /groups` adds `monitorCount`; `GET|PATCH /settings` add `effectiveBudget` and `checksPerMinute`.
  - `GET /events?monitorId&before&limit` → `EventsPage` ordered `id DESC`, `before` = exclusive id cursor, joined monitor name/type (deleted monitors' events are already removed by DELETE).
  - `GET /overview` → `Overview`: `counts` via `monitorStateAt` over **all** monitors (private included), `recentEvents` last 7 days max 5, `usage` from settings + `peakChecksPerMinute` + `cf-analytics` or `estimateWritesToday`.
  - `estimateWritesToday(i: { minutesElapsed: number; ticksToday: number; activeChecked: number; eventsToday: number; heartbeatPeriodsS: number[] }): { value: number; projected: number }` — `ticksToday × 3` (ticks insert + lock + snapshot) `+ floor(ticksToday / 15) × (activeChecked + 1)` (rollup upserts + snapshot) `+ eventsToday × 2` (event + state) `+ Σ min(minutesElapsed × 2, minutesElapsed × 60 / periodS)` (coalesced beats) `+ floor(minutesElapsed / 60) × 60` (hourly prune); `projected = round(value × 1440 / max(minutesElapsed, 15))`.
  - `fetchUsage(env, now): Promise<{ d1Writes: number; requests: number } | null>` in `cf-analytics.ts` — POST `https://api.cloudflare.com/client/v4/graphql` with `Authorization: Bearer CF_API_TOKEN`, account-wide sums for today UTC (`workersInvocationsAdaptive.sum.requests`, `d1AnalyticsAdaptiveGroups.sum.rowsWritten`; verify field names against the current GraphQL schema while implementing). Cached 300 s in `caches.default` under a synthetic `https://edgebeat.internal/usage/<accountId>/<day>` key. Any error or missing secret → `null`. The token is never logged or returned.
  - `adminSpa`: `GET /admin` and `/admin/*`. If the last path segment contains a `.` → `ASSETS.fetch(request)` passthrough; 404 stays 404; `/admin/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`. Otherwise → `ASSETS.fetch(new Request(origin + "/admin/"))` with headers `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Cache-Control: no-store`. Not authenticated: the SPA shell is public; data is behind `/api/admin`.

- [ ] **Step 1:** Failing tests:
  - `usage.test.ts`: zero minutes → value 0, projected 0; 600 ticks, 10 checked, 4 events, one 60 s heartbeat at minute 600 → expected value computed by the formula; projection scales to 1 440 minutes.
  - `admin-monitor-status.spec.ts`: seed monitors + snapshot `current` (with `code`, `error`) + bars → list returns `status.state/latencyMs/code/uptime30`; private monitor included; paused → `paused`; snapshot `lastTickAt` 4 min old → every non-paused `unknown`; heartbeat `lastBeatAt` exposed; detail has 90 bars and events with `prevDurationS`; `check` on an http monitor with `fetchMock` 200 → `{ ok: true, code: 200 }` and D1 row counts unchanged (Review Focus 7); `check` on heartbeat → 400; 7th check in a minute → 429; `budget guard`: 40 one-minute http monitors exist on free → 41st → 409 with `{ used: 40, after: 41, budget: 40 }`, heartbeat create still 201, rename of an existing monitor 200; switching plan to paid → 41st → 201.
  - `admin-overview.spec.ts`: `overview reports stale tick and unknown states` (Review Focus 1); fresh tick → counts by state, totals, `usage.checksPerMinute.used` = peak, `d1WritesToday.source === "estimate"`, `requestsToday === null` without CF secrets; `recentEvents` newest first, max 5, only last 7 days; `session` returns version, counts, `analytics: false`; `events` pagination with `before` returns disjoint pages and `nextBefore: null` at the end; `admin reads do not write` (count rows in every table before/after GET overview, monitors, monitor, events, session, settings).
  - `admin-spa.spec.ts` (`admin spa fallback`, call the worker via `SELF.fetch`; it serves from the built `ASSETS`): `GET /admin` and `/admin/monitors/abc` → 200 HTML containing `<div id="root">` with the CSP header; `GET /admin/assets/missing.js` → 404 and not HTML; `GET /admin/favicon.svg` → 200 `image/svg+xml`; `GET /api/v1/health` unaffected.
  - Tick: after a tick with a 503 result, `snapshot.current[id]` has `code: 503, error: "status"`; old snapshot rows without the fields still parse.
- [ ] **Step 2:** `bun test src/core/usage.test.ts && bunx vitest run test/worker/admin-*.spec.ts test/worker/tick.spec.ts` → FAIL.
- [ ] **Step 3:** Implement. **Step 4:** → PASS; full `bun run test` and `bun run typecheck` → pass.
- [ ] **Step 5:** Commit `feat(api): admin status, overview, events, test check, budget guard and spa serving`.

---

### Task 3: Backend — API tokens, Bearer auth, import/export

**Files:**
- Modify: `src/db/schema.ts` (`apiTokens`), `src/api/admin/auth.ts` (`requireAdmin` accepts Bearer; sets `c.set("auth", { kind, scope, tokenId? })`), fill `src/api/admin/{tokens,transfer}.ts`
- Create: `migrations/0001_*.sql` + `migrations/meta/*` (via `bunx drizzle-kit generate`), `src/lib/api-tokens.ts`, `src/lib/api-tokens.test.ts`
- Test: `test/worker/admin-tokens.spec.ts`, `test/worker/admin-transfer.spec.ts`

**Interfaces:**
- Consumes: Task 0 contracts, `monitorInput`, `monitor-columns.ts`, `budgetVerdict`, `effectiveBudget`, `chunkRows`/`MAX_PARAMS` from `src/tick/batch.ts`.
- Produces:
  - Table `api_tokens`: `id` text pk, `name` text not null, `scope` text (`'read'|'admin'`) not null, `token_hash` text unique not null, `prefix` text not null, `created_at` int not null, `last_used_at` int null.
  - `src/lib/api-tokens.ts`: `newApiToken(): string` (`eb_` + 32 random bytes base64url), `hashToken(t: string): Promise<string>` (hex SHA-256), `tokenPrefix(t) = t.slice(0, 10)`, `looksLikeToken(t): boolean` (`^eb_[A-Za-z0-9_-]{43}$`).
  - `requireAdmin`: `Authorization: Bearer <t>` (if present, the cookie is ignored) → malformed/unknown → 401 `unauthorized`; `read` scope and method not GET/HEAD → 403 `insufficient_scope`; Bearer on `/api/admin/tokens*` → 403 `session_required`; valid → `lastUsedAt` conditional update (`WHERE id = ? AND (last_used_at IS NULL OR last_used_at < now - 600000)`) in `executionCtx.waitUntil`. Cookie path unchanged (Origin check stays).
  - Token endpoints per the endpoint table; list ordered `created_at DESC`; never returns `token_hash`.
  - `GET /export` → `ExportFile` (settings, groups by sort, monitors by sort with `group` = group slug; fields normalised through `monitorInput` so a re-import round-trips; no `id`, `heartbeatToken`, `beatUrl`, `createdAt`, `updatedAt`).
  - `POST /import?prune=true&dryRun=true` — validate the whole file with a Zod schema built from `monitorInput` (`edgebeat: z.literal(1)`, slugs unique within the file, every `group` slug present in `groups` or already in D1) → 400 with `issues` paths like `["monitors", 3, "url"]`; per-monitor `assertMonitorUrl` → 400 issue `invalid_url`; existing slug with different `type` → 400 issue `type is immutable`; `budgetVerdict(current, resulting)` → 409. Then one `db.batch`: settings upserts, group upserts (multi-row, `ON CONFLICT(slug) DO UPDATE`), monitor upserts (multi-row, existing rows keep `id`, `heartbeatToken`, `createdAt`; new heartbeats get `newToken()` + `heartbeats` row), and with `prune`: delete monitors (with their `events` and `daily_stats`, as DELETE does) and groups not in the file (members ungrouped first). Statements > 45 → 413 `too_large`. Paused flips via import add the same `pauseLifecycle` statements as PATCH (from `monitor-columns.ts`).

- [ ] **Step 1:** Failing tests:
  - `api-tokens.test.ts`: format, 46 chars, two tokens differ, hash is 64 hex and stable.
  - `admin-tokens.spec.ts`: create via cookie → 201 with `token` once; list has `prefix`, no `token`/hash (`token plaintext shown once`); Bearer admin token lists monitors and creates one (no Origin header needed); `read token cannot mutate` (POST → 403 `insufficient_scope`, GET → 200); `bearer cannot manage tokens` (GET/POST `/tokens` with Bearer → 403 `session_required`); revoked token → 401; garbage Bearer → 401 even with a valid cookie; 21st token → 409; `lastUsedAt` set after first use and unchanged by a second use 1 minute later (inject time via the request window or assert ≤ 1 write).
  - `admin-transfer.spec.ts`: `export contains no secrets` (no `id`, `heartbeatToken`, `beatUrl` anywhere in the JSON string); export → import into the same DB → summary all `updated`, row data unchanged, heartbeat token unchanged; import new slugs → `created`, heartbeat gets a working `/beat/` token; `import is atomic` (file with one invalid url → 400 and zero changed rows); `prune deletes only with flag` (missing slug survives without `prune`, deleted with it, its events gone); `dryRun` → same summary, zero writes; group referenced by an unknown slug → 400; type change → 400; import adding 41 one-minute monitors on free → 409; 200-monitor file → 413.
- [ ] **Step 2:** `bunx drizzle-kit generate` (expect `migrations/0001_*.sql` creating `api_tokens` only); `bun test src/lib/api-tokens.test.ts && bunx vitest run test/worker/admin-tokens.spec.ts test/worker/admin-transfer.spec.ts` → FAIL.
- [ ] **Step 3:** Implement. **Step 4:** → PASS; existing `admin.spec.ts` (cookie + Origin cases) unchanged and green; `bun run test`, `bun run typecheck` → pass.
- [ ] **Step 5:** Commit `feat(api): api tokens with bearer auth and json import/export`.

---

### Task 4: Frontend — app shell, session guard, login, first-run wizard

**Files:**
- Create/replace: `src/admin/features/shell/{AppLayout,Sidebar,TopBar,NotFoundPage}.tsx`, `src/admin/features/auth/LoginPage.tsx`, `src/admin/features/setup/{SetupPage,WizardHeader,StepWelcome,StepType,StepConfigure,StepDone}.tsx`, `src/admin/features/setup/wizard-store.ts`, `src/admin/features/setup/wizard-store.test.ts`
- Do not touch other features.

**Interfaces:**
- Consumes: hooks `use-session`, `use-monitors` (`useCreateMonitor`, `useTestCheck`), `use-settings`, `stores/ui`, `lib/api` (`setUnauthorizedHandler`), UI kit, `@shared/monitor-schema` (`slugify`, `monitorInput`), public `GET /api/v1/status` (`siteName` for the login subtitle; plain `fetch`, failure → subtitle shows host only).
- Produces: `AppLayout` (route element with `<Outlet/>`), `useWizard` store.

Behaviour:
- **Session guard (`AppLayout`):** `useSession()`; loading → full-height skeleton; 401 → `navigate("/login?next=<path>")`. Registers `setUnauthorizedHandler` → clear cache + same redirect. After session loads: if `counts.monitors + counts.heartbeats === 0 && !setupDismissed` and path is `/` → `navigate("/setup")`.
- **Sidebar** (240 px; screens 03–08): Logo lockup; nav items Overview (`LayoutGrid`), Monitors (`Activity`, count = `counts.monitors`), Heartbeats (`Timer`, count), Groups (`Folder`, count), Status page (`Globe`), Settings (`Settings`); active item `bg-surface-3` (Pego `nav-item-active`); footer `Edgebeat <version>` mono + `<Plan> plan · open source, MIT`. Below 1024 px the sidebar becomes a Radix Dialog sheet opened from a menu button in the top bar (`ui.sidebarOpen`).
- **TopBar** (64 px): site name + `location.host` mono; "View status page" secondary sm (`ExternalLink`, opens `/` in a new tab, `rel="noopener"`); "Log out" ghost (`LogOut`) → `useLogout` → `/login`.
- **LoginPage** (`jm1szg6w`, `uebbpfjy`): centered card 400 px; RHF + zod (`password` min 1); submit → `useLogin`; 401 → field error "Wrong password. Check for typos and try again." (keeps focus, selects text); 429 → "Too many attempts. Wait a minute and try again."; 500 `weak_admin_password` → form error "ADMIN_PASSWORD is too weak. Set a new secret of at least 12 characters (not change-me) in Cloudflare, then sign in."; 500 `server_misconfigured` → "ENCRYPTION_KEY is missing or invalid. Set it in Cloudflare (32 random bytes, base64)."; network → "Can't reach the Worker. Check your connection." Success → `next` param (only same-app paths starting with `/`) or `/`. Helper "The ADMIN_PASSWORD you set during install." and footer "Forgot it? Set a new ADMIN_PASSWORD secret in your Cloudflare dashboard, then sign in again." Autofocus, `autocomplete="current-password"`. Already signed in → redirect `/`.
- **Wizard** (`SetupPage`, screens 02a–02d): own header (Logo + "Step N of 4" + 4 segment progress), no sidebar; state in `useWizard` (Zustand, not persisted): `{ step: 1|2|3|4, type: MonitorType, draft: WizardDraft, created: Monitor | null, check: TestCheckResult | null }`.
  - Step 1 welcome: `welcome` illustration, "Let's add your first monitor", copy from design; "Skip for now" ghost → `dismissSetup()` + `/monitors`; "Start setup" → step 2.
  - Step 2 pick type: `RadioCards` 3 columns — Website (HTTP) `Globe`, Server port (TCP) `Server`, Cron job (Heartbeat) `Timer` — copy from design; Back / Continue.
  - Step 3 configure (http variant per `hpiw3kad`): Name (helper "Shown on your status page."), URL (mono, helper "We send a GET request and expect a status from 200 to 399."), Check every (Select of `INTERVALS`, helper "Uses 1 of your N checks per minute." from `settings.effectiveBudget`), "Check text on page" switch block (Optional badge) with "Page must contain" input and helper "Case-sensitive. Redirects are followed for this check.". TCP variant: Name, Host (mono), Port (number), Check every. Heartbeat variant: Name, Expected every (Select: 5 min, 15 min, 30 min, 1 h, 6 h, 12 h, 24 h), Grace (Select: 1, 5, 10, 30, 60 min). Submit "Add monitor" builds a `MonitorCreate` (`slug = slugify(name)`, on 409 `slug_conflict` retry once with `-2`…`-9` suffix) and validates with `monitorInput` before sending; server field errors via `fieldErrors`; `budget_exceeded` → form error with numbers.
  - Step 4 done (`wt8aab69`): http/tcp → call `useTestCheck` once; while running show "Running the first check…" with `Loader` spinner; ok → `done` illustration, "Your status page is ready", "<name> passed its first check. We'll check it every <interval> from now on.", result row (`StatePill up`, name, `182 ms · 200 OK` mono), host row with "Open status page"; failed → `error` illustration, "<name> didn't pass its first check" + `errorLabel` + "Edgebeat keeps checking. It turns Down only after <confirmations> failures in a row." Heartbeat → `heartbeat` illustration, "Now call your beat URL" + `CodeBlock` `curl -fsS <beatUrl>`. Buttons "Add another" (→ step 2, reset draft) and "Go to dashboard" (`dismissSetup()` → `/`).
- **NotFoundPage:** inside the layout, `EmptyState` "Page not found" + "Go to overview".

- [ ] **Step 1:** Failing `wizard-store.test.ts`: `toMonitorCreate(type, draft)` for each type produces input accepted by `monitorInput` (`keyword` only when the switch is on, `followRedirects` absent so the API default applies, heartbeat period/grace in seconds); `next`/`back` clamp to 1–4; `reset` keeps the chosen type when "Add another".
- [ ] **Step 2:** `bun test src/admin/features/setup` → FAIL. **Step 3:** implement all components. **Step 4:** → PASS; `tsc --noEmit -p src/admin`; `bun run build`.
- [ ] **Step 5:** Commit `feat(admin): app shell, login and first-run wizard`.

---

### Task 5: Frontend — monitors and heartbeats

**Files:**
- Create/replace: `src/admin/features/monitors/{MonitorsPage,HeartbeatsPage,MonitorTable,MonitorRowActions,MonitorsEmpty,MonitorFormPage,MonitorForm,BudgetCard,DownExplainer,MonitorDetailPage,CheckPanel,HeartbeatPanel,MonitorSummary,RecentEvents}.tsx`, `src/admin/features/monitors/{form-mapping.ts,form-mapping.test.ts,list-filter.ts,list-filter.test.ts,down-explainer.ts,down-explainer.test.ts}`

**Interfaces:**
- Consumes: `use-monitors`, `use-groups`, `use-settings`, `stores/ui` (`resetSetup`), UI kit, `@shared/monitor-schema`, `lib/format`, `lib/api` (`fieldErrors`, `isApiError`).
- Produces: `MonitorTable` (also used by `HeartbeatsPage`), `RecentEvents` (exported for reuse; Task 6 must not import it — it has its own list).

Behaviour:
- **MonitorsPage** (`urxsgxkq`): PageHeader "Monitors" + "Add monitor" primary (`Plus`). Filter `Tabs`: All, Up, Down, Degraded, Paused, Pending, Unknown with counts (from `status.state`); search input (name, slug, url, host; `Search` icon). URL params `?state=&q=&page=` keep filters on reload. Table columns: Monitor (name + mono target: url / `host:port` / `Every 24 h, 30 min grace`), Type badge (`HTTP`/`TCP`/`HEARTBEAT`), State pill, Interval (mono; heartbeat shows period), Last check (`12 s ago`; heartbeat `Beat 7 h ago` / `No beat yet`; paused `Paused <date>`), Uptime 30d (right, mono, `—`), row actions `…`. Paused rows text muted. Row click → detail. Client pagination 20 per page, footer "Showing X of Y" + Previous/Next. 0 monitors total → **MonitorsEmpty** (`0soliclh`): `empty-monitors` illustration, "No monitors yet", copy from design, "Run setup again" ghost (`resetSetup()` → `/setup`), "Add monitor" primary. Filter with no results → small empty row "No monitors match".
- **HeartbeatsPage:** same table filtered to `type === "heartbeat"`, title "Heartbeats", "Add heartbeat" → `/monitors/new?type=heartbeat`.
- **Row actions** (DropdownMenu): Open, Edit, Pause/Resume (PATCH `paused`), Copy beat URL (heartbeat), Run check now (http/tcp; toast with result), Delete (ConfirmDialog destructive "Delete <name>? Its history is deleted too. This can't be undone.").
- **MonitorFormPage** (`l8wtr2kp`; `new` and `:id/edit`): breadcrumb "Monitors / New" or "Monitors / <name> / Edit"; two columns (form 772 px, side 340 px; stacked below 1024 px). Form card sections: **Type** (Tabs HTTP / TCP / Heartbeat; create only, `?type=` preselects; edit shows a read-only badge), **Basics** (Name; Slug mono, auto from name until the user edits it, helper "Lowercase letters, numbers and dashes."; Group Select with "No group"; SwitchCards "Show on status page" / "Paused"), **Check** — http: URL (mono), Method (Select, helper "HEAD is lighter if you skip the text check."), Expected status (mono), Timeout (s) (1–30), Check every, Confirmations (1–10), Degraded after (ms, optional), Keyword + Keyword mode (Contains / Does not contain, helper "Optional. Turns on follow redirects."); tcp: Host, Port, Timeout, Check every, Confirmations, Degraded after; heartbeat: Expected every + Grace (number + unit Select minutes/hours; period ≥ 1 min), Check every, Confirmations (the tick evaluates heartbeats with `confirmations` too). **Advanced** (Collapsible, http only): headers key/value rows (add/remove), body textarea (disabled with hint for GET/HEAD), Follow redirects switch. Sticky footer: left "Fix N field(s) to save" in red when invalid, right Cancel (ghost, back) + "Save monitor" (primary, loading). Side: **BudgetCard** ("Check budget", `<used> / <budget> per minute` with `used = settings.checksPerMinute`, Meter with the new monitor as a highlighted segment, "This monitor adds at most 1 check per minute. <budget − used − 1> left after saving." — one monitor raises the peak by at most 1; the server's 409 is authoritative; heartbeats and paused monitors show "Heartbeats don't use the check budget." / "Paused monitors don't use the check budget."), **DownExplainer** (InfoCard "When is it Down?" built from the current values: status range, keyword rule, timeout, confirmations; heartbeat: "If no beat arrives within <period + grace> of the last one, <name> goes Down and your status page shows it."). Submit: map form → `MonitorCreate`/`MonitorPatch` (`form-mapping.ts`), validate with `monitorInput` (create) or merge-then-validate (edit), send; server errors → `fieldErrors` onto fields, `budget_exceeded` → footer error "Over your check budget: <after> of <budget> per minute. Raise intervals or switch to the Paid plan in Settings." Success → toast "Monitor added"/"Changes saved" → detail page. Unsaved changes + navigation → `useBlocker` confirm.
- **MonitorDetailPage:** breadcrumb ("Monitors" or "Heartbeats" / name), title + StatePill, actions Pause/Resume (secondary sm, `Pause`/`Play`), Edit (secondary sm, `Pencil`), overflow menu with Delete. Two columns like screen 06.
  - Heartbeat (`zjua5wcc`) → **HeartbeatPanel**: when `status.state === "pending"` and `lastBeatAt === null`: `heartbeat` illustration, `Loader` "Listening since <ago(createdAt)>", "Waiting for the first beat…", copy from design; poll 5 s; when the first beat arrives the card switches to "Last beat <ago> · next expected by <time>" with a toast "First beat received". **Beat URL** card: mono URL in `bg-surface-2` + Copy; divider; "Leaked it? Rotating makes a new URL. The old one stops working right away." + "Rotate token" (ConfirmDialog → `useRotateToken`). `CodeBlock` caption "Add to the end of your job", code `curl -fsS <beatUrl>`; second line hint "Report a failure: curl -fsS <beatUrl>/fail".
  - HTTP/TCP → **CheckPanel**: "Last check" card (latency `ms`, HTTP code, error label, `ago`), "Run check now" secondary sm → toast with result; **UptimeBars** card "Last 90 days" with uptime90 % from bars; **RecentEvents** card (last 20 state changes, pills from → to, `prevDurationS`, time).
  - Side: **MonitorSummary** KeyValueList (heartbeat: Expected every, Grace, Group, On status page; http: URL, Method, Expected status, Check every, Timeout, Confirmations, Group, On status page; tcp: Host, Port, …) + DownExplainer.
  - 404 → EmptyState "Monitor not found" + back to list.

- [ ] **Step 1:** Failing tests: `form-mapping.test.ts` (timeout s ↔ ms; empty optional strings → `null`; keyword off → `keyword: null`; headers rows → record, blank rows dropped; heartbeat units → seconds; edit diff sends only changed fields; every produced create input passes `monitorInput`); `list-filter.test.ts` (state tab + search across name/slug/url/host, case-insensitive; counts per state; pagination slices); `down-explainer.test.ts` (sentences for http with/without keyword, tcp, heartbeat with `1 h` + `10 min` → "1 h 10 min").
- [ ] **Step 2:** `bun test src/admin/features/monitors` → FAIL. **Step 3:** implement. **Step 4:** → PASS; `tsc --noEmit -p src/admin`; `bun run build`.
- [ ] **Step 5:** Commit `feat(admin): monitors and heartbeats list, form and detail`.

---

### Task 6: Frontend — overview, events, groups, status page, settings

**Files:**
- Create/replace: `src/admin/features/overview/{OverviewPage,TickCard,StateCounts,UsageCards,RecentChanges,AttentionCard}.tsx`, `src/admin/features/overview/{tick-status.ts,tick-status.test.ts}`, `src/admin/features/events/EventsPage.tsx`, `src/admin/features/groups/{GroupsPage,GroupDialog}.tsx`, `src/admin/features/status-page/StatusPageSettingsPage.tsx`, `src/admin/features/settings/{SettingsPage,GeneralSettingsForm,AppearanceCard,ApiTokensCard,CreateTokenDialog,BackupCard,ImportDialog}.tsx`, `src/admin/features/settings/{settings-form.ts,settings-form.test.ts,import-file.ts,import-file.test.ts}`

**Interfaces:**
- Consumes: `use-overview`, `use-events`, `use-groups`, `use-monitors`, `use-settings`, `use-session`, `use-tokens`, `use-transfer`, `stores/ui` (`theme`), UI kit, `lib/format`.

Behaviour:
- **OverviewPage** (`sv2afuvz`): PageHeader "Overview" + "Add monitor". 
  - **TickCard**: `tickStatus(overview, clientNow)` (pure, uses `overview.now` to correct client clock skew) → `running` ("Monitoring is running", mono "Last check 12 s ago · next in 48 s · cron runs every minute", `Activity` icon in up tone, side note "If checks stop for 3 minutes, this card turns grey and your public page shows Status unknown, never green."), `stale` (`z2e8zbii`: grey card, `ClockAlert` icon, "Monitoring has stopped", "Last check 7 min ago · expected every minute", side "Your public page now shows Status unknown for every monitor. Check that the Worker's cron trigger is on in Cloudflare." + "Open Worker in Cloudflare" → `https://dash.cloudflare.com/?to=/:account/workers/services/view/edgebeat` new tab), `waiting` (never ran: "Waiting for the first check", "The cron runs every minute; this updates on its own."). Re-renders every second for the countdown.
  - **StateCounts**: card "Monitors by state", 7 cells (Up, Degraded, Down, Maintenance, Paused, Pending, Unknown) with dot + label + big mono number, header right "<all> total · <checks> checks, <heartbeats> heartbeats"; each cell links to `/monitors?state=…`.
  - **UsageCards** ("Cloudflare <plan> plan usage", right "Daily counters reset at 00:00 UTC"): Checks per minute (`used / budget`, Meter accent, "<n> left. Raise it by switching to the Paid plan in Settings." / over budget: bad tone + "Over budget: <n> checks wait for the next minute. Raise intervals or switch to Paid."), D1 writes today (`compact`, Meter neutral, "On pace for about <projected> by midnight." + "(estimated)" suffix when `source === "estimate"`), Worker requests today (value + Meter, "Status page views, checks and heartbeats."; `null` → "Not tracked" + "Add CF_ACCOUNT_ID and CF_API_TOKEN (Account Analytics: Read) secrets to see this."). Paid plan with `limit: null` → number without bar.
  - **RecentChanges**: card "Recent state changes / Last 7 days", "View all" → `/events`, rows `from → to` pills, monitor name + detail line (`Down for 4 min · Timeout` from `prevDurationS` + `errorLabel(reason)`; `paused` → "Paused by admin"; `unpaused` → "Resumed"), time right mono (`12 min ago` today, `Today 02:21`, `Yesterday 18:40`, `Nov 7`). Empty → "No state changes in the last 7 days."
  - **AttentionCard**: no down/degraded/unknown → `all-good` illustration, "Nothing is down right now", "<up> monitors are up." + latest recovery sentence; tick stale → `stale` illustration + "Status unknown"; else → list of monitors currently down/degraded/unknown (pill + name, link) titled "<n> need attention".
- **EventsPage**: PageHeader "State changes"; monitor filter Select (All monitors + list); table (From → To, Monitor, Detail, Time); "Load more" button on `nextBefore`; empty state.
- **GroupsPage**: PageHeader "Groups" + "Add group"; table (Name, Slug mono, Monitors count, order ↑/↓ buttons that PATCH `sort` of the two swapped groups, actions Edit/Delete); `GroupDialog` (Name, Slug auto from name, RHF + zod `SLUG_RE`; 409 → slug error); Delete ConfirmDialog "Delete <name>? Its <n> monitors stay, without a group."; empty state "No groups yet" ("Groups list monitors together on your status page.").
- **StatusPageSettingsPage** (no design): PageHeader "Status page" + "View status page"; card "Public URL" (`origin/` mono + Copy + Open); card "What visitors see": groups in order (same ↑/↓ as Groups) and their monitors in order (↑/↓ PATCH `sort`), each monitor row with a Switch "Public" (PATCH `isPublic`) and its pill; an "Other" pseudo-group for ungrouped monitors; note "Private monitors are checked and alert as usual, but are not listed." Link "Site name is in Settings."
- **SettingsPage** (`0wb4os0c`): main card (RHF over `Settings`): **Status page** (Site name, helper), **Cloudflare plan** (RadioCards 2 cols: Free `Cloud` "Workers Free. 100k requests and 100k D1 writes a day. Checks are capped at 40 per minute." / Paid `Zap` "Workers Paid on your Cloudflare account. Higher daily limits, so you can raise the check budget."), **Check budget** (Checks per minute: Free → disabled mono input `40` with `Lock` trailing icon, helper "Locked at 40, the Free plan maximum. <used> in use right now."; Paid → number 1–10 000, empty = default 500, helper "<used> in use right now."; switching to Free while `checksPerMinute > 40` shows an inline warning). Sticky footer Discard (reset) / Save changes (PATCH only dirty fields; toast). Below, separate cards (no design, same Card style):
  - **AppearanceCard**: Tabs System / Light / Dark → `ui.setTheme`.
  - **ApiTokensCard**: table (Name, Scope badge, Prefix mono `eb_AbC1234…`, Created, Last used, Revoke); "Create token" → `CreateTokenDialog` (Name, Scope RadioCards Read "List and read everything." / Admin "Full access, including changes."); on success the dialog shows the token once in a mono field + Copy + warning "Copy it now. You won't see it again." and `Authorization: Bearer <token>` CodeBlock; Revoke ConfirmDialog. Hidden (read-only notice) when `session.auth === "token"`.
  - **BackupCard**: "Export JSON" (download; copy "Monitors, groups and settings. No secrets, no history.") and "Import JSON" (file input `.json` → `parseImportFile` → `useImport({ dryRun: true })` → `ImportDialog` summary "Creates N, updates M, deletes K" lists slugs; checkbox "Delete monitors and groups that are not in the file" (prune, re-runs dry run; destructive styling); Confirm → real import → toast). Validation errors listed with their paths.

- [ ] **Step 1:** Failing tests: `tick-status.test.ts` (`waiting` when `lastTickAt null`; `running` with skew-corrected `secondsAgo`/`nextInS`; `stale` exactly when `> 180 000 ms`, matching `TICK_STALE_MS`); `settings-form.test.ts` (free plan sends no `checkBudget`; paid empty → `null`; only dirty fields sent; over-budget warning predicate); `import-file.test.ts` (rejects non-JSON, wrong `edgebeat` version, missing arrays with readable messages; accepts an `ExportFile` fixture).
- [ ] **Step 2:** `bun test src/admin/features/{overview,settings}` → FAIL. **Step 3:** implement. **Step 4:** → PASS; `tsc --noEmit -p src/admin`; `bun run build`.
- [ ] **Step 5:** Commit `feat(admin): overview, events, groups, status page and settings`.

---

### Task 7: Integration, browser verification, docs

**Files:**
- Modify: only files needed to fix seams found here (report anything outside), `README.md` (Admin section), `docs/superpowers/specs/2026-11-09-edgebeat-design.md` (§14 amendments), `docs/superpowers/plans/2026-11-09-edgebeat-plan-3-admin.md` (status line)
- Create: `docs/superpowers/plans/plan-3-design/built/*.png` (screenshots of the built screens)

- [ ] **Step 1:** `bun install && bun run typecheck && bun run test` → all green (root bun tests incl. `src/admin`, `src/shared`, vitest pool, `cli`).
- [ ] **Step 2:** Local run: `.dev.vars` with a strong `ADMIN_PASSWORD` and an `ENCRYPTION_KEY`; `bun run dev`; open `http://localhost:8787/admin` with the `agent-browser` skill (Chrome; Safari rejects `Secure` cookies on http localhost). Walk the whole flow: login wrong → error copy; login → wizard; skip → empty monitors; run setup again → http monitor `https://example.com` with keyword → done screen shows the first check; trigger the cron (`curl "http://localhost:8787/cdn-cgi/handler/scheduled"`) → overview "Monitoring is running", counts, recent changes; add tcp `1.1.1.1:443` and a heartbeat → heartbeat detail waiting → `curl -fsS <beatUrl>` → detail flips within 5 s; form errors: `http://10.0.0.1` shows the private-address error, slug conflict on the slug field; budget: set plan Free, create 41 one-minute monitors via `POST /api/admin/import` → 409 shown in the import dialog; groups CRUD and order reflect on `/`; status page visibility switch hides a monitor on `/`; settings plan/budget save; theme toggle; API token create → `curl -H "Authorization: Bearer …" /api/admin/monitors` works, POST with a read token → 403; export → import dry run → import; stop triggering the cron for 4 minutes → stale tick card; log out → protected routes redirect to login; deep link reload on `/admin/monitors/<id>` works.
- [ ] **Step 3:** Screenshot each built screen (light 1440×900, plus dark for Overview/Monitors/Form/Detail and mobile 390×844 for Overview/Monitors/Form) into `plan-3-design/built/`; compare side by side with the Pego exports; fix visible spacing/color/typography drift in the owning files.
- [ ] **Step 4:** Bundle and CLI: `cd cli && bun run bundle` → `bundle/assets/admin/index.html` exists and `manifest.json` `run_worker_first` lists `/admin` and `/admin/*`; `bun --cwd cli test` green.
- [ ] **Step 5:** README "Admin" section: URL `/admin`, first-run wizard, password rule and how to reset it (set a new `ADMIN_PASSWORD` secret), recommend Cloudflare Access in front of `/admin`, API tokens (`Authorization: Bearer`, read vs admin), import/export (merge, `?prune=true`, `?dryRun=true`, no secrets), optional `CF_ACCOUNT_ID` + `CF_API_TOKEN` (Account Analytics: Read) for real usage numbers. Replace the curl-only admin instructions with a short "Admin API" reference.
- [ ] **Step 6:** Spec §14 amendments: budget guard refuses saves above the check budget (Settings design); D1 writes/requests source (GraphQL optional, estimate otherwise; no per-request counter writes); `snapshot.current` carries `code`/`error`; admin served via `run_worker_first` `/admin*` with SPA fallback and CSP; test check endpoint (admin only, no writes); API tokens hashed, Bearer skips Origin check, read scope GET only. Plan status line → done.
- [ ] **Step 7:** Final `bun run typecheck && bun run test`; commit `docs: admin guide and spec amendments for plan 3`.

---

## Decisions made on the owner's behalf

1. **Scope = the admin design + spec §9 items whose backend can exist now.** Incidents, maintenance and alert channels are not in the admin design and have no backend (Plans 2 and 4); they get no nav items yet. API tokens and import/export (Plan 3 per the Plan 1 roadmap) live as cards in Settings, built from Design-system components.
2. **Routing:** react-router 7 (declarative). **Fonts:** self-hosted Geist / Geist Mono via `@fontsource-variable/*` (CSP `font-src 'self'`, no Google Fonts).
3. **Serving:** `/admin` and `/admin/*` run the Worker first (passthrough for files, SPA fallback with security headers). Costs a few Worker requests per admin page load; acceptable for a single-admin tool and keeps deep links and CSP correct. Assets stay in `dist/status-page/` (admin under `admin/`) so the CLI bundle layout does not change.
4. **Shared code:** `src/shared/monitor-schema.ts` is the single Zod source for Worker and form; `src/shared/admin-api.ts` holds the contracts.
5. **Budget guard** is enforced server-side (Settings copy "can't be saved"), measured as the exact per-minute peak from slot hashing, and never blocks edits that do not raise the peak.
6. **Usage numbers:** real data only through optional GraphQL secrets; otherwise a labelled estimate for writes and "Not tracked" for requests. No per-request counter (it would spend the D1 write budget it reports on).
7. **First check on the done screen** = new admin-only `POST /monitors/:id/check`, no writes; the tick stays the only source of state.
8. **Wizard dismissal** stored in the browser (Zustand persist), not in D1; the empty state offers "Run setup again".
9. **Not-designed screens** (HTTP/TCP detail, Groups, Status page, Events, Heartbeats list, Settings extras) reuse the layout of screens 04–06 and 08.
10. **Dark mode** (system/light/dark toggle in Settings) from the Pego dark tokens; **mobile**: sidebar becomes a sheet below 1024 px, form columns stack. Not designed in Pego, verified by screenshots in Task 7.
11. **Status page keeps its own CSS** in Plan 3; `src/shared/tokens.css` is ready for Plan 4 to move it onto the same tokens.
12. **No component/DOM tests and no Playwright dependency:** pure logic gets `bun test`; screens are verified in a real browser in Task 7.
13. **Pagination is client-side** (20 rows); one admin, tens of monitors.

## Conflicts between spec/design and existing code

- **Status page tokens differ from the design system:** `src/status-page/style.css` uses a slate palette and `system-ui`; Pego uses violet accent, neutral greys and Geist. Not unified in Plan 3 (decision 11).
- **Budget:** existing API accepts any monitor and carries overflow to the next tick; the Settings design says over-budget monitors "can't be saved" → new 409 guard (Task 2/3), spec amended.
- **Overview usage cards** need D1 writes and requests per day; the Worker has no such data, and spec §6.5's "counts invocations itself" would cost D1 writes → optional GraphQL + estimate.
- **Overview event detail** shows "503 Service Unavailable"; `events.reason` stores only the error class → shown as "Timeout"/"Wrong status" etc.; `snapshot.current` gains `code`/`error` so current status can show the HTTP code.
- **Done screen "passed its first check"**: only the cron checks today → new test-check endpoint.
- **Monitors list** (state, last check, uptime 30d) and **heartbeat detail** (last beat) need data the admin API did not return → `status` added to monitor responses.
- **Assets config:** `run_worker_first` was `/api/*`, `/beat/*` and there was no SPA fallback, so `/admin/...` deep links would 404 → `/admin*` added; CLI bundle and e2e tests assert the exact list and are updated in Task 0.
- **Design system nav sample shows "Incidents"**, the admin screens do not; followed the admin screens.
- **Login subtitle** needs the site name before sign-in; read from the public `/api/v1/status` (already public).
- **Welcome and heartbeat-detail images are empty placeholders in Pego**; `welcome.png` and `heartbeat.png` from the illustration set are used.
- **Heartbeat "When is it Down?"** copy in screen 06 ("If no beat arrives within 1 h 10 min … goes Down") ignores `confirmations`, but the tick applies confirmations to heartbeats too (Down after N late evaluations at `intervalMin`). The explainer states the real rule.
- Version text in the design ("0.4.0") vs package `0.1.0`: the sidebar shows the real `VERSION`.
