import { app } from "@/api/app";
import type { Env } from "@/env";

export default {
  fetch: app.fetch,
  // runTick (Task 7) will be wired here
  scheduled: async (_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> => {},
} satisfies ExportedHandler<Env>;
