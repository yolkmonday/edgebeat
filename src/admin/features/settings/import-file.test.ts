import { describe, expect, test } from "bun:test";
import type { ExportFile } from "@shared/admin-api";
import { parseImportFile } from "./import-file";

const fixture: ExportFile = {
  upflare: 1,
  exportedAt: "2026-11-09T12:00:00.000Z",
  settings: { siteName: "Acme status", plan: "free", checkBudget: null },
  groups: [{ slug: "core", name: "Core", sort: 0 }],
  monitors: [
    {
      slug: "api", name: "API", type: "http", group: "core", url: "https://example.com", method: "GET", headers: {}, body: null,
      expectedStatus: "200-299", timeoutMs: 10_000, followRedirects: true, keyword: null, keywordMode: "present", host: null, port: null,
      intervalMin: 1, confirmations: 2, degradedThresholdMs: null, heartbeatPeriodS: null, heartbeatGraceS: null, isPublic: true, paused: false, sort: 0,
    } as unknown as ExportFile["monitors"][number],
  ],
};

const errorsOf = (text: string) => {
  const r = parseImportFile(text);
  return r.ok ? [] : r.errors;
};

describe("parseImportFile", () => {
  test("accepts an export file", () => {
    const r = parseImportFile(JSON.stringify(fixture));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.monitors).toHaveLength(1);
  });

  test("rejects non-JSON", () => expect(errorsOf("not json {")).toEqual(["This file is not valid JSON."]));

  test("rejects JSON that is not an object", () => expect(errorsOf("[1,2]")[0]).toContain("not an Upflare export"));

  test("rejects a wrong version", () => {
    expect(errorsOf(JSON.stringify({ ...fixture, upflare: 2 }))[0]).toBe("Unsupported export version: 2. Expected 1.");
    expect(errorsOf(JSON.stringify({ groups: [], monitors: [] }))[0]).toContain("missing");
  });

  test("lists missing sections", () => {
    expect(errorsOf(JSON.stringify({ upflare: 1 }))).toEqual([
      "Missing \"settings\" object.",
      "Missing \"groups\" list.",
      "Missing \"monitors\" list.",
    ]);
  });

  test("points at malformed rows", () => {
    const bad = { ...fixture, monitors: [{ slug: "x" }], groups: [{}] };
    expect(errorsOf(JSON.stringify(bad))).toEqual(["groups[0] needs a \"slug\" and a \"name\".", "monitors[0] needs a \"slug\" and a \"name\"."]);
  });
});
