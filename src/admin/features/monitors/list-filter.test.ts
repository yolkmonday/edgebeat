import { describe, expect, test } from "bun:test";
import type { AdminState, Monitor } from "@shared/admin-api";
import { countByState, filterMonitors, monitorTarget, paginate } from "./list-filter";

const mon = (id: string, state: AdminState, over: Partial<Monitor> = {}): Monitor =>
  ({
    id, slug: id, name: id, type: "http", url: `https://${id}.dev`, host: null, port: null,
    heartbeatPeriodS: null, heartbeatGraceS: null,
    status: { state },
    ...over,
  }) as Monitor;

const list = [
  mon("Acme-Store", "up"),
  mon("billing", "down", { name: "Billing API", slug: "billing-api" }),
  mon("mail", "up", { type: "tcp", url: null, host: "Mail.Acme.dev", port: 587 }),
  mon("nightly", "paused", { type: "heartbeat", url: null, heartbeatPeriodS: 86_400, heartbeatGraceS: 1800 }),
];

describe("filterMonitors", () => {
  test("state tab", () => {
    expect(filterMonitors(list, { state: "up", q: "" }).map((m) => m.id)).toEqual(["Acme-Store", "mail"]);
    expect(filterMonitors(list, { state: "all", q: "" })).toHaveLength(4);
    expect(filterMonitors(list, { state: "degraded", q: "" })).toHaveLength(0);
  });

  test("search covers name, slug, url and host, case-insensitive", () => {
    expect(filterMonitors(list, { state: "all", q: "BILLING API" }).map((m) => m.id)).toEqual(["billing"]);
    expect(filterMonitors(list, { state: "all", q: "billing-api" })).toHaveLength(1);
    expect(filterMonitors(list, { state: "all", q: "https://acme-store" })).toHaveLength(1);
    expect(filterMonitors(list, { state: "all", q: "mail.acme" }).map((m) => m.id)).toEqual(["mail"]);
  });

  test("state and search combine", () => {
    expect(filterMonitors(list, { state: "down", q: "acme" })).toHaveLength(0);
  });
});

describe("countByState", () => {
  test("counts per state plus all", () => {
    expect(countByState(list)).toMatchObject({ all: 4, up: 2, down: 1, paused: 1, degraded: 0, pending: 0, unknown: 0 });
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  test("slices pages of 20", () => {
    expect(paginate(items, 1).items).toHaveLength(20);
    expect(paginate(items, 3)).toMatchObject({ page: 3, pageCount: 3, total: 45 });
    expect(paginate(items, 3).items).toEqual([40, 41, 42, 43, 44]);
  });
  test("clamps out-of-range pages and handles empty", () => {
    expect(paginate(items, 99).page).toBe(3);
    expect(paginate(items, -4).page).toBe(1);
    expect(paginate([], 1)).toMatchObject({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});

describe("monitorTarget", () => {
  test("per type", () => {
    expect(monitorTarget(list[0]!)).toBe("https://Acme-Store.dev");
    expect(monitorTarget(list[2]!)).toBe("Mail.Acme.dev:587");
    expect(monitorTarget(list[3]!)).toBe("Every 24 h, 30 min grace");
  });
});
