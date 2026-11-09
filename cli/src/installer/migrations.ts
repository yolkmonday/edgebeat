import type { ReleaseBundle } from "../contracts";

export type PendingMigration = { name: string; statements: string[] };

const BREAKPOINT = "--> statement-breakpoint";

// Wrangler's migration table, so `wrangler d1 migrations apply` keeps working later.
export const CREATE_MIGRATIONS_TABLE =
  "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);";
export const SELECT_APPLIED = "SELECT name FROM d1_migrations ORDER BY id;";

export const pendingMigrations = (applied: string[], bundle: ReleaseBundle): PendingMigration[] => {
  const done = new Set(applied);
  return [...bundle.migrations]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .filter((m) => !done.has(m.name))
    .map((m) => ({
      name: m.name,
      statements: m.sql
        .split(BREAKPOINT)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    }));
};

const sqlString = (s: string): string => `'${s.replaceAll("'", "''")}'`;

// One query per file: its statements plus the d1_migrations insert, as wrangler does,
// so D1 runs them as one batch and a file is never recorded half-applied.
export const migrationBatch = (m: PendingMigration): string =>
  [
    ...m.statements.map((s) => (s.endsWith(";") ? s : `${s};`)),
    `INSERT INTO d1_migrations (name) VALUES (${sqlString(m.name)});`,
  ].join("\n");
