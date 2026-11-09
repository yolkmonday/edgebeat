import { describe, expect, test } from "bun:test";
import { monitorInput } from "@shared/monitor-schema";
import type { Monitor } from "@shared/admin-api";
import { DEFAULT_VALUES, fromMonitor, headersToRecord, splitPeriod, toCreate, toPatch, validateForm, type FormValues } from "./form-mapping";

const http: FormValues = { ...DEFAULT_VALUES, name: "Acme API", slug: "acme-api", url: "https://api.acme.dev/health" };
const tcp: FormValues = { ...DEFAULT_VALUES, type: "tcp", name: "Mail", slug: "mail", host: "mail.acme.dev", port: "587" };
const beat: FormValues = { ...DEFAULT_VALUES, type: "heartbeat", name: "Backup", slug: "backup", periodValue: "24", periodUnit: "h", graceValue: "30", graceUnit: "min" };

const saved = (over: Partial<Monitor> = {}): Monitor => ({
  id: "m1", slug: "acme-api", name: "Acme API", type: "http", groupId: null,
  url: "https://api.acme.dev/health", method: "GET", headers: {}, body: null,
  expectedStatus: "200-399", timeoutMs: 10_000, followRedirects: false,
  keyword: null, keywordMode: "contains", host: null, port: null,
  intervalMin: 1, confirmations: 2, degradedThresholdMs: null,
  heartbeatPeriodS: null, heartbeatGraceS: null,
  isPublic: true, paused: false, sort: 0, createdAt: 0, updatedAt: 0,
  status: { state: "up", lastCheckedAt: null, latencyMs: null, code: null, error: null, lastBeatAt: null, uptime30: null },
  ...over,
});

describe("toCreate", () => {
  test("timeout seconds become milliseconds", () => {
    expect(toCreate({ ...http, timeoutS: "10" })).toMatchObject({ timeoutMs: 10_000 });
    expect(toCreate({ ...http, timeoutS: "0.5" })).toMatchObject({ timeoutMs: 500 });
  });

  test("empty optional strings become null", () => {
    const out = toCreate({ ...http, degradedMs: "", keyword: "", body: "", groupId: "" });
    expect(out).toMatchObject({ degradedThresholdMs: null, keyword: null, body: null, groupId: null });
  });

  test("keyword off sends null, keyword on keeps the text and mode", () => {
    expect(toCreate({ ...http, keyword: "" }).keyword).toBeNull();
    expect(toCreate({ ...http, keyword: "ok", keywordMode: "not_contains" })).toMatchObject({ keyword: "ok", keywordMode: "not_contains" });
  });

  test("header rows become a record and blank rows are dropped", () => {
    const rows = [{ key: " X-Token ", value: "abc" }, { key: "", value: "x" }, { key: "  ", value: "" }];
    expect(headersToRecord(rows)).toEqual({ "X-Token": "abc" });
    expect(toCreate({ ...http, headers: rows }).headers).toEqual({ "X-Token": "abc" });
  });

  test("GET and HEAD never send a body", () => {
    expect(toCreate({ ...http, method: "GET", body: "x" }).body).toBeNull();
    expect(toCreate({ ...http, method: "POST", body: "x" }).body).toBe("x");
  });

  test("heartbeat units become seconds", () => {
    expect(toCreate(beat)).toMatchObject({ heartbeatPeriodS: 86_400, heartbeatGraceS: 1800 });
    expect(toCreate({ ...beat, periodValue: "5", periodUnit: "min", graceValue: "1", graceUnit: "h" })).toMatchObject({
      heartbeatPeriodS: 300,
      heartbeatGraceS: 3600,
    });
  });

  test("only type-specific fields are sent", () => {
    expect(toCreate(tcp)).not.toHaveProperty("url");
    expect(toCreate(beat)).not.toHaveProperty("timeoutMs");
    expect(toCreate(http)).not.toHaveProperty("host");
  });

  test("every produced create input passes monitorInput", () => {
    for (const v of [http, tcp, beat, { ...http, method: "POST", body: "{}", keyword: "ok", degradedMs: "1000" }]) {
      expect(monitorInput.safeParse(toCreate(v)).success).toBe(true);
    }
  });
});

describe("validateForm", () => {
  test("valid forms have no errors", () => {
    expect(validateForm(http)).toEqual({});
    expect(validateForm(tcp)).toEqual({});
    expect(validateForm(beat)).toEqual({});
  });

  test("maps schema errors onto form field names", () => {
    expect(validateForm({ ...http, timeoutS: "60" })).toHaveProperty("timeoutS");
    expect(validateForm({ ...tcp, port: "25" })).toHaveProperty("port");
    expect(validateForm({ ...beat, periodValue: "10", periodUnit: "min", graceValue: "x" }).graceValue).toBeDefined();
    expect(validateForm({ ...beat, periodValue: "30", periodUnit: "min", graceValue: "0" })).toEqual({});
    expect(validateForm({ ...http, method: "HEAD", keyword: "ok" })).toHaveProperty("keyword");
  });

  test("required fields and slug", () => {
    expect(validateForm({ ...http, name: "", slug: "Bad Slug", url: "" })).toEqual({
      name: "Required",
      url: "Required",
      slug: "Lowercase letters, numbers and dashes, up to 64.",
    });
  });
});

describe("edit", () => {
  test("round trip: unchanged form yields an empty patch", () => {
    for (const m of [
      saved(),
      saved({ type: "tcp", url: null, host: "h.dev", port: 22, slug: "h" }),
      saved({ type: "heartbeat", url: null, heartbeatPeriodS: 86_400, heartbeatGraceS: 1800 }),
      saved({ headers: { A: "1" }, keyword: "ok", degradedThresholdMs: 500 }),
    ]) {
      expect(toPatch(fromMonitor(m), m)).toEqual({});
    }
  });

  test("patch carries only changed fields", () => {
    const m = saved();
    const patch = toPatch({ ...fromMonitor(m), name: "Renamed", timeoutS: "5", paused: true }, m);
    expect(patch).toEqual({ name: "Renamed", timeoutMs: 5000, paused: true });
  });

  test("heartbeat period split picks hours when even", () => {
    expect(splitPeriod(86_400)).toEqual({ value: "24", unit: "h" });
    expect(splitPeriod(5400)).toEqual({ value: "90", unit: "min" });
    expect(splitPeriod(0)).toEqual({ value: "0", unit: "min" });
  });
});
