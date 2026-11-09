import { describe, expect, test } from "bun:test";
import { makeApiError } from "@/lib/api";
import { budgetExceededMessage } from "./budget-error";

describe("budgetExceededMessage", () => {
  test("uses after and budget from the 409 body", () => {
    const e = makeApiError(409, { error: "budget_exceeded", used: 40, after: 41, budget: 40 });
    expect(budgetExceededMessage(e)).toBe("Over your check budget: 41 of 40 per minute. Raise intervals or switch to the Paid plan in Settings.");
  });
  test("falls back to ? when the body lacks numbers", () => {
    expect(budgetExceededMessage(makeApiError(409, { error: "budget_exceeded" }))).toContain("? of ? per minute");
  });
  test("null for other errors", () => {
    expect(budgetExceededMessage(makeApiError(409, { error: "slug_conflict" }))).toBeNull();
    expect(budgetExceededMessage(new Error("x"))).toBeNull();
  });
});
