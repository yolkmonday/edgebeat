import { useLayoutEffect } from "react";
import { Navigate } from "react-router";
import { isApiError } from "@/lib/api";
import { useSession } from "@/api/use-session";
import { StepConfigure } from "@/features/setup/StepConfigure";
import { StepDone } from "@/features/setup/StepDone";
import { StepType } from "@/features/setup/StepType";
import { StepWelcome } from "@/features/setup/StepWelcome";
import { WizardHeader } from "@/features/setup/WizardHeader";
import { useWizard } from "@/features/setup/wizard-store";
import { cn } from "@/lib/utils";

export default function SetupPage() {
  const session = useSession();
  const step = useWizard((s) => s.step);
  const created = useWizard((s) => s.created);
  const start = useWizard((s) => s.start);
  // the store outlives the page: every visit to /setup starts over (before paint, so no stale step 4 flashes)
  useLayoutEffect(() => start(), [start]);
  const unauthorized = session.isError && isApiError(session.error) && session.error.status === 401;

  if (unauthorized) return <Navigate to="/login?next=%2Fsetup" replace />;

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <WizardHeader step={step} />
      <main className="flex flex-1 items-center justify-center p-4 sm:p-6">
        <div className={cn("w-full rounded-lg border border-border bg-surface p-6 shadow-[0_1px_2px_var(--shadow)] sm:p-10", step === 2 ? "max-w-[760px]" : "max-w-[560px]")}>
          {step === 1 ? <StepWelcome /> : null}
          {step === 2 ? <StepType /> : null}
          {step === 3 ? <StepConfigure /> : null}
          {step === 4 && created ? <StepDone /> : null}
        </div>
      </main>
    </div>
  );
}
