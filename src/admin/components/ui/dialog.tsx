import type { ComponentProps, ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogContentProps = Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
};

export const DialogContent = ({ title, description, footer, className, children, ...props }: DialogContentProps) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
    <DialogPrimitive.Content
      className={cn(
        "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-6 shadow-xl",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <DialogPrimitive.Title className="text-base font-semibold text-text">{title}</DialogPrimitive.Title>
        {description ? <DialogPrimitive.Description className="text-sm text-muted">{description}</DialogPrimitive.Description> : null}
      </div>
      {children}
      {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      <DialogPrimitive.Close
        aria-label="Close"
        className="absolute top-4 right-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
      >
        <X size={16} aria-hidden />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
);
