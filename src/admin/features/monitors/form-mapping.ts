import { monitorInput, slugify, INTERVALS } from "@shared/monitor-schema";
import type { Monitor, MonitorCreate, MonitorPatch } from "@shared/admin-api";
import type { KeywordMode, MonitorType } from "../../../core/types";

export type TimeUnit = "min" | "h";
export type HeaderRow = { key: string; value: string };

/** Form state. Numbers are strings so inputs stay editable; units are UI units (s, min, h). */
export type FormValues = {
  type: MonitorType;
  name: string;
  slug: string;
  groupId: string; // "" = no group
  isPublic: boolean;
  paused: boolean;
  url: string;
  method: string;
  expectedStatus: string;
  timeoutS: string;
  intervalMin: string;
  confirmations: string;
  degradedMs: string;
  keyword: string;
  keywordMode: KeywordMode;
  host: string;
  port: string;
  periodValue: string;
  periodUnit: TimeUnit;
  graceValue: string;
  graceUnit: TimeUnit;
  headers: HeaderRow[];
  body: string;
  followRedirects: boolean;
};

export const DEFAULT_VALUES: FormValues = {
  type: "http",
  name: "",
  slug: "",
  groupId: "",
  isPublic: true,
  paused: false,
  url: "",
  method: "GET",
  expectedStatus: "200-399",
  timeoutS: "10",
  intervalMin: "1",
  confirmations: "2",
  degradedMs: "",
  keyword: "",
  keywordMode: "contains",
  host: "",
  port: "",
  periodValue: "1",
  periodUnit: "h",
  graceValue: "10",
  graceUnit: "min",
  headers: [],
  body: "",
  followRedirects: false,
};

export const INTERVAL_OPTIONS = INTERVALS.map((n) => ({ value: String(n), label: n === 60 ? "1 hour" : n === 1 ? "1 minute" : `${n} minutes` }));

const UNIT_S: Record<TimeUnit, number> = { min: 60, h: 3600 };

const num = (s: string): number | undefined => {
  const t = s.trim();
  return t === "" ? undefined : Number(t);
};
const text = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Seconds → value + unit for the UI (hours when evenly divisible, else minutes). */
export const splitPeriod = (s: number): { value: string; unit: TimeUnit } =>
  s >= 3600 && s % 3600 === 0 ? { value: String(s / 3600), unit: "h" } : { value: String(+(s / 60).toFixed(2)), unit: "min" };

export const headersToRecord = (rows: HeaderRow[]): Record<string, string> =>
  Object.fromEntries(rows.map((r) => [r.key.trim(), r.value] as const).filter(([k]) => k !== ""));

const HAS_NO_BODY = new Set(["GET", "HEAD"]);

/** Form values → API create input. Only fields that belong to the chosen type are included. */
export const toCreate = (v: FormValues): MonitorCreate => {
  const base: MonitorCreate = {
    type: v.type,
    name: v.name.trim(),
    slug: v.slug.trim(),
    groupId: v.groupId === "" ? null : v.groupId,
    isPublic: v.isPublic,
    paused: v.paused,
    intervalMin: num(v.intervalMin),
    confirmations: num(v.confirmations),
  };
  if (v.type === "heartbeat") {
    const period = num(v.periodValue);
    const grace = num(v.graceValue);
    return {
      ...base,
      heartbeatPeriodS: period === undefined ? undefined : Math.round(period * UNIT_S[v.periodUnit]),
      heartbeatGraceS: grace === undefined ? undefined : Math.round(grace * UNIT_S[v.graceUnit]),
    };
  }
  const timeout = num(v.timeoutS);
  const common = {
    ...base,
    timeoutMs: timeout === undefined ? undefined : Math.round(timeout * 1000),
    degradedThresholdMs: num(v.degradedMs) ?? null,
  };
  if (v.type === "tcp") return { ...common, host: text(v.host), port: num(v.port) ?? null };
  return {
    ...common,
    url: text(v.url),
    method: v.method as MonitorCreate["method"],
    expectedStatus: text(v.expectedStatus) ?? undefined,
    keyword: v.keyword === "" ? null : v.keyword,
    keywordMode: v.keywordMode,
    headers: headersToRecord(v.headers),
    body: HAS_NO_BODY.has(v.method) ? null : (v.body === "" ? null : v.body),
    followRedirects: v.followRedirects,
  };
};

/** Existing monitor → form values. */
export const fromMonitor = (m: Monitor): FormValues => {
  const period = splitPeriod(m.heartbeatPeriodS ?? 3600);
  const grace = splitPeriod(m.heartbeatGraceS ?? 600);
  return {
    ...DEFAULT_VALUES,
    type: m.type,
    name: m.name,
    slug: m.slug,
    groupId: m.groupId ?? "",
    isPublic: m.isPublic,
    paused: m.paused,
    url: m.url ?? "",
    method: m.method,
    expectedStatus: m.expectedStatus,
    timeoutS: String(m.timeoutMs / 1000),
    intervalMin: String(m.intervalMin),
    confirmations: String(m.confirmations),
    degradedMs: m.degradedThresholdMs == null ? "" : String(m.degradedThresholdMs),
    keyword: m.keyword ?? "",
    keywordMode: m.keywordMode,
    host: m.host ?? "",
    port: m.port == null ? "" : String(m.port),
    periodValue: period.value,
    periodUnit: period.unit,
    graceValue: grace.value,
    graceUnit: grace.unit,
    headers: Object.entries(m.headers).map(([key, value]) => ({ key, value })),
    body: m.body ?? "",
    followRedirects: m.followRedirects,
  };
};

/** Only the fields whose value differs between the saved monitor and the form. */
export const toPatch = (current: FormValues, saved: Monitor): MonitorPatch => {
  const next = toCreate(current) as Record<string, unknown>;
  const prev = toCreate(fromMonitor(saved)) as Record<string, unknown>;
  const changed = Object.keys(next).filter((k) => k !== "type" && JSON.stringify(next[k]) !== JSON.stringify(prev[k]));
  return Object.fromEntries(changed.map((k) => [k, next[k]])) as MonitorPatch;
};

/** API field name → form field name. */
const FORM_FIELD: Record<string, string> = {
  timeoutMs: "timeoutS",
  degradedThresholdMs: "degradedMs",
  heartbeatPeriodS: "periodValue",
  heartbeatGraceS: "graceValue",
};
export const formField = (apiPath: string): string => {
  const head = apiPath.split(".")[0] ?? apiPath;
  return FORM_FIELD[head] ?? head;
};

const messageFor = (path: string, raw: string): string => {
  if (/^Too small: expected string/.test(raw)) return "Required";
  if (/expected number/.test(raw) && !/Too (small|big)/.test(raw)) return "Enter a number";
  if (/is required/.test(raw)) return "Required";
  const min = /Too small: expected number to be >=(\d+)/.exec(raw);
  if (min) return path === "heartbeatPeriodS" ? "At least 1 minute" : `Must be at least ${min[1]}`;
  const max = /Too big: expected number to be <=(\d+)/.exec(raw);
  if (max) return path === "timeoutMs" ? "Up to 30 seconds" : `Must be at most ${max[1]}`;
  if (/Invalid string: must match pattern/.test(raw)) {
    if (path === "slug") return "Lowercase letters, numbers and dashes, up to 64.";
    if (path === "expectedStatus") return "Use codes or ranges like 200-399, 404.";
  }
  return raw;
};

const REQUIRED: Record<MonitorType, (keyof FormValues)[]> = {
  http: ["name", "slug", "url", "timeoutS", "confirmations"],
  tcp: ["name", "slug", "host", "port", "timeoutS", "confirmations"],
  heartbeat: ["name", "slug", "periodValue", "graceValue", "confirmations"],
};

/** Validates with the shared monitor schema; returns `{ formField: message }` (empty = valid). */
export const validateForm = (v: FormValues): Record<string, string> => {
  const errors: Record<string, string> = {};
  for (const k of REQUIRED[v.type]) if (String(v[k]).trim() === "") errors[k] = "Required";
  const parsed = monitorInput.safeParse(toCreate(v));
  if (parsed.success) return errors;
  for (const issue of parsed.error.issues) {
    const path = issue.path.join(".");
    const field = formField(path);
    if (!(field in errors)) errors[field] = messageFor(path.split(".")[0] ?? path, issue.message);
  }
  return errors;
};

export { slugify };
