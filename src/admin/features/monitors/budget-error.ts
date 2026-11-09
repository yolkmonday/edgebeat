import { isApiError } from "@/lib/api";

/** Copy for a `409 budget_exceeded` on create, edit or resume; null for any other error. */
export const budgetExceededMessage = (e: unknown): string | null => {
  if (!isApiError(e) || e.code !== "budget_exceeded") return null;
  const after = typeof e.body?.after === "number" ? e.body.after : "?";
  const budget = typeof e.body?.budget === "number" ? e.body.budget : "?";
  return `Over your check budget: ${after} of ${budget} per minute. Raise intervals or switch to the Paid plan in Settings.`;
};
