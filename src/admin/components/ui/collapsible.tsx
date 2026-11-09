import { useState, type ReactNode } from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { ChevronRight } from "lucide-react";

export type CollapsibleProps = {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
};

export const Collapsible = ({ title, children, defaultOpen = false }: CollapsibleProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <CollapsiblePrimitive.Trigger className="flex w-fit cursor-pointer items-center gap-1.5 text-sm font-medium text-text">
        <ChevronRight size={16} aria-hidden className={open ? "rotate-90 transition-transform" : "transition-transform"} />
        {title}
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content>{children}</CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
};
