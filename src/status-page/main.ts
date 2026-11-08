import "./style.css";
import type { Overall, PublicMonitor, PublicState, PublicStatus } from "@/core/public-status";

const REFRESH_MS = 60_000;

const OVERALL: Record<Overall, { text: string; tone: string }> = {
  operational: { text: "All systems operational", tone: "ok" },
  degraded: { text: "Degraded performance", tone: "warn" },
  partial_outage: { text: "Partial outage", tone: "bad" },
  major_outage: { text: "Major outage", tone: "bad" },
  maintenance: { text: "Under maintenance", tone: "info" },
  unknown: { text: "Status unknown", tone: "grey" },
};

const STATE: Record<PublicState, { text: string; tone: string }> = {
  up: { text: "Operational", tone: "ok" },
  degraded: { text: "Degraded", tone: "warn" },
  down: { text: "Down", tone: "bad" },
  maintenance: { text: "Maintenance", tone: "info" },
  paused: { text: "Paused", tone: "grey" },
  pending: { text: "Pending", tone: "grey" },
  unknown: { text: "Unknown", tone: "grey" },
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const pct = (u: number | null, digits = 2) => (u === null ? "—" : `${(u * 100).toFixed(digits)}%`);

const barClass = (uptime: number | null) => {
  if (uptime === null) return "bar";
  if (uptime >= 1) return "bar b-ok";
  if (uptime >= 0.99) return "bar b-lime";
  if (uptime >= 0.95) return "bar b-warn";
  return "bar b-bad";
};

const renderBars = (m: PublicMonitor) => {
  const row = el("div", "bars");
  row.setAttribute("role", "img");
  row.setAttribute("aria-label", `90-day uptime for ${m.name}: ${pct(m.uptime90)}`);
  for (const b of m.bars) {
    const bar = el("div", barClass(b.uptime));
    bar.title = `${b.day}: ${pct(b.uptime)} · ${Math.round(b.downtimeS / 60)} min down`;
    row.append(bar);
  }
  return row;
};

const renderMonitor = (m: PublicMonitor) => {
  const wrap = el("div", "px-4 py-3 space-y-2");
  const head = el("div", "flex items-center justify-between gap-3");
  head.append(el("span", "font-medium truncate", m.name));
  const right = el("div", "flex items-center gap-3 shrink-0");
  right.append(el("span", "text-sm tabular-nums", pct(m.uptime90)));
  const s = STATE[m.state] ?? STATE.unknown;
  right.append(el("span", `pill tone-${s.tone}`, s.text));
  head.append(right);
  wrap.append(head, renderBars(m));
  return wrap;
};

const renderStatus = (data: PublicStatus, refreshFailed: boolean) => {
  const frag = document.createDocumentFragment();
  const header = el("header", "mb-6");
  header.append(el("h1", "text-2xl font-semibold", data.siteName));
  frag.append(header);

  const overall = OVERALL[data.overall] ?? OVERALL.unknown;
  frag.append(el("div", `card banner tone-${overall.tone} p-4 mb-4 font-medium`, overall.text));

  if (data.stale) {
    const mins = data.lastTickAt === null ? null : Math.max(1, Math.round((Date.now() - data.lastTickAt) / 60_000));
    const text =
      mins === null
        ? "Monitoring delayed — no checks yet"
        : `Monitoring delayed — last check ${mins} min ago`;
    frag.append(el("div", "card banner tone-warn p-3 mb-4 text-sm", text));
  }

  for (const g of data.groups) {
    const section = el("section", "mb-6");
    section.append(el("h2", "text-sm font-semibold uppercase tracking-wide mb-2", g.name));
    const card = el("div", "card divide-y");
    card.style.setProperty("--tw-divide-color", "var(--border)");
    for (const m of g.monitors) card.append(renderMonitor(m));
    section.append(card);
    frag.append(section);
  }

  if (refreshFailed) {
    const note = el("p", "text-xs mt-2", "Couldn't refresh — showing last known data");
    note.style.color = "var(--muted)";
    frag.append(note);
  }
  return frag;
};

const renderMessage = (text: string) => {
  const p = el("p", "text-center py-16", text);
  p.style.color = "var(--muted)";
  return p;
};

const root = document.getElementById("app");
if (!root) throw new Error("#app missing");
root.className = "mx-auto max-w-3xl px-4 py-8";

let last: PublicStatus | null = null;
let failed = false;
let inFlight = false;

const paint = () => {
  if (last) root.replaceChildren(renderStatus(last, failed));
  else root.replaceChildren(renderMessage(failed ? "Couldn't load status" : "Loading status…"));
};

const refresh = async () => {
  if (inFlight) return;
  inFlight = true;
  try {
    const res = await fetch("/api/v1/status", { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    last = (await res.json()) as PublicStatus;
    failed = false;
  } catch {
    failed = true;
  } finally {
    inFlight = false;
    paint();
  }
};

paint();
void refresh();
setInterval(() => {
  if (document.visibilityState === "visible") void refresh();
}, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
