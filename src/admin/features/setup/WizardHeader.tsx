import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import type { WizardStep } from "@/features/setup/wizard-store";

export const WizardHeader = ({ step }: { step: WizardStep }) => (
  <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-4 sm:px-8">
    <Logo wordmark />
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted">Step {step} of 4</span>
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label="Setup progress">
        {([1, 2, 3, 4] as const).map((n) => (
          <span key={n} className={cn("h-1 w-8 rounded-pill", n <= step ? "bg-accent" : "bg-surface-3")} />
        ))}
      </div>
    </div>
  </header>
);
