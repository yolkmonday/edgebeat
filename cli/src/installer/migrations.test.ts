import { describe, expect, test } from "bun:test";
import type { ReleaseBundle } from "../contracts";
import { migrationBatch, pendingMigrations } from "./migrations";

const bundleWith = (migrations: { name: string; sql: string }[]): ReleaseBundle => ({
  manifest: {
    version: "0.1.0",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: [],
    mainModule: "index.js",
    modules: [{ name: "index.js", contentType: "application/javascript+module" }],
    crons: ["* * * * *"],
    assetsConfig: { run_worker_first: ["/api/*"] },
    migrations: migrations.map((m) => m.name),
    observability: true,
  },
  modules: { "index.js": new Uint8Array() },
  assets: {},
  migrations,
});

describe("pendingMigrations", () => {
  test("splits on statement-breakpoint, trims and drops empty statements", () => {
    const b = bundleWith([
      {
        name: "0000_a.sql",
        sql: "CREATE TABLE `a` (`id` text);\n--> statement-breakpoint\n  CREATE INDEX `i` ON `a` (`id`);  \n--> statement-breakpoint\n\n",
      },
    ]);
    expect(pendingMigrations([], b)).toEqual([
      { name: "0000_a.sql", statements: ["CREATE TABLE `a` (`id` text);", "CREATE INDEX `i` ON `a` (`id`);"] },
    ]);
  });

  test("keeps file order and skips applied names", () => {
    const b = bundleWith([
      { name: "0000_a.sql", sql: "CREATE TABLE a (x);" },
      { name: "0001_b.sql", sql: "CREATE TABLE b (x);" },
      { name: "0002_c.sql", sql: "CREATE TABLE c (x);" },
    ]);
    expect(pendingMigrations(["0000_a.sql"], b).map((m) => m.name)).toEqual(["0001_b.sql", "0002_c.sql"]);
    expect(pendingMigrations(["0000_a.sql", "0001_b.sql", "0002_c.sql"], b)).toEqual([]);
  });

  test("orders by file name even if the bundle lists them out of order", () => {
    const b = bundleWith([
      { name: "0001_b.sql", sql: "CREATE TABLE b (x);" },
      { name: "0000_a.sql", sql: "CREATE TABLE a (x);" },
    ]);
    expect(pendingMigrations([], b).map((m) => m.name)).toEqual(["0000_a.sql", "0001_b.sql"]);
  });
});

describe("migrationBatch", () => {
  test("runs the file and records its name in one query, wrangler style", () => {
    const sql = migrationBatch({
      name: "0000_it's.sql",
      statements: ["CREATE TABLE a (x);", "CREATE INDEX i ON a (x)"],
    });
    expect(sql).toBe(
      "CREATE TABLE a (x);\nCREATE INDEX i ON a (x);\nINSERT INTO d1_migrations (name) VALUES ('0000_it''s.sql');",
    );
  });
});
