import { describe, expect, test } from "bun:test";
import { ago, compact, duration, errorLabel, intervalLabel, ms, pct, periodLabel, stateLabel } from "./format";

const NOW = new Date("2026-11-09T12:00:00Z").getTime();

describe("ago", () => {
  test("seconds", () => expect(ago(NOW - 12_000, NOW)).toBe("12 s ago"));
  test("minutes", () => expect(ago(NOW - 3 * 60_000, NOW)).toBe("3 min ago"));
  test("hours", () => expect(ago(NOW - 7 * 3_600_000, NOW)).toBe("7 h ago"));
  test("older than a day", () => expect(ago(new Date("2026-11-07T10:00:00Z").getTime(), NOW)).toBe("Nov 7"));
  test("future clamps to 0", () => expect(ago(NOW + 5000, NOW)).toBe("0 s ago"));
});

describe("duration", () => {
  test("seconds", () => expect(duration(45)).toBe("45 s"));
  test("minutes", () => expect(duration(240)).toBe("4 min"));
  test("hours and minutes", () => expect(duration(4200)).toBe("1 h 10 min"));
  test("whole hours", () => expect(duration(7200)).toBe("2 h"));
  test("days and hours", () => expect(duration(2 * 86_400 + 3 * 3600)).toBe("2 d 3 h"));
  test("whole days", () => expect(duration(86_400)).toBe("1 d"));
});

describe("labels", () => {
  test("intervalLabel", () => {
    expect(intervalLabel(1)).toBe("1 min");
    expect(intervalLabel(30)).toBe("30 min");
    expect(intervalLabel(60)).toBe("1 h");
    expect(intervalLabel(1440)).toBe("24 h");
  });
  test("periodLabel", () => {
    expect(periodLabel(90)).toBe("90 s");
    expect(periodLabel(300)).toBe("5 min");
    expect(periodLabel(86_400)).toBe("24 h");
  });
  test("errorLabel", () => {
    expect(errorLabel("timeout")).toBe("Timeout");
    expect(errorLabel("dns")).toBe("DNS error");
    expect(errorLabel("connect")).toBe("Connection failed");
    expect(errorLabel("tls")).toBe("TLS error");
    expect(errorLabel("status")).toBe("Wrong status");
    expect(errorLabel("keyword")).toBe("Keyword rule failed");
    expect(errorLabel("heartbeat_late")).toBe("Heartbeat late");
    expect(errorLabel("heartbeat_fail")).toBe("Job reported failure");
    expect(errorLabel("other")).toBe("Error");
  });
  test("stateLabel", () => {
    expect(stateLabel("up")).toBe("Up");
    expect(stateLabel("maintenance")).toBe("Maintenance");
    expect(stateLabel("unknown")).toBe("Unknown");
  });
});

describe("numbers", () => {
  test("pct", () => {
    expect(pct(null)).toBe("—");
    expect(pct(1)).toBe("100%");
    expect(pct(0.9998)).toBe("99.98%");
    expect(pct(0.99999)).toBe("99.99%");
    expect(pct(0.5)).toBe("50.00%");
  });
  test("ms", () => expect(ms(181.6)).toBe("182 ms"));
  test("compact", () => {
    expect(compact(999)).toBe("999");
    expect(compact(6200)).toBe("6.2k");
    expect(compact(1_500_000)).toBe("1.5M");
  });
});
