import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { effectiveBudget, peakChecksPerMinute } from "@/core/budget";
import { getDb } from "@/db/client";
import { monitors, settings } from "@/db/schema";
import type { Plan, Settings } from "@/shared/admin-api";

export const settingsApi = new Hono<{ Bindings: Env }>();

const patchSchema = z.object({
  siteName: z.string().trim().min(1).max(80).optional(),
  plan: z.enum(["free", "paid"]).optional(),
  checkBudget: z.number().int().min(1).max(10_000).nullable().optional(),
});

type StoredSettings = { siteName: string; plan: Plan; checkBudget: number | null };

export const parseStored = (rows: { key: string; value: string }[]): StoredSettings => {
  const get = (key: string): unknown => {
    const row = rows.find((r) => r.key === key);
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return undefined;
    }
  };
  const siteName = get("siteName");
  const budget = get("checkBudget");
  return {
    siteName: typeof siteName === "string" && siteName !== "" ? siteName : "Status",
    plan: get("plan") === "paid" ? "paid" : "free",
    checkBudget:
      typeof budget === "number" && Number.isInteger(budget) && budget > 0 ? budget : null,
  };
};

export const readStoredSettings = async (env: Env): Promise<StoredSettings> =>
  parseStored(await getDb(env).select().from(settings));

const readSettings = async (env: Env): Promise<Settings> => {
  const db = getDb(env);
  const [settingRows, monitorRows] = await db.batch([
    db.select().from(settings),
    db
      .select({ id: monitors.id, type: monitors.type, intervalMin: monitors.intervalMin, paused: monitors.paused })
      .from(monitors),
  ]);
  const stored = parseStored(settingRows);
  return {
    ...stored,
    effectiveBudget: effectiveBudget(stored.plan, stored.checkBudget),
    checksPerMinute: peakChecksPerMinute(monitorRows.map((m) => ({ ...m, paused: m.paused === 1 }))),
  };
};

settingsApi.get("/", async (c) => c.json(await readSettings(c.env)));

settingsApi.patch(
  "/",
  zValidator("json", patchSchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.issues }, 400);
  }),
  async (c) => {
    const patch = c.req.valid("json");
    const db = getDb(c.env);
    const upserts = Object.entries(patch)
      .filter(([, v]) => v !== undefined)
      .map(([key, v]) =>
        db
          .insert(settings)
          .values({ key, value: JSON.stringify(v) })
          .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(v) } }),
      );
    const [first, ...rest] = upserts;
    if (first) await db.batch([first, ...rest]);
    return c.json(await readSettings(c.env));
  },
);
