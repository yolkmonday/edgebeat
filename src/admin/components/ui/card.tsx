import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type CardProps = Omit<ComponentProps<"section">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Rendered in a bg-surface-2 bar at the bottom (e.g. Save / Cancel). */
  footer?: ReactNode;
};

export const Card = ({ title, description, actions, footer, className, children, ...props }: CardProps) => (
  <section className={cn("overflow-hidden rounded-lg border border-border bg-surface shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]", className)} {...props}>
    {title || description || actions ? (
      <header className="flex items-start justify-between gap-4 px-6 pt-6">
        <div className="flex flex-col gap-1">
          {title ? <h2 className="text-base font-semibold text-text">{title}</h2> : null}
          {description ? <p className="text-sm text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
    ) : null}
    {children ? <div className="p-6">{children}</div> : null}
    {footer ? <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-2 px-6 py-4">{footer}</footer> : null}
  </section>
);
