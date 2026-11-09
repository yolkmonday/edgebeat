import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import type { ApiTokenCreated } from "@shared/admin-api";
import { useCreateToken } from "@/api/use-tokens";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioCards } from "@/components/ui/radio-card";
import { isApiError } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(60, "Use 60 characters or fewer."),
  scope: z.enum(["read", "admin"]),
});
type FormValues = z.infer<typeof schema>;

const SCOPES = [
  { value: "read", title: "Read", description: "List and read everything.", icon: Eye },
  { value: "admin", title: "Admin", description: "Full access, including changes.", icon: ShieldCheck },
];
const FORM_ID = "create-token-form";

const CreatedToken = ({ created, onDone }: { created: ApiTokenCreated; onDone: () => void }) => (
  <>
    <div className="flex flex-col gap-3">
      <p role="alert" className="flex items-start gap-2 rounded-md border border-degraded-border bg-degraded-bg p-3 text-xs text-degraded-text">
        <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
        Copy it now. You won&apos;t see it again.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-text" data-testid="new-token">
          {created.token}
        </code>
        <CopyButton value={created.token} variant="primary" />
      </div>
      <CodeBlock caption="Use it as a header" code={`Authorization: Bearer ${created.token}`} />
    </div>
    <div className="flex justify-end">
      <Button onClick={onDone}>Done</Button>
    </div>
  </>
);

const CreateForm = ({ onDone }: { onDone: () => void }) => {
  const create = useCreateToken();
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { name: "", scope: "read" } });

  if (created) return <CreatedToken created={created} onDone={onDone} />;

  const onSubmit = (values: FormValues) =>
    create.mutate(values, {
      onSuccess: setCreated,
      onError: (e) =>
        toast.error("Couldn't create the token", {
          description: isApiError(e) && e.code === "too_many_tokens" ? "You can have up to 20 tokens. Revoke one first." : undefined,
        }),
    });

  return (
    <>
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <Field label="Name" htmlFor="token-name" helper="So you remember where it is used, for example CI or Grafana." error={errors.name?.message}>
          <Input autoFocus autoComplete="off" {...register("name")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Scope</span>
          <Controller
            control={control}
            name="scope"
            render={({ field }) => <RadioCards aria-label="Scope" columns={2} items={SCOPES} value={field.value} onValueChange={field.onChange} />}
          />
        </div>
      </form>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" form={FORM_ID} loading={create.isPending}>
          Create token
        </Button>
      </div>
    </>
  );
};

export const CreateTokenDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent title="Create API token" className="max-w-lg">
      <CreateForm onDone={() => onOpenChange(false)} />
    </DialogContent>
  </Dialog>
);
