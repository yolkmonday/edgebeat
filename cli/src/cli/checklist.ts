import type { InstallEvent, InstallStep } from "../contracts";

const LABELS: Record<InstallStep, string> = {
  verify: "Token",
  limits: "Limits",
  subdomain: "Subdomain",
  database: "Database",
  migrations: "Migrations",
  script: "Script",
  secrets: "Secrets",
  schedule: "Schedule",
  route: "Route",
  health: "Health check",
};

export const makeColors = (isTTY: boolean) => {
  const wrap = (code: number) => (s: string) => (isTTY ? `\u001b[${code}m${s}\u001b[0m` : s);
  return { green: wrap(32), red: wrap(31), yellow: wrap(33), dim: wrap(2), bold: wrap(1) };
};

// Turns installer events into one checklist line per finished step.
export const createChecklist = (print: (line: string) => void, isTTY: boolean) => {
  const c = makeColors(isTTY);
  const state = { failed: false };

  const onEvent = (e: InstallEvent): void => {
    if (e.status === "start") return;
    const label = LABELS[e.step];
    if (e.status === "fail") {
      state.failed = true;
      print(`${c.red("✗")} ${label} — ${e.error.message}`);
      return;
    }
    const detail = e.detail ? ` (${e.detail})` : "";
    if (e.status === "skip") {
      print(`${c.dim("-")} ${label}${detail} ${c.dim("skipped")}`);
      return;
    }
    print(`${c.green("✓")} ${label}${detail}`);
  };

  return { onEvent, hasFailure: () => state.failed, resetFailure: () => (state.failed = false) };
};
