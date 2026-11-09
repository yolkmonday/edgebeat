import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReleaseManifest } from "../contracts";
import { loadBundle } from "./load";

let dir = "";
const manifest: ReleaseManifest = {
  version: "1.2.3",
  compatibilityDate: "2026-11-01",
  compatibilityFlags: [],
  mainModule: "index.js",
  modules: [
    { name: "index.js", contentType: "application/javascript+module" },
    { name: "index.js.map", contentType: "application/source-map" },
  ],
  crons: ["* * * * *"],
  assetsConfig: { run_worker_first: ["/api/*"] },
  migrations: ["0000_a.sql", "0001_b.sql"],
  observability: true,
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "edgebeat-load-test-"));
  await mkdir(join(dir, "worker"), { recursive: true });
  await mkdir(join(dir, "assets", "assets"), { recursive: true });
  await mkdir(join(dir, "migrations"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "worker", "index.js"), new Uint8Array([1, 2, 3]));
  await writeFile(join(dir, "worker", "index.js.map"), "{}");
  await writeFile(join(dir, "assets", "index.html"), "<html></html>");
  await writeFile(join(dir, "assets", "assets", "app.js"), "x");
  await writeFile(join(dir, "migrations", "0000_a.sql"), "CREATE TABLE a (id int);");
  await writeFile(join(dir, "migrations", "0001_b.sql"), "CREATE TABLE b (id int);");
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test("loadBundle round-trips manifest, modules, assets, migrations", async () => {
  const b = await loadBundle(dir);
  expect(b.manifest).toEqual(manifest);
  expect(Object.keys(b.modules).sort()).toEqual(["index.js", "index.js.map"]);
  expect([...b.modules["index.js"]!]).toEqual([1, 2, 3]);
  expect(Object.keys(b.assets).sort()).toEqual(["/assets/app.js", "/index.html"]);
  expect(Object.keys(b.assets).every((k) => k.startsWith("/"))).toBe(true);
  expect(b.migrations).toEqual([
    { name: "0000_a.sql", sql: "CREATE TABLE a (id int);" },
    { name: "0001_b.sql", sql: "CREATE TABLE b (id int);" },
  ]);
});
