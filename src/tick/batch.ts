import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@/db/schema";

type Db = DrizzleD1Database<typeof schema>;
type Stmt = BatchItem<"sqlite">;

// D1 rejects statements with more than 100 bound parameters.
export const MAX_PARAMS = 100;

export const MIN_MS = 60_000;
export const DAY_MS = 86_400_000;

/** Rows per multi-row insert so that `paramsPerRow * rows <= MAX_PARAMS`. */
export const chunkRows = <T>(rows: T[], paramsPerRow: number): T[][] => {
  const size = Math.max(1, Math.floor(MAX_PARAMS / paramsPerRow));
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
};

export const parseJson = <T>(text: string, fallback: T, valid: (v: unknown) => boolean): T => {
  try {
    const v: unknown = JSON.parse(text);
    return valid(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
};

export const isRecord = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);

/** One D1 batch (single implicit transaction); no-op for an empty list. */
export const runBatch = async (db: Db, stmts: Stmt[]): Promise<void> => {
  if (stmts.length === 0) return;
  await db.batch(stmts as [Stmt, ...Stmt[]]);
};
