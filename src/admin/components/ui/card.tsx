import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CardProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Rendered in a bg-surface-2 bar at the bottom (e.g. Save / Cancel). */
  footer?: ReactNode;
  /** `sm` = dashboard density (screen 03): 20 px padding, 14 px title. */
  size?: "md" | "sm";
  /** Keep the footer (Save / Discard) on screen while a long card scrolls (screen 08). */
  stickyFooter?: boolean;
};

// overflow-clip, not overflow-hidden: hidden creates a scroll container, which would pin a sticky footer to the card.
export const Card = ({ title, description, actions, footer, size = "md", stickyFooter, className, children, ...props }: CardProps) => {
  const sm = size === "sm";
  return (
    <section className={cn("overflow-clip rounded-lg border border-border bg-surface shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]", className)} {...props}>
      {title || description || actions ? (
        <header className={cn("flex items-start justify-between gap-4", sm ? "px-5 pt-5" : "px-6 pt-6")}>
          <div className={cn("flex flex-col", sm ? "gap-0.5" : "gap-1")}>
            {title ? <h2 className={cn("font-semibold text-text", sm ? "text-sm" : "text-base")}>{title}</h2> : null}
            {description ? <p className="text-xs text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className={sm ? "p-5" : "p-6"}>{children}</div> : null}
      {footer ? (
        <footer
          className={cn("flex items-center justify-end gap-2 border-t border-border bg-surface-2", sm ? "px-5 py-3" : "px-6 py-4", stickyFooter && "sticky bottom-0 z-10")}
        >
          {footer}
        </footer>
      ) : null}
    </section>
  );
};
