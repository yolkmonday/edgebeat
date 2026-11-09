import { z } from "zod";
import type { Plan, Settings, SettingsPatch } from "@shared/admin-api";

export const FREE_CHECK_LIMIT = 40;
export const DEFAULT_PAID_BUDGET = 500;
export const MAX_CHECK_BUDGET = 10_000;

export const settingsFormSchema = z
  .object({
    siteName: z.string().trim().min(1, "Enter a site name.").max(80, "Use 80 characters or fewer."),
    plan: z.enum(["free", "paid"]),
    /** Raw input. Empty means "use the default" on the Paid plan. */
    checkBudget: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if (v.plan !== "paid" || v.checkBudget === "") return;
    const n = Number(v.checkBudget);
    if (!Number.isInteger(n) || n < 1 || n > MAX_CHECK_BUDGET) {
      ctx.addIssue({ code: "custom", path: ["checkBudget"], message: `Enter a whole number from 1 to ${MAX_CHECK_BUDGET}.` });
    }
  });

export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export const toFormValues = (s: Settings): SettingsFormValues => ({
  siteName: s.siteName,
  plan: s.plan,
  checkBudget: s.checkBudget === null ? "" : String(s.checkBudget),
});

/** Only the fields that differ from the saved settings. The Free plan never sends a budget. */
export const toPatch = (values: SettingsFormValues, current: Settings): SettingsPatch => {
  const patch: SettingsPatch = {};
  const siteName = values.siteName.trim();
  if (siteName !== current.siteName) patch.siteName = siteName;
  if (values.plan !== current.plan) patch.plan = values.plan;
  if (values.plan === "paid") {
    const budget = values.checkBudget.trim() === "" ? null : Number(values.checkBudget);
    if (budget !== current.checkBudget) patch.checkBudget = budget;
  }
  return patch;
};

/** True when picking `plan` would leave the install above the Free limit. */
export const overFreeLimit = (plan: Plan, checksPerMinute: number): boolean => plan === "free" && checksPerMinute > FREE_CHECK_LIMIT;
