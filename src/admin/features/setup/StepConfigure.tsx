import { useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowLeft, CircleAlert, Globe, Server, Timer, type LucideIcon } from "lucide-react";
import { useSettings } from "@/api/use-settings";
import { useCreateMonitor } from "@/api/use-monitors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fieldErrors, isApiError } from "@/lib/api";
import { periodLabel } from "@/lib/format";
import { INTERVALS, monitorInput } from "@shared/monitor-schema";
import type { BudgetExceeded, Monitor } from "@shared/admin-api";
import { toMonitorCreate, useWizard, type MonitorType, type WizardDraft } from "@/features/setup/wizard-store";

const META: Record<MonitorType, { label: string; title: string; icon: LucideIcon }> = {
  http: { label: "Website (HTTP)", title: "Which website?", icon: Globe },
  tcp: { label: "Server port (TCP)", title: "Which server port?", icon: Server },
  heartbeat: { label: "Cron job (Heartbeat)", title: "Which job?", icon: Timer },
};

const intervalOptions = INTERVALS.map((n) => ({
  value: String(n),
  label: n === 60 ? "1 hour" : n === 1 ? "1 minute" : `${n} minutes`,
}));
const periodOptions = [300, 900, 1800, 3600, 21_600, 43_200, 86_400].map((s) => ({ value: String(s), label: periodLabel(s) }));
const graceOptions = [1, 5, 10, 30, 60].map((n) => ({ value: String(n), label: `${n} min` }));

const name = z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer.");
const base = {
  name,
  interval: z.string(),
  keywordOn: z.boolean(),
  keyword: z.string(),
  url: z.string(),
  host: z.string(),
  port: z.string(),
  period: z.string(),
  grace: z.string(),
};
const schemas: Record<MonitorType, z.ZodType<WizardDraft, WizardDraft>> = {
  http: z.object({
    ...base,
    url: z.string().trim().min(1, "Enter a URL."),
  }).refine((v) => !v.keywordOn || v.keyword.length > 0, { path: ["keyword"], message: "Enter the text the page must contain." }),
  tcp: z.object({
    ...base,
    host: z.string().trim().min(1, "Enter a host."),
    port: z.string().regex(/^\d+$/, "Enter a port from 1 to 65535.").refine((p) => Number(p) >= 1 && Number(p) <= 65_535, "Enter a port from 1 to 65535."),
  }),
  heartbeat: z.object(base),
};

// API issue paths -> form field names
const FIELD_OF: Record<string, keyof WizardDraft> = {
  name: "name", slug: "name", url: "url", host: "host", port: "port", keyword: "keyword",
  heartbeatPeriodS: "period", heartbeatGraceS: "grace", intervalMin: "interval",
};

const isSlugConflict = (e: unknown) => isApiError(e) && e.status === 409 && e.code === "slug_conflict";
const isBudget = (e: unknown): e is { body: BudgetExceeded } => isApiError(e) && e.code === "budget_exceeded" && !!e.body;

export const StepConfigure = () => {
  const { type, draft, patchDraft, setCreated, setCheck, next, back } = useWizard();
  const settings = useSettings();
  const create = useCreateMonitor();
  const [formError, setFormError] = useState<string | null>(null);
  const meta = META[type];
  const { register, control, handleSubmit, setError, getValues, watch, formState } = useForm<WizardDraft>({
    resolver: zodResolver(schemas[type]),
    defaultValues: draft,
  });
  const errors = formState.errors;
  const keywordOn = watch("keywordOn");

  const submit = async (values: WizardDraft) => {
    setFormError(null);
    patchDraft(values);
    const payload = toMonitorCreate(type, values);
    const parsed = monitorInput.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = FIELD_OF[String(issue.path[0])];
        if (key) setError(key, { message: issue.message });
      }
      return;
    }
    let created: Monitor | null = null;
    for (let n = 1; n <= 9 && !created; n++) {
      try {
        created = await create.mutateAsync(n === 1 ? payload : toMonitorCreate(type, values, `-${n}`));
      } catch (e) {
        if (isSlugConflict(e) && n < 9) continue;
        if (isBudget(e)) {
          const { after, budget } = e.body;
          setFormError(`This would raise your peak to ${after} checks per minute, above your budget of ${budget}. Pick a longer interval or raise the budget in Settings.`);
        } else if (isApiError(e)) {
          const fields = fieldErrors(e);
          const mapped = Object.entries(fields).filter(([k]) => FIELD_OF[k]);
          for (const [k, message] of mapped) setError(FIELD_OF[k]!, { message });
          if (mapped.length === 0) setFormError(e.code === "network" ? "Can't reach the Worker. Check your connection." : "Couldn't add the monitor. Try again.");
        }
        return;
      }
    }
    if (!created) return;
    setCheck(null);
    setCreated(created);
    next();
  };

  const onBack = () => {
    patchDraft(getValues());
    back();
  };

  const Icon = meta.icon;
  return (
    <form onSubmit={handleSubmit(submit)} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-2 text-xs font-medium text-accent-text">
          <Icon size={14} aria-hidden />
          {meta.label}
        </span>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">{meta.title}</h1>
      </div>
      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-down-border bg-down-bg p-3 text-sm text-down-text">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
          {formError}
        </p>
      ) : null}

      <Field label="Name" htmlFor="wz-name" helper="Shown on your status page." error={errors.name?.message}>
        <Input autoFocus placeholder={type === "heartbeat" ? "Nightly backup" : type === "tcp" ? "Mail server" : "Acme Store"} {...register("name")} />
      </Field>

      {type === "http" ? (
        <>
          <Field label="URL" htmlFor="wz-url" helper="We send a GET request and expect a status from 200 to 399." error={errors.url?.message}>
            <Input mono inputMode="url" placeholder="https://acmestore.com" {...register("url")} />
          </Field>
          <IntervalField control={control} budget={settings.data?.effectiveBudget} />
          <div className="flex flex-col gap-3 rounded-lg bg-surface-2 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="wz-keyword-on" className="flex items-center gap-2 text-sm font-medium text-text">
                  Check text on page <Badge className="normal-case">Optional</Badge>
                </label>
                <p className="text-xs text-muted">Catches error pages that still answer 200, like a blank shop.</p>
              </div>
              <Controller control={control} name="keywordOn" render={({ field }) => <Switch id="wz-keyword-on" checked={field.value} onCheckedChange={field.onChange} />} />
            </div>
            {keywordOn ? (
              <Field label="Page must contain" htmlFor="wz-keyword" helper="Case-sensitive. Redirects are followed for this check." error={errors.keyword?.message}>
                <Input placeholder="Add to cart" {...register("keyword")} />
              </Field>
            ) : null}
          </div>
        </>
      ) : null}

      {type === "tcp" ? (
        <>
          <Field label="Host" htmlFor="wz-host" helper="A public hostname or IP address." error={errors.host?.message}>
            <Input mono placeholder="mail.acme.dev" {...register("host")} />
          </Field>
          <Field label="Port" htmlFor="wz-port" error={errors.port?.message}>
            <Input mono inputMode="numeric" placeholder="587" {...register("port")} />
          </Field>
          <IntervalField control={control} budget={settings.data?.effectiveBudget} />
        </>
      ) : null}

      {type === "heartbeat" ? (
        <>
          <Field label="Expected every" htmlFor="wz-period" helper="How often your job should call the beat URL." error={errors.period?.message}>
            <Controller control={control} name="period" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} options={periodOptions} />} />
          </Field>
          <Field label="Grace" htmlFor="wz-grace" helper="How long we wait after a missed beat before marking it down." error={errors.grace?.message}>
            <Controller control={control} name="grace" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} options={graceOptions} />} />
          </Field>
        </>
      ) : null}

      <div className="flex items-center justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={formState.isSubmitting}>
          Add monitor
        </Button>
      </div>
    </form>
  );
};

type IntervalFieldProps = { control: Control<WizardDraft>; budget: number | undefined };

const IntervalField = ({ control, budget }: IntervalFieldProps) => (
  <Field label="Check every" htmlFor="wz-interval" helper={budget ? `Uses 1 of your ${budget} checks per minute.` : undefined}>
    <Controller control={control} name="interval" render={({ field }) => <Select value={field.value} onValueChange={field.onChange} options={intervalOptions} />} />
  </Field>
);
