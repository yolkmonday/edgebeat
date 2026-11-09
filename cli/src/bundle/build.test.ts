import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReleaseManifest } from "../contracts";
import { buildBundle, stripJsonc } from "./build";

const repoRoot = resolve(import.meta.dir, "../../..");
let out = "";
let manifest: ReleaseManifest;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "edgebeat-build-test-"));
  manifest = await buildBundle(repoRoot, out);
}, 240_000);

afterAll(async () => {
  if (out) await rm(out, { recursive: true, force: true });
});

describe("buildBundle", () => {
  test("manifest matches repo config", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const wr = JSON.parse(stripJsonc(readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8")));
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.compatibilityDate).toBe(wr.compatibility_date);
    expect(manifest.crons).toEqual(["* * * * *"]);
    expect(manifest.assetsConfig.run_worker_first).toEqual(["/api/*", "/beat/*", "/admin", "/admin/*"]);
    expect(manifest.observability).toBe(true);
    expect(manifest.migrations).toEqual(
      readdirSync(join(repoRoot, "migrations")).filter((n) => n.endsWith(".sql")).sort(),
    );
  });

  test("writes worker, assets and manifest.json", () => {
    expect(existsSync(join(out, "worker", manifest.mainModule))).toBe(true);
    for (const m of manifest.modules) expect(existsSync(join(out, "worker", m.name))).toBe(true);
    expect(manifest.modules.map((m) => m.name)).toContain(manifest.mainModule);
    expect(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).toEqual(manifest);
    expect(readFileSync(join(out, "assets", "index.html"), "utf8")).toContain('<div id="app">');
    expect(readFileSync(join(out, "assets", "admin", "index.html"), "utf8")).toContain('<div id="root">');
    for (const name of manifest.migrations) expect(existsSync(join(out, "migrations", name))).toBe(true);
  });

  test("content types", () => {
    for (const m of manifest.modules) expect(m.contentType).toBe("application/javascript+module");
  });

  test("source maps are not shipped, like wrangler deploy (R17)", () => {
    expect(manifest.modules.filter((m) => m.name.endsWith(".map"))).toEqual([]);
    expect(readdirSync(join(out, "worker")).filter((n) => n.endsWith(".map"))).toEqual([]);
  });
});

describe("stripJsonc", () => {
  test("strips comments and trailing commas, keeps strings", () => {
    const src = `{
      // line
      "a": "http://x/*not a comment*/", /* block */
      "b": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonc(src))).toEqual({ a: "http://x/*not a comment*/", b: [1, 2] });
  });
});
