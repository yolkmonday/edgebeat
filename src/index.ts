import { app } from "@/api/app";
import type { Env } from "@/env";
import { runTick } from "@/tick/tick";

export default {
  fetch: app.fetch,
  scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => {
    ctx.waitUntil(runTick(env, Date.now()));
  },
} satisfies ExportedHandler<Env>;
