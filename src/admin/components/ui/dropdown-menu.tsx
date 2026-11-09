import type { ComponentProps } from "react";
import { DropdownMenu as DropdownPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export const DropdownMenuContent = ({ className, sideOffset = 4, align = "end", ...props }: ComponentProps<typeof DropdownPrimitive.Content>) => (
  <DropdownPrimitive.Portal>
    <DropdownPrimitive.Content
      sideOffset={sideOffset}
      align={align}
      className={cn("z-50 min-w-40 rounded-md border border-border bg-surface p-1 shadow-lg", className)}
      {...props}
    />
  </DropdownPrimitive.Portal>
);

export const DropdownMenuItem = ({ className, destructive, ...props }: ComponentProps<typeof DropdownPrimitive.Item> & { destructive?: boolean }) => (
  <DropdownPrimitive.Item
    className={cn(
      "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2",
      destructive ? "text-down-text" : "text-text",
      className,
    )}
    {...props}
  />
);

export const DropdownMenuSeparator = ({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Separator>) => (
  <DropdownPrimitive.Separator className={cn("my-1 h-px bg-border", className)} {...props} />
);
