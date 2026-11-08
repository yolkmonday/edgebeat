import { describe, expect, it } from "bun:test";
import { buildPublicStatus } from "./public-status";
import type { Bar } from "./stats";
import type { CurrentEntry } from "./types";

const NOW = Date.parse("2026-11-09T12:00:00Z");
const MIN = 60_000;

const mon = (id: string, extra: Partial<Parameters<typeof buildPublicStatus>[0]["monitors"][number]> = {}) => ({
  id,
  slug: id,
  name: id,
  groupSlug: null,
  intervalMin: 5,
  isPublic: true,
  paused: false,
  sort: 0,
  ...extra,
});
const cur = (state: CurrentEntry["state"], lastCheckedAt: number | null = NOW - MIN): CurrentEntry => ({
  state,
  lastCheckedAt,
  latencyMs: 50,
});
const build = (over: Partial<Parameters<typeof buildPublicStatus>[0]> = {}) =>
  buildPublicStatus({
    now: NOW,
    siteName: "S",
    lastTickAt: NOW - 10_000,
    groups: [],
    monitors: [mon("a")],
    current: { a: cur("up") },
    bars: {},
    ...over,
  });
const states = (r: ReturnType<typeof build>) => r.groups.flatMap((g) => g.monitors.map((m) => m.state));

describe("staleness", () => {
  it("tick older than 180s: stale, overall unknown, monitors unknown", () => {
    const r = build({ lastTickAt: NOW - 181_000 });
    expect(r.stale).toBe(true);
    expect(r.overall).toBe("unknown");
    expect(states(r)).toEqual(["unknown"]);
  });
  it("exactly 180s is not stale", () => {
    expect(build({ lastTickAt: NOW - 180_000 }).stale).toBe(false);
  });
  it("null lastTickAt is stale", () => {
    const r = build({ lastTickAt: null });
    expect(r.stale).toBe(true);
    expect(states(r)).toEqual(["unknown"]);
  });
  it("5-minute monitor checked 16 min ago is unknown, 14 min ago keeps state", () => {
    expect(states(build({ current: { a: cur("up", NOW - 16 * MIN) } }))).toEqual(["unknown"]);
    expect(states(build({ current: { a: cur("up", NOW - 14 * MIN) } }))).toEqual(["up"]);
  });
  it("never-checked monitor is pending (no entry or null lastCheckedAt)", () => {
    expect(states(build({ current: {} }))).toEqual(["pending"]);
    expect(states(build({ current: { a: cur("up", null) } }))).toEqual(["pending"]);
  });
  it("paused beats stale; stale beats pending", () => {
    const stale = { lastTickAt: null };
    expect(states(build({ ...stale, monitors: [mon("a", { paused: true })] }))).toEqual(["paused"]);
    expect(states(build({ ...stale, current: {} }))).toEqual(["unknown"]);
  });
  it("paused flag wins over stored state", () => {
    expect(states(build({ monitors: [mon("a", { paused: true })] }))).toEqual(["paused"]);
  });
});

describe("overall", () => {
  const three = (a: CurrentEntry, b: CurrentEntry, c: CurrentEntry) => ({
    monitors: [mon("a"), mon("b"), mon("c")],
    current: { a, b, c },
  });
  it("one down of three: partial_outage", () => {
    expect(build(three(cur("down"), cur("up"), cur("up"))).overall).toBe("partial_outage");
  });
  it("all down: major_outage", () => {
    expect(build(three(cur("down"), cur("down"), cur("down"))).overall).toBe("major_outage");
  });
  it("paused excluded from overall", () => {
    const r = build({
      monitors: [mon("a"), mon("b", { paused: true })],
      current: { a: cur("down"), b: cur("up") },
    });
    expect(r.overall).toBe("major_outage");
    const r2 = build({
      monitors: [mon("a"), mon("b", { paused: true })],
      current: { a: cur("up"), b: cur("down") },
    });
    expect(r2.overall).toBe("operational");
  });
  it("degraded and maintenance", () => {
    expect(build(three(cur("degraded"), cur("up"), cur("up"))).overall).toBe("degraded");
    expect(build(three(cur("maintenance"), cur("up"), cur("up"))).overall).toBe("maintenance");
  });
  it("down outranks degraded", () => {
    expect(build(three(cur("down"), cur("degraded"), cur("up"))).overall).toBe("partial_outage");
  });
  it("all pending/unknown or zero or only paused: unknown", () => {
    expect(build({ current: {} }).overall).toBe("unknown");
    expect(build({ monitors: [], current: {} }).overall).toBe("unknown");
    expect(build({ monitors: [mon("a", { paused: true })] }).overall).toBe("unknown");
    expect(build({ current: { a: cur("up", NOW - 16 * MIN) } }).overall).toBe("unknown");
  });
  it("mix of up and unknown follows normal rules", () => {
    const r = build({
      monitors: [mon("a"), mon("b")],
      current: { a: cur("up"), b: cur("up", NOW - 16 * MIN) },
    });
    expect(r.overall).toBe("operational");
  });
  it("down + unknown only counts down among known... partial_outage", () => {
    const r = build({
      monitors: [mon("a"), mon("b")],
      current: { a: cur("down"), b: cur("up", NOW - 16 * MIN) },
    });
    expect(r.overall).toBe("partial_outage");
  });
});

describe("structure", () => {
  it("excludes private monitors", () => {
    const r = build({ monitors: [mon("a"), mon("p", { isPublic: false })], current: { a: cur("up"), p: cur("up") } });
    expect(r.groups.flatMap((g) => g.monitors.map((m) => m.slug))).toEqual(["a"]);
  });
  it("sorts groups and monitors, omits empty groups, ungrouped last as other", () => {
    const r = build({
      groups: [
        { slug: "z", name: "Z", sort: 0 },
        { slug: "b", name: "B", sort: 1 },
        { slug: "a", name: "A", sort: 1 },
        { slug: "empty", name: "Empty", sort: 0 },
      ],
      monitors: [
        mon("m3", { groupSlug: "a", sort: 2, name: "m3" }),
        mon("m2", { groupSlug: "a", sort: 1, name: "zz" }),
        mon("m1", { groupSlug: "a", sort: 1, name: "aa" }),
        mon("mz", { groupSlug: "z" }),
        mon("mo"),
        mon("mb", { groupSlug: "b" }),
      ],
      current: {},
    });
    expect(r.groups.map((g) => g.slug)).toEqual(["z", "a", "b", "other"]);
    expect(r.groups[1]!.monitors.map((m) => m.slug)).toEqual(["m1", "m2", "m3"]);
    expect(r.groups[3]!.name).toBe("Other");
  });
  it("monitor with unknown groupSlug goes to other", () => {
    const r = build({ monitors: [mon("a", { groupSlug: "gone" })] });
    expect(r.groups.map((g) => g.slug)).toEqual(["other"]);
  });
  it("echoes meta", () => {
    const r = build();
    expect(r.siteName).toBe("S");
    expect(r.generatedAt).toBe(NOW);
    expect(r.lastTickAt).toBe(NOW - 10_000);
  });
});

describe("bars and uptime90", () => {
  const bar = (day: string, uptime: number | null, downtimeS = 0, observedS = 0): Bar => ({
    day,
    uptime,
    downtimeS,
    observedS,
  });
  const monBars = (bars: Bar[]) => build({ bars: { a: bars } }).groups[0]!.monitors[0]!;

  it("uptime90 from non-null bars only, observed-weighted", () => {
    const m = monBars([bar("2026-11-07", null), bar("2026-11-08", 1, 0, 86_400), bar("2026-11-09", 0.5, 100, 200)]);
    // 1 - 100 / 86600
    expect(m.uptime90).toBe(0.9988);
  });
  it("null when nothing observed", () => {
    expect(monBars([bar("2026-11-09", null)]).uptime90).toBeNull();
    expect(monBars([]).uptime90).toBeNull();
  });
  it("pads to 90 entries ending today, keeps stored, fills gaps with null bars", () => {
    const m = monBars([bar("2026-11-08", 1, 0, 100)]);
    expect(m.bars).toHaveLength(90);
    expect(m.bars[89]).toEqual(bar("2026-11-09", null));
    expect(m.bars[88]).toEqual(bar("2026-11-08", 1, 0, 100));
    expect(m.bars[0]).toEqual(bar("2026-08-12", null));
  });
  it("drops bars outside the window (old and future)", () => {
    const m = monBars([bar("2025-01-01", 1, 0, 1), bar("2026-11-10", 1, 0, 1), bar("2026-11-09", 1, 0, 50)]);
    expect(m.bars).toHaveLength(90);
    expect(m.bars.map((b) => b.day)).not.toContain("2025-01-01");
    expect(m.bars.map((b) => b.day)).not.toContain("2026-11-10");
    expect(m.bars[89]).toEqual(bar("2026-11-09", 1, 0, 50));
    expect(m.uptime90).toBe(1);
  });
  it("missing bars entry still yields 90 null bars", () => {
    expect(build().groups[0]!.monitors[0]!.bars).toHaveLength(90);
  });
});
