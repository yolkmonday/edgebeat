import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-[11px] font-medium uppercase", {
  variants: {
    variant: {
      neutral: "bg-surface-3 text-muted",
      accent: "bg-accent-bg text-accent-text",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export type BadgeProps = ComponentProps<"span"> & VariantProps<typeof badgeVariants>;

export const Badge = ({ className, variant, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ variant }), className)} {...props} />
);
