import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type InputProps = Omit<ComponentProps<"input">, "size"> & {
  mono?: boolean;
  invalid?: boolean;
  trailing?: ReactNode;
};

export const Input = ({ className, mono, invalid, trailing, ...props }: InputProps) => (
  <div
    className={cn(
      "flex h-10 w-full items-center gap-2 rounded-md border bg-surface px-3 text-sm transition-shadow focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-ring)]",
      invalid ? "border-down" : "border-border-strong",
      props.disabled && "opacity-50",
      className,
    )}
  >
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-muted focus-visible:shadow-none",
        mono && "font-mono",
      )}
      {...props}
    />
    {trailing ? <span className="flex shrink-0 items-center text-muted">{trailing}</span> : null}
  </div>
);
