import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = ComponentProps<"textarea"> & { mono?: boolean; invalid?: boolean };

export const Textarea = ({ className, mono, invalid, ...props }: TextareaProps) => (
  <textarea
    aria-invalid={invalid || undefined}
    className={cn(
      "min-h-24 w-full rounded-md border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_3px_var(--focus-ring)]",
      invalid ? "border-down" : "border-border-strong",
      mono && "font-mono",
      className,
    )}
    {...props}
  />
);
