import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import type { KeywordMode, MonitorState, MonitorType } from "../core/types";

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const monitors = sqliteTable("monitors", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: text("type").$type<MonitorType>().notNull(),
  groupId: text("group_id").references(() => groups.id),
  url: text("url"),
  method: text("method").notNull().default("GET"),
  headers: text("headers").notNull().default("{}"),
  body: text("body"),
  expectedStatus: text("expected_status").notNull().default("200-399"),
  timeoutMs: integer("timeout_ms").notNull().default(10000),
  followRedirects: integer("follow_redirects").notNull().default(1),
  keyword: text("keyword"),
  keywordMode: text("keyword_mode").$type<KeywordMode>().notNull().default("contains"),
  host: text("host"),
  port: integer("port"),
  intervalMin: integer("interval_min").notNull().default(1),
  confirmations: integer("confirmations").notNull().default(2),
  degradedThresholdMs: integer("degraded_threshold_ms"),
  heartbeatPeriodS: integer("heartbeat_period_s"),
  heartbeatGraceS: integer("heartbeat_grace_s"),
  heartbeatToken: text("heartbeat_token").unique(),
  isPublic: integer("is_public").notNull().default(1),
  paused: integer("paused").notNull().default(0),
  sort: integer("sort").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const monitorState = sqliteTable("monitor_state", {
  monitorId: text("monitor_id")
    .primaryKey()
    .references(() => monitors.id, { onDelete: "cascade" }),
  state: text("state").$type<MonitorState>().notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastChangeAt: integer("last_change_at").notNull(),
});

export const ticks = sqliteTable("ticks", {
  minute: integer("minute").primaryKey(),
  at: integer("at").notNull(),
  results: text("results").notNull(),
});

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monitorId: text("monitor_id").notNull(),
    fromState: text("from_state").$type<MonitorState>().notNull(),
    toState: text("to_state").$type<MonitorState>().notNull(),
    at: integer("at").notNull(),
    reason: text("reason").notNull(),
  },
  (t) => [index("events_monitor_at_idx").on(t.monitorId, t.at), index("events_at_idx").on(t.at)],
);

export const heartbeats = sqliteTable("heartbeats", {
  monitorId: text("monitor_id")
    .primaryKey()
    .references(() => monitors.id, { onDelete: "cascade" }),
  lastBeatAt: integer("last_beat_at"),
  lastFailAt: integer("last_fail_at"),
});

export const dailyStats = sqliteTable(
  "daily_stats",
  {
    monitorId: text("monitor_id").notNull(),
    day: text("day").notNull(),
    checks: integer("checks").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    downtimeS: integer("downtime_s").notNull().default(0),
    observedS: integer("observed_s").notNull().default(0),
    hist: text("hist").notNull().default("[]"),
  },
  (t) => [primaryKey({ columns: [t.monitorId, t.day] })],
);

export const snapshot = sqliteTable("snapshot", {
  id: integer("id").primaryKey(),
  lastTickAt: integer("last_tick_at").notNull(),
  lockUntil: integer("lock_until").notNull().default(0),
  current: text("current").notNull(),
  bars: text("bars").notNull(),
  carry: text("carry").notNull().default("[]"),
  lastRollupMinute: integer("last_rollup_minute").notNull().default(0),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  scope: text("scope").$type<"read" | "admin">().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  createdAt: integer("created_at").notNull(),
  lastUsedAt: integer("last_used_at"),
});
