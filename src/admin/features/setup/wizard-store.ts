import { create } from "zustand";
import type { Monitor, MonitorCreate, TestCheckResult } from "@shared/admin-api";
import { slugify } from "@shared/monitor-schema";

export type MonitorType = Monitor["type"];

export type WizardStep = 1 | 2 | 3 | 4;

/** Form values as typed by the user; numbers stay strings until `toMonitorCreate`. */
export type WizardDraft = {
  name: string;
  url: string;
  interval: string; // minutes
  keywordOn: boolean;
  keyword: string;
  host: string;
  port: string;
  period: string; // seconds
  grace: string; // minutes
};

export const DEFAULT_DRAFT: WizardDraft = {
  name: "",
  url: "",
  interval: "1",
  keywordOn: false,
  keyword: "",
  host: "",
  port: "",
  period: "86400",
  grace: "30",
};

/** `followRedirects` is left out on purpose so the API default applies. */
export const toMonitorCreate = (type: MonitorType, draft: WizardDraft, slugSuffix = ""): MonitorCreate => {
  const name = draft.name.trim();
  const base = { name, slug: `${slugify(name).slice(0, 64 - slugSuffix.length).replace(/-+$/, "")}${slugSuffix}`, type };
  if (type === "http") {
    const keyword = draft.keywordOn ? draft.keyword : "";
    return {
      ...base,
      url: draft.url.trim(),
      intervalMin: Number(draft.interval),
      ...(keyword ? { keyword, keywordMode: "contains" as const } : {}),
    };
  }
  if (type === "tcp") {
    return { ...base, host: draft.host.trim(), port: Number(draft.port), intervalMin: Number(draft.interval) };
  }
  return { ...base, heartbeatPeriodS: Number(draft.period), heartbeatGraceS: Number(draft.grace) * 60 };
};

type WizardState = {
  step: WizardStep;
  type: MonitorType;
  draft: WizardDraft;
  created: Monitor | null;
  check: TestCheckResult | null;
  setType: (type: MonitorType) => void;
  patchDraft: (patch: Partial<WizardDraft>) => void;
  setCreated: (created: Monitor | null) => void;
  setCheck: (check: TestCheckResult | null) => void;
  next: () => void;
  back: () => void;
  /** "Add another": back to the type step with an empty draft, keeping the chosen type. */
  reset: () => void;
  /** Entering /setup: a fresh wizard at step 1 (no leftover monitor, check or beat URL). */
  start: () => void;
};

const clamp = (n: number): WizardStep => Math.min(4, Math.max(1, n)) as WizardStep;

export const useWizard = create<WizardState>()((set) => ({
  step: 1,
  type: "http",
  draft: DEFAULT_DRAFT,
  created: null,
  check: null,
  setType: (type) => set({ type }),
  patchDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  setCreated: (created) => set({ created }),
  setCheck: (check) => set({ check }),
  next: () => set((s) => ({ step: clamp(s.step + 1) })),
  back: () => set((s) => ({ step: clamp(s.step - 1) })),
  reset: () => set({ step: 2, draft: DEFAULT_DRAFT, created: null, check: null }),
  start: () => set({ step: 1, type: "http", draft: DEFAULT_DRAFT, created: null, check: null }),
}));
