export const qk = {
  session: ["session"],
  overview: ["overview"],
  monitors: ["monitors"],
  monitor: (id: string) => ["monitors", id],
  groups: ["groups"],
  settings: ["settings"],
  events: (f: { monitorId?: string }) => ["events", f],
  tokens: ["tokens"],
} as const;
