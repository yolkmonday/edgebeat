import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

export type CopyButtonProps = Omit<ButtonProps, "onClick" | "icon" | "children" | "value"> & {
  value: string;
  label?: string;
};

export const CopyButton = ({ value, label = "Copy", variant = "secondary", size = "sm", ...props }: CopyButtonProps) => {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Could not copy", { description: "Select the text and copy it manually." });
    }
  };
  return (
    <Button variant={variant} size={size} icon={Copy} onClick={copy} {...props}>
      {label}
    </Button>
  );
};
