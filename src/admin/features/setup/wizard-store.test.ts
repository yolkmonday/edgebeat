import { beforeEach, describe, expect, test } from "bun:test";
import { monitorInput } from "@shared/monitor-schema";
import { DEFAULT_DRAFT, toMonitorCreate, useWizard, type WizardDraft } from "./wizard-store";

const draft = (patch: Partial<WizardDraft>): WizardDraft => ({ ...DEFAULT_DRAFT, ...patch });

describe("toMonitorCreate", () => {
  test("http without keyword", () => {
    const out = toMonitorCreate("http", draft({ name: "Acme Store", url: "https://acmestore.com", interval: "5", keyword: "ignored" }));
    expect(monitorInput.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ slug: "acme-store", intervalMin: 5, url: "https://acmestore.com" });
    expect(out.keyword).toBeUndefined();
    expect("followRedirects" in out).toBe(false);
  });

  test("http with keyword switch on", () => {
    const out = toMonitorCreate("http", draft({ name: "Shop", url: "https://shop.dev", keywordOn: true, keyword: "Add to cart" }));
    expect(monitorInput.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ keyword: "Add to cart", keywordMode: "contains" });
  });

  test("tcp", () => {
    const out = toMonitorCreate("tcp", draft({ name: "Mail server", host: "mail.acme.dev", port: "587", interval: "5" }));
    expect(monitorInput.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ host: "mail.acme.dev", port: 587, intervalMin: 5 });
  });

  test("heartbeat period and grace in seconds", () => {
    const out = toMonitorCreate("heartbeat", draft({ name: "Nightly backup", period: "86400", grace: "30" }));
    expect(monitorInput.safeParse(out).success).toBe(true);
    expect(out).toMatchObject({ heartbeatPeriodS: 86_400, heartbeatGraceS: 1_800 });
  });

  test("slug suffix stays within 64 chars", () => {
    const out = toMonitorCreate("http", draft({ name: "a".repeat(80), url: "https://a.dev" }), "-2");
    expect(out.slug.length).toBeLessThanOrEqual(64);
    expect(out.slug.endsWith("-2")).toBe(true);
  });
});

describe("useWizard", () => {
  beforeEach(() => useWizard.setState({ step: 1, type: "http", draft: DEFAULT_DRAFT, created: null, check: null }));

  test("next and back clamp to 1..4", () => {
    const { next, back } = useWizard.getState();
    back();
    expect(useWizard.getState().step).toBe(1);
    for (let i = 0; i < 6; i++) next();
    expect(useWizard.getState().step).toBe(4);
  });

  test("reset keeps the chosen type and returns to step 2", () => {
    useWizard.setState({ step: 4, type: "tcp", draft: draft({ name: "x" }), check: { ok: true, latencyMs: 1, code: null, error: null, at: 1 } });
    useWizard.getState().reset();
    const s = useWizard.getState();
    expect(s).toMatchObject({ step: 2, type: "tcp", created: null, check: null });
    expect(s.draft).toEqual(DEFAULT_DRAFT);
  });
});
