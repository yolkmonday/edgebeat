import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isApiError, fieldErrors } from "@/lib/api";
import { useCreateMonitor } from "@/api/use-monitors";
import { budgetExceededMessage } from "@/features/monitors/budget-error";
import { DEFAULT_VALUES, slugify, toCreate, validateForm, type FormValues } from "@/features/monitors/form-mapping";
import { parseQuickAddress } from "@/features/monitors/parse-quick-address";

/** Single-line "type an address, press Enter" monitor creation. Everything else uses the full form's defaults. */
export const QuickAdd = ({ autoFocus }: { autoFocus?: boolean }) => {
  const id = useId();
  const navigate = useNavigate();
  const create = useCreateMonitor();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = create.isPending;
  const wasPending = useRef(false);
  // a disabled input drops focus; give it back so several addresses can be added in a row
  useEffect(() => {
    if (wasPending.current && !pending) inputRef.current?.focus();
    wasPending.current = pending;
  }, [pending]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const parsed = parseQuickAddress(value);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const t = parsed.target;
    const values: FormValues = {
      ...DEFAULT_VALUES,
      type: t.type,
      name: t.hostname,
      slug: slugify(t.type === "tcp" ? `${t.hostname}-${t.port}` : t.hostname),
      ...(t.type === "http" ? { url: t.url } : { host: t.host, port: String(t.port) }),
    };
    const problems = Object.values(validateForm(values));
    if (problems.length > 0) {
      setError(problems[0] ?? "Couldn't add that address");
      return;
    }
    setError(null);
    try {
      const created = await create.mutateAsync(toCreate(values));
      setValue("");
      toast.success(`Added ${created.name}`, { action: { label: "Edit", onClick: () => navigate(`/monitors/${created.id}/edit`) } });
    } catch (err) {
      if (!isApiError(err)) return setError("Something went wrong. Try again.");
      const budget = budgetExceededMessage(err);
      if (budget) return setError(budget);
      if (err.code === "slug_conflict") return setError(`You already have a monitor named ${values.name}.`);
      if (err.status === 0) return setError("Can't reach the server. Check your connection.");
      const first = Object.values(fieldErrors(err))[0];
      setError(first ?? `Couldn't add it (${err.code}).`);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Quick add" htmlFor={id} error={error ?? undefined} hideLabel>
            <Input
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              ref={inputRef}
              autoFocus={autoFocus}
              placeholder="example.com or db.example.com:5432"
              value={value}
              disabled={create.isPending}
              onChange={(e) => {
                setValue(e.target.value);
                if (error) setError(null);
              }}
            />
          </Field>
        </div>
        <Button type="submit" loading={create.isPending} disabled={value.trim() === ""}>
          <Plus size={16} aria-hidden />
          Add
        </Button>
      </div>
    </form>
  );
};
