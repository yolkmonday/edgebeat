import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Table = ({ className, ...props }: ComponentProps<"table">) => (
  // relative: sr-only (absolute) header text would otherwise escape the scroll box and widen the page on mobile
  <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
    <table className={cn("w-full border-collapse text-sm", className)} {...props} />
  </div>
);

export const THead = ({ className, ...props }: ComponentProps<"thead">) => (
  <thead className={cn("bg-surface-2 text-left text-xs font-medium text-muted", className)} {...props} />
);

export const TBody = (props: ComponentProps<"tbody">) => <tbody {...props} />;

export const TRow = ({ className, ...props }: ComponentProps<"tr">) => (
  <tr className={cn("border-t border-border first:border-t-0 hover:bg-surface-2/60", className)} {...props} />
);

export type TCellProps = ComponentProps<"td"> & { numeric?: boolean; head?: boolean };

/** `head` renders a `th`; `numeric` right-aligns and uses mono. */
export const TCell = ({ className, numeric, head, ...props }: TCellProps) => {
  const classes = cn("px-4 align-middle", numeric && "text-right tabular-nums", numeric && !head && "font-mono", head ? "h-10 font-medium" : "py-2.5", className);
  return head ? <th scope="col" className={classes} {...(props as ComponentProps<"th">)} /> : <td className={classes} {...props} />;
};
