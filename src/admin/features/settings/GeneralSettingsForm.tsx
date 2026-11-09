import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Cloud, Lock, TriangleAlert, Zap } from "lucide-react";
import { toast } from "sonner";
import type { Settings } from "@shared/admin-api";
import { useUpdateSettings } from "@/api/use-settings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioCards } from "@/components/ui/radio-card";
import { fieldErrors, isApiError } from "@/lib/api";
import {
  DEFAULT_PAID_BUDGET,
  FREE_CHECK_LIMIT,
  MAX_CHECK_BUDGET,
  overFreeLimit,
  settingsFormSchema,
  toFormValues,
  toPatch,
  type SettingsFormValues,
} from "@/features/settings/settings-form";

const PLAN_ITEMS = [
  {
    value: "free",
    title: "Free",
    description: `Workers Free. 100k requests and 100k D1 writes a day. Checks are capped at ${FREE_CHECK_LIMIT} per minute.`,
    icon: Cloud,
  },
  {
    value: "paid",
    title: "Paid",
    description: "Workers Paid on your Cloudflare account. Higher daily limits, so you can raise the check budget.",
    icon: Zap,
  },
];

const Section = ({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-4 p-6">
    <div className="flex flex-col gap-1">
      <h3 className="text-base font-semibold text-text">{title}</h3>
      {description ? <p className="text-xs text-muted">{description}</p> : null}
    </div>
    {children}
  </div>
);

export const GeneralSettingsForm = ({ settings }: { settings: Settings }) => {
  const update = useUpdateSettings();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isDirty },
  } = useForm<SettingsFormValues>({ resolver: zodResolver(settingsFormSchema), defaultValues: toFormValues(settings) });

  // Pick up server-side changes (e.g. after a monitor edit) while the form is clean.
  useEffect(() => {
    if (!isDirty) reset(toFormValues(settings));
  }, [settings, isDirty, reset]);

  const plan = watch("plan");

  const onSubmit = (values: SettingsFormValues) => {
    const patch = toPatch(values, settings);
    if (Object.keys(patch).length === 0) return void toast.info("No changes to save");
    update.mutate(patch, {
      onSuccess: (saved) => {
        reset(toFormValues(saved));
        toast.success("Settings saved");
      },
      onError: (e) => {
        if (!isApiError(e)) return void toast.error("Couldn't save settings");
        const mapped = fieldErrors(e);
        const keys = (["siteName", "checkBudget"] as const).filter((k) => mapped[k]);
        if (keys.length === 0) return void toast.error("Couldn't save settings", { description: e.code });
        keys.forEach((k) => setError(k, { message: mapped[k] }));
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-[760px]">
      <Card
        footer={
          <>
            <Button variant="ghost" disabled={!isDirty} onClick={() => reset(toFormValues(settings))}>
              Discard
            </Button>
            <Button type="submit" loading={update.isPending} disabled={!isDirty}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="-m-6 divide-y divide-border">
          <Section title="Status page">
            <Field label="Site name" htmlFor="site-name" helper="Shown at the top of your status page and in the browser tab." error={errors.siteName?.message}>
              <Input autoComplete="off" {...register("siteName")} />
            </Field>
          </Section>

          <Section title="Cloudflare plan" description="Pick the Workers plan your Cloudflare account is on. Edgebeat uses it to keep you inside the limits.">
            <Controller
              control={control}
              name="plan"
              render={({ field }) => (
                <RadioCards aria-label="Cloudflare plan" columns={2} items={PLAN_ITEMS} value={field.value} onValueChange={field.onChange} />
              )}
            />
          </Section>

          <Section title="Check budget" description="The most checks Edgebeat runs in one minute, across all monitors. New monitors that would go over it can't be saved.">
            <div className="max-w-80">
              {plan === "free" ? (
                <Field
                  label="Checks per minute"
                  htmlFor="check-budget"
                  helper={`Locked at ${FREE_CHECK_LIMIT}, the Free plan maximum. ${settings.checksPerMinute} in use right now.`}
                >
                  <Input mono disabled readOnly value={String(FREE_CHECK_LIMIT)} trailing={<Lock size={16} aria-hidden />} />
                </Field>
              ) : (
                <Field
                  label="Checks per minute"
                  htmlFor="check-budget"
                  helper={`${settings.checksPerMinute} in use right now. Leave empty for the default of ${DEFAULT_PAID_BUDGET}.`}
                  error={errors.checkBudget?.message}
                >
                  <Input mono type="number" min={1} max={MAX_CHECK_BUDGET} step={1} inputMode="numeric" placeholder={String(DEFAULT_PAID_BUDGET)} {...register("checkBudget")} />
                </Field>
              )}
            </div>
            {overFreeLimit(plan, settings.checksPerMinute) ? (
              <p role="status" className="flex items-start gap-2 rounded-md border border-degraded-border bg-degraded-bg p-3 text-xs text-degraded-text">
                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                You run {settings.checksPerMinute} checks per minute, more than the Free limit of {FREE_CHECK_LIMIT}. Some checks will wait for the next minute until you raise intervals or pause monitors.
              </p>
            ) : null}
          </Section>
        </div>
      </Card>
    </form>
  );
};
