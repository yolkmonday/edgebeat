import { describe, expect, test } from "bun:test";
import type { Settings } from "@shared/admin-api";
import { overFreeLimit, settingsFormSchema, toFormValues, toPatch } from "./settings-form";

const free: Settings = { siteName: "Acme status", plan: "free", checkBudget: null, effectiveBudget: 40, checksPerMinute: 23 };
const paid: Settings = { siteName: "Acme status", plan: "paid", checkBudget: 200, effectiveBudget: 200, checksPerMinute: 23 };

describe("toPatch", () => {
  test("sends nothing when untouched", () => {
    expect(toPatch(toFormValues(free), free)).toEqual({});
    expect(toPatch(toFormValues(paid), paid)).toEqual({});
  });

  test("free plan sends no checkBudget", () => {
    const patch = toPatch({ siteName: "New", plan: "free", checkBudget: "999" }, free);
    expect(patch).toEqual({ siteName: "New" });
    expect("checkBudget" in patch).toBe(false);
  });

  test("switching to free sends only the plan", () => {
    expect(toPatch({ ...toFormValues(paid), plan: "free" }, paid)).toEqual({ plan: "free" });
  });

  test("paid with an empty budget clears it to null", () => {
    expect(toPatch({ siteName: "Acme status", plan: "paid", checkBudget: "" }, paid)).toEqual({ checkBudget: null });
  });

  test("paid budget is parsed to a number and only sent when changed", () => {
    expect(toPatch({ siteName: "Acme status", plan: "paid", checkBudget: "300" }, paid)).toEqual({ checkBudget: 300 });
    expect(toPatch({ siteName: "Acme status", plan: "paid", checkBudget: "" }, { ...free, plan: "paid" })).toEqual({});
  });

  test("trims the site name", () => {
    expect(toPatch({ siteName: "  Acme  ", plan: "free", checkBudget: "" }, free)).toEqual({ siteName: "Acme" });
  });
});

describe("overFreeLimit", () => {
  test("warns only on free above 40", () => {
    expect(overFreeLimit("free", 41)).toBe(true);
    expect(overFreeLimit("free", 40)).toBe(false);
    expect(overFreeLimit("paid", 400)).toBe(false);
  });
});

describe("settingsFormSchema", () => {
  const parse = (v: object) => settingsFormSchema.safeParse({ siteName: "A", plan: "paid", checkBudget: "", ...v });
  test("accepts empty and in-range budgets", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ checkBudget: "10000" }).success).toBe(true);
  });
  test("rejects out-of-range or non-integer budgets on paid", () => {
    expect(parse({ checkBudget: "0" }).success).toBe(false);
    expect(parse({ checkBudget: "10001" }).success).toBe(false);
    expect(parse({ checkBudget: "1.5" }).success).toBe(false);
    expect(parse({ checkBudget: "abc" }).success).toBe(false);
  });
  test("ignores the budget input on free", () => {
    expect(parse({ plan: "free", checkBudget: "abc" }).success).toBe(true);
  });
  test("requires a site name", () => expect(parse({ siteName: "  " }).success).toBe(false));
});
