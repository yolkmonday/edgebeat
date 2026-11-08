export type MonitorType = "http" | "tcp" | "heartbeat";
export type KeywordMode = "contains" | "not_contains";
export type MonitorState = "pending" | "up" | "degraded" | "down" | "maintenance" | "paused";

export type ErrorClass =
  | "timeout"
  | "dns"
  | "connect"
  | "tls"
  | "status"
  | "keyword"
  | "heartbeat_late"
  | "heartbeat_fail"
  | "other";

export type CheckResult = {
  monitorId: string;
  ok: boolean;
  latencyMs: number | null;
  code: number | null;
  error: ErrorClass | null;
};

export type SchedMonitor = {
  id: string;
  intervalMin: number;
  type: MonitorType;
};

export type CurrentEntry = { state: MonitorState; lastCheckedAt: number | null; latencyMs: number | null };
