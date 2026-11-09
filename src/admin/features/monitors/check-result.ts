import { toast } from "sonner";
import type { TestCheckResult } from "@shared/admin-api";
import { errorLabel, ms } from "@/lib/format";

/** One-line summary of a test check, shared by the row menu and the detail page. */
export const reportCheck = (name: string, r: TestCheckResult) => {
  if (r.ok) {
    toast.success(`${name} passed`, { description: [r.code ? `HTTP ${r.code}` : null, r.latencyMs != null ? ms(r.latencyMs) : null].filter(Boolean).join(" · ") || undefined });
    return;
  }
  toast.error(`${name} failed`, { description: [r.error ? errorLabel(r.error) : null, r.code ? `HTTP ${r.code}` : null].filter(Boolean).join(" · ") || undefined });
};
