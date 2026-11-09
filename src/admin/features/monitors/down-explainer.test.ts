import { describe, expect, test } from "bun:test";
import { explainDown } from "./down-explainer";

describe("explainDown", () => {
  test("http without keyword", () => {
    const t = explainDown({ type: "http", expectedStatus: "200-399", timeoutS: 10, confirmations: 2, intervalMin: 1 });
    expect(t).toBe("A check fails when the status is outside 200-399, or there is no answer within 10 s. After 2 failures in a row we mark it Down, so a single blip doesn't count.");
  });

  test("http with keyword rule", () => {
    const has = explainDown({ type: "http", expectedStatus: "200", keyword: "ok", keywordMode: "contains", timeoutS: 5, confirmations: 1, intervalMin: 1 });
    expect(has).toContain(`"ok" is missing from the response`);
    expect(has).toContain("One failed check marks it Down right away.");
    const not = explainDown({ type: "http", keyword: "error", keywordMode: "not_contains", confirmations: 3, intervalMin: 1 });
    expect(not).toContain(`"error" shows up in the response`);
    expect(not).toContain("outside the expected range");
    expect(not).toContain("within the timeout");
  });

  test("tcp", () => {
    const t = explainDown({ type: "tcp", host: "mail.acme.dev", port: 587, timeoutS: 10, confirmations: 2, intervalMin: 5 });
    expect(t).toContain("mail.acme.dev:587 doesn't accept a connection within 10 s");
  });

  test("heartbeat adds period and grace", () => {
    const t = explainDown({ type: "heartbeat", name: "Invoice sync", periodS: 3600, graceS: 600, confirmations: 1, intervalMin: 1 });
    expect(t).toBe("If no beat arrives within 1 h 10 min of the last one, Invoice sync goes Down and your status page shows it.");
  });

  test("heartbeat states the confirmation rule", () => {
    const t = explainDown({ type: "heartbeat", periodS: 3600, graceS: 600, confirmations: 2, intervalMin: 5 });
    expect(t).toContain("this heartbeat goes Down");
    expect(t).toContain("every 5 min and need 2 late checks in a row");
  });
});
