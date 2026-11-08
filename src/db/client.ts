import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import type { Env } from "@/env";
import * as schema from "@/db/schema";

export const getDb = (env: Env): DrizzleD1Database<typeof schema> =>
  drizzle(env.DB, { schema });
