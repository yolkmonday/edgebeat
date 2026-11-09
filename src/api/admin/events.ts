import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "@/env";
import { getDb } from "@/db/client";
import { eventsQuery, toStateEvent } from "@/api/admin/event-rows";
import type { EventsPage } from "@/shared/admin-api";

export const eventsApi = new Hono<{ Bindings: Env }>();

const querySchema = z.object({
  monitorId: z.string().min(1).max(64).optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

eventsApi.get(
  "/",
  zValidator("query", querySchema, (result, c) => {
    if (!result.success) return c.json({ error: "validation", issues: result.error.issues }, 400);
  }),
  async (c) => {
    const { monitorId, before, limit } = c.req.valid("query");
    // one extra row tells whether another page exists
    const rows = await eventsQuery(getDb(c.env), { monitorId, before }, limit + 1);
    const page = rows.slice(0, limit).map(toStateEvent);
    const body: EventsPage = { items: page, nextBefore: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
    return c.json(body);
  },
);
