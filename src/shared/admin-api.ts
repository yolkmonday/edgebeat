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
    analytics: "ok" | "failed" | "off";                // off = no CF_* credentials, failed = query errored (values fall back to estimate)
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
