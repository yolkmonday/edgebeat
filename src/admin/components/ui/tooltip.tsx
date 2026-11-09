import type { ReactNode } from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

/** One provider for the whole app (mounted in app.tsx); 90 uptime bars must not mean 90 providers. */
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={150}>{children}</TooltipPrimitive.Provider>
);

export type TooltipProps = {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
};

/** Wraps a single focusable child. Needs `TooltipProvider` above it (app root). */
export const Tooltip = ({ content, children, side = "top" }: TooltipProps) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        className="z-50 rounded-md bg-tooltip px-2.5 py-1.5 text-xs text-tooltip-text shadow-lg"
      >
        {content}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
