import { format } from "date-fns";
import type { ErrorClass } from "../../core/types";
import type { AdminState } from "@shared/admin-api";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** "12 s ago" | "3 min ago" | "7 h ago" | "Nov 7" */
export const ago = (at: number, now: number): string => {
  const d = Math.max(0, now - at);
  if (d < MIN) return `${Math.floor(d / 1000)} s ago`;
  if (d < HOUR) return `${Math.floor(d / MIN)} min ago`;
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`;
  return format(new Date(at), "MMM d");
};

/** Seconds → "4 min" | "1 h 10 min" | "2 d 3 h" */
export const duration = (s: number): string => {
  const total = Math.max(0, Math.round(s));
  if (total < 60) return `${total} s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours} h ${mins % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
};

/** Minutes → "1 min" | "24 h" */
export const intervalLabel = (min: number): string =>
  min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`;

/** Seconds → "5 min" | "24 h" | "90 s" */
export const periodLabel = (s: number): string => {
  if (s >= 3600 && s % 3600 === 0) return `${s / 3600} h`;
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
};

/** 0..1 → "99.98%" | "100%" | "—" */
export const pct = (uptime: number | null): string => {
  if (uptime == null) return "—";
  if (uptime >= 1) return "100%";
  // never round a non-perfect value up to 100
  const v = Math.min(99.99, Math.floor(uptime * 10_000) / 100);
  return `${v.toFixed(2)}%`;
};

export const ms = (n: number): string => `${Math.round(n)} ms`;

/** 6200 → "6.2k" */
export const compact = (n: number): string => {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${+(n / 1000).toFixed(1)}k`;
  return `${+(n / 1_000_000).toFixed(1)}M`;
};

const ERROR_LABELS: Record<ErrorClass, string> = {
  timeout: "Timeout",
  dns: "DNS error",
  connect: "Connection failed",
  tls: "TLS error",
  status: "Wrong status",
  keyword: "Keyword rule failed",
  heartbeat_late: "Heartbeat late",
  heartbeat_fail: "Job reported failure",
  other: "Error",
};
export const errorLabel = (e: ErrorClass): string => ERROR_LABELS[e];

const STATE_LABELS: Record<AdminState, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  maintenance: "Maintenance",
  paused: "Paused",
  pending: "Pending",
  unknown: "Unknown",
};
export const stateLabel = (s: AdminState): string => STATE_LABELS[s];
