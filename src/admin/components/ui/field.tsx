import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";

export type FieldProps = {
  label: string;
  htmlFor: string;
  helper?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
};

/** Label above, control, then helper or error below. Injects aria wiring into a single element child. */
export const Field = ({ label, htmlFor, helper, error, optional, children }: FieldProps) => {
  const describedBy = error ? `${htmlFor}-error` : helper ? `${htmlFor}-helper` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: htmlFor,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        ...(error ? { invalid: true } : {}),
      })
    : children;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="ml-1 font-normal text-muted">(optional)</span> : null}
      </Label>
      {control}
      {error ? (
        <p id={`${htmlFor}-error`} className="flex items-center gap-1.5 text-xs text-down-text">
          <CircleAlert size={14} aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p id={`${htmlFor}-helper`} className="text-xs text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
};
