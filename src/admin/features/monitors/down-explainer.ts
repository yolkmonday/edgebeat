import type { Monitor } from "@shared/admin-api";
import type { MonitorType } from "../../../core/types";
import type { FormValues } from "@/features/monitors/form-mapping";
import { duration, intervalLabel } from "@/lib/format";

export type ExplainInput = {
  type: MonitorType;
  name?: string;
  expectedStatus?: string;
  keyword?: string | null;
  keywordMode?: "contains" | "not_contains";
  host?: string | null;
  port?: number | null;
  timeoutS?: number | null;
  confirmations: number;
  intervalMin: number;
  periodS?: number | null;
  graceS?: number | null;
};

const repeat = (n: number) =>
  n <= 1 ? "One failed check marks it Down right away." : `After ${n} failures in a row we mark it Down, so a single blip doesn't count.`;

/** Plain-language "When is it Down?" built from the current settings. */
export const explainDown = (m: ExplainInput): string => {
  const timeout = m.timeoutS ? ` within ${+m.timeoutS.toFixed(1)} s` : " within the timeout";
  if (m.type === "heartbeat") {
    const name = m.name?.trim() || "this heartbeat";
    const window = duration((m.periodS ?? 0) + (m.graceS ?? 0));
    const late =
      m.confirmations > 1
        ? ` We look for late beats every ${intervalLabel(m.intervalMin)} and need ${m.confirmations} late checks in a row.`
        : "";
    return `If no beat arrives within ${window} of the last one, ${name} goes Down and your status page shows it.${late}`;
  }
  if (m.type === "tcp") {
    const target = m.host ? `${m.host}${m.port ? `:${m.port}` : ""}` : "the port";
    return `A check fails when ${target} doesn't accept a connection${timeout}. ${repeat(m.confirmations)}`;
  }
  const status = m.expectedStatus?.trim() ? `outside ${m.expectedStatus.trim()}` : "outside the expected range";
  const keyword = m.keyword
    ? m.keywordMode === "not_contains"
      ? `, "${m.keyword}" shows up in the response`
      : `, "${m.keyword}" is missing from the response`
    : "";
  return `A check fails when the status is ${status}${keyword}, or there is no answer${timeout}. ${repeat(m.confirmations)}`;
};

export const explainInputFromMonitor = (m: Monitor): ExplainInput => ({
  type: m.type,
  name: m.name,
  expectedStatus: m.expectedStatus,
  keyword: m.keyword,
  keywordMode: m.keywordMode,
  host: m.host,
  port: m.port,
  timeoutS: m.timeoutMs / 1000,
  confirmations: m.confirmations,
  intervalMin: m.intervalMin,
  periodS: m.heartbeatPeriodS,
  graceS: m.heartbeatGraceS,
});

const unitS = (n: number, unit: "min" | "h") => (Number.isFinite(n) ? n * (unit === "h" ? 3600 : 60) : null);

export const explainInputFromForm = (v: FormValues): ExplainInput => ({
  type: v.type,
  name: v.name,
  expectedStatus: v.expectedStatus,
  keyword: v.keyword || null,
  keywordMode: v.keywordMode,
  host: v.host.trim() || null,
  port: Number(v.port) || null,
  timeoutS: Number(v.timeoutS) || null,
  confirmations: Number(v.confirmations) || 1,
  intervalMin: Number(v.intervalMin) || 1,
  periodS: unitS(Number(v.periodValue), v.periodUnit),
  graceS: unitS(Number(v.graceValue), v.graceUnit),
});
