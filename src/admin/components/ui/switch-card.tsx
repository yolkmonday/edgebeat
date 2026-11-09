import { useId } from "react";
import { Switch } from "@/components/ui/switch";

export type SwitchCardProps = {
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

export const SwitchCard = ({ title, description, checked, onCheckedChange, disabled }: SwitchCardProps) => {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {title}
        </label>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
};
