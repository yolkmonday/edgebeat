import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Plus, X } from "lucide-react";
import { useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Monitor } from "@shared/admin-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SwitchCard } from "@/components/ui/switch-card";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/shared/PageHeader";
import { useGroups } from "@/api/use-groups";
import { useCreateMonitor, useUpdateMonitor } from "@/api/use-monitors";
import { useSettings } from "@/api/use-settings";
import { fieldErrors, isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BudgetCard } from "@/features/monitors/BudgetCard";
import { DownExplainer } from "@/features/monitors/DownExplainer";
import { explainInputFromForm } from "@/features/monitors/down-explainer";
import {
  DEFAULT_VALUES,
  INTERVAL_OPTIONS,
  formField,
  fromMonitor,
  slugify,
  toCreate,
  toPatch,
  validateForm,
  type FormValues,
  type TimeUnit,
} from "@/features/monitors/form-mapping";
import type { MonitorType } from "../../../core/types";

const resolver: Resolver<FormValues> = async (values) => {
  const errors = validateForm(values);
  const keys = Object.keys(errors);
  if (keys.length === 0) return { values, errors: {} };
  return {
    values: {},
    errors: Object.fromEntries(keys.map((k) => [k, { type: "validate", message: errors[k] }])) as FieldErrors<FormValues>,
  };
};

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map((m) => ({ value: m, label: m }));
const KEYWORD_MODES = [
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
];
const UNITS = [
  { value: "min", label: "minutes" },
  { value: "h", label: "hours" },
];
const NO_GROUP = "__none";
const TYPE_ITEMS = [
  { value: "http", label: "HTTP" },
  { value: "tcp", label: "TCP" },
  { value: "heartbeat", label: "Heartbeat" },
];
const TITLES: Record<MonitorType, string> = { http: "Add monitor", tcp: "Add monitor", heartbeat: "Add heartbeat" };

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-4 border-b border-border p-6 last:border-b-0">
    <h2 className="text-lg font-semibold tracking-[-0.01em] text-text">{title}</h2>
    {children}
  </section>
);

type DurationInputProps = {
  id?: string;
  invalid?: boolean;
  "aria-describedby"?: string;
  value: string;
  onValueChange: (v: string) => void;
  unit: TimeUnit;
  onUnitChange: (u: TimeUnit) => void;
};

/** Number + unit Select. Accepts the props `Field` injects into its child. */
const DurationInput = ({ id, invalid, value, onValueChange, unit, onUnitChange, ...aria }: DurationInputProps) => (
  <div className="grid grid-cols-[1fr_8rem] gap-2">
    <Input id={id} mono invalid={invalid} inputMode="decimal" aria-describedby={aria["aria-describedby"]} value={value} onChange={(e) => onValueChange(e.target.value)} />
    <Select aria-describedby={undefined} value={unit} onValueChange={(u) => onUnitChange(u as TimeUnit)} options={UNITS} invalid={invalid} />
  </div>
);

export type MonitorFormProps = { monitor?: Monitor; initialType: MonitorType };

export const MonitorForm = ({ monitor, initialType }: MonitorFormProps) => {
  const navigate = useNavigate();
  const groups = useGroups();
  const settings = useSettings();
  const create = useCreateMonitor();
  const update = useUpdateMonitor(monitor?.id ?? "");
  const [serverError, setServerError] = useState<string | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const slugTouched = useRef(Boolean(monitor));
  const allowLeave = useRef(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isDirty, isSubmitting, isSubmitted },
  } = useForm<FormValues>({
    defaultValues: monitor ? fromMonitor(monitor) : { ...DEFAULT_VALUES, type: initialType },
    resolver,
    reValidateMode: "onChange",
  });
  const v = watch();

  // in-app navigation can't be blocked in declarative mode; at least guard tab close / reload
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (allowLeave.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValue(key as never, value as never, { shouldDirty: true, shouldValidate: isSubmitted });

  const err = (key: keyof FormValues): string | undefined => (errors as Record<string, { message?: string } | undefined>)[key]?.message;
  const errorCount = Object.keys(errors).length;

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (monitor) {
        const patch = toPatch(values, monitor);
        if (Object.keys(patch).length === 0) {
          allowLeave.current = true;
          toast.success("No changes to save");
          navigate(`/monitors/${monitor.id}`);
          return;
        }
        await update.mutateAsync(patch);
        allowLeave.current = true;
        toast.success("Changes saved");
        navigate(`/monitors/${monitor.id}`);
        return;
      }
      const created = await create.mutateAsync(toCreate(values));
      allowLeave.current = true;
      toast.success("Monitor added");
      navigate(`/monitors/${created.id}`);
    } catch (e) {
      if (!isApiError(e)) {
        setServerError("Something went wrong. Try again.");
        return;
      }
      if (e.code === "budget_exceeded") {
        const after = e.body?.after;
        const budget = e.body?.budget;
        setServerError(`Over your check budget: ${after ?? "?"} of ${budget ?? "?"} per minute. Raise intervals or switch to the Paid plan in Settings.`);
        return;
      }
      const mapped = Object.entries(fieldErrors(e));
      mapped.forEach(([path, message]) => setError(formField(path) as keyof FormValues, { type: "server", message }));
      setServerError(mapped.length > 0 ? null : e.status === 0 ? "Can't reach the server. Check your connection." : `Couldn't save (${e.code}).`);
    }
  });

  const cancel = () => (isDirty ? setDiscardOpen(true) : navigate(monitor ? `/monitors/${monitor.id}` : "/monitors"));

  const type = v.type;
  const noBody = v.method === "GET" || v.method === "HEAD";
  const counted = Boolean(monitor && monitor.type !== "heartbeat" && !monitor.paused);
  const exempt = type === "heartbeat" ? "heartbeat" : v.paused ? "paused" : null;
  const adds: 0 | 1 = exempt || counted ? 0 : 1;

  const groupOptions = [{ value: NO_GROUP, label: "No group" }, ...(groups.data ?? []).map((g) => ({ value: g.id, label: g.name }))];
  const breadcrumb = monitor
    ? [
        { label: monitor.type === "heartbeat" ? "Heartbeats" : "Monitors", to: monitor.type === "heartbeat" ? "/heartbeats" : "/monitors" },
        { label: monitor.name, to: `/monitors/${monitor.id}` },
        { label: "Edit" },
      ]
    : [{ label: "Monitors", to: "/monitors" }, { label: "New" }];

  const footerMessage = serverError ?? (isSubmitted && errorCount > 0 ? `Fix ${errorCount} field${errorCount === 1 ? "" : "s"} to save` : null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={monitor ? `Edit ${monitor.name}` : TITLES[initialType]} breadcrumb={breadcrumb} />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,772px)_340px]">
        <form onSubmit={onSubmit} noValidate className="overflow-clip rounded-lg border border-border bg-surface shadow-[0_1px_2px_var(--shadow)] dark:shadow-[0_0_0_1px_var(--dark-ring)]">
          <Section title="Type">
            {monitor ? (
              <div>
                <Badge variant="accent">{monitor.type}</Badge>
              </div>
            ) : (
              <div>
                <Tabs aria-label="Monitor type" value={type} onValueChange={(t) => set("type", t as MonitorType)} items={TYPE_ITEMS} />
              </div>
            )}
          </Section>

          <Section title="Basics">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" helper="Shown on your status page." error={err("name")}>
                <Input
                  autoFocus={!monitor}
                  {...register("name", {
                    onChange: (e) => {
                      if (!slugTouched.current) set("slug", e.target.value.trim() ? slugify(e.target.value) : "");
                    },
                  })}
                />
              </Field>
              <Field label="Slug" htmlFor="slug" helper="Lowercase letters, numbers and dashes." error={err("slug")}>
                <Input mono {...register("slug", { onChange: () => (slugTouched.current = true) })} />
              </Field>
            </div>
            <Field label="Group" htmlFor="groupId" helper="Monitors in one group are listed together on the status page." error={err("groupId")}>
              <Select value={v.groupId || NO_GROUP} onValueChange={(g) => set("groupId", g === NO_GROUP ? "" : g)} options={groupOptions} />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SwitchCard title="Show on status page" description="Off keeps it private to this admin." checked={v.isPublic} onCheckedChange={(c) => set("isPublic", c)} />
              <SwitchCard title="Paused" description="Stops checks without deleting history." checked={v.paused} onCheckedChange={(c) => set("paused", c)} />
            </div>
          </Section>

          <Section title="Check">
            {type === "http" ? (
              <>
                <Field label="URL" htmlFor="url" error={err("url")}>
                  <Input mono placeholder="https://example.com/health" autoComplete="off" {...register("url")} />
                </Field>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Method" htmlFor="method" helper="HEAD is lighter if you skip the text check." error={err("method")}>
                    <Select value={v.method} onValueChange={(m) => set("method", m)} options={METHODS} />
                  </Field>
                  <Field label="Expected status" htmlFor="expectedStatus" helper="Codes or ranges, comma separated." error={err("expectedStatus")}>
                    <Input mono {...register("expectedStatus")} />
                  </Field>
                  <Field label="Timeout (s)" htmlFor="timeoutS" helper="Up to 30 seconds." error={err("timeoutS")}>
                    <Input mono inputMode="decimal" {...register("timeoutS")} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <IntervalField v={v} set={set} error={err("intervalMin")} />
                  <ConfirmationsField error={err("confirmations")} register={register} />
                  <Field label="Degraded after (ms)" htmlFor="degradedMs" optional helper="Slower answers show as Degraded." error={err("degradedMs")}>
                    <Input mono inputMode="numeric" {...register("degradedMs")} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_14rem]">
                  <Field label="Keyword" htmlFor="keyword" optional helper="Turns on follow redirects." error={err("keyword")}>
                    <Input mono {...register("keyword")} />
                  </Field>
                  <Field label="Keyword mode" htmlFor="keywordMode" helper="Or: does not contain." error={err("keywordMode")}>
                    <Select value={v.keywordMode} onValueChange={(m) => set("keywordMode", m as FormValues["keywordMode"])} options={KEYWORD_MODES} />
                  </Field>
                </div>
              </>
            ) : null}

            {type === "tcp" ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem]">
                  <Field label="Host" htmlFor="host" error={err("host")}>
                    <Input mono placeholder="mail.example.com" autoComplete="off" {...register("host")} />
                  </Field>
                  <Field label="Port" htmlFor="port" error={err("port")}>
                    <Input mono inputMode="numeric" {...register("port")} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Timeout (s)" htmlFor="timeoutS" helper="Up to 30 seconds." error={err("timeoutS")}>
                    <Input mono inputMode="decimal" {...register("timeoutS")} />
                  </Field>
                  <IntervalField v={v} set={set} error={err("intervalMin")} />
                  <ConfirmationsField error={err("confirmations")} register={register} />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Degraded after (ms)" htmlFor="degradedMs" optional helper="Slower connects show as Degraded." error={err("degradedMs")}>
                    <Input mono inputMode="numeric" {...register("degradedMs")} />
                  </Field>
                </div>
              </>
            ) : null}

            {type === "heartbeat" ? (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Expected every" htmlFor="periodValue" helper="How often your job should report. At least 1 minute." error={err("periodValue")}>
                    <DurationInput value={v.periodValue} onValueChange={(x) => set("periodValue", x)} unit={v.periodUnit} onUnitChange={(u) => set("periodUnit", u)} />
                  </Field>
                  <Field label="Grace" htmlFor="graceValue" helper="Extra time before a late beat counts." error={err("graceValue")}>
                    <DurationInput value={v.graceValue} onValueChange={(x) => set("graceValue", x)} unit={v.graceUnit} onUnitChange={(u) => set("graceUnit", u)} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <IntervalField v={v} set={set} error={err("intervalMin")} helper="How often we look for a late beat." />
                  <ConfirmationsField error={err("confirmations")} register={register} helper="Late checks in a row before Down (1-10)." />
                </div>
              </>
            ) : null}
          </Section>

          {type === "http" ? (
            <section className="border-b border-border p-6">
              <Collapsible title={<span className="flex items-baseline gap-3">Advanced <span className="text-xs font-normal text-muted">Request headers, body, follow redirects ({v.followRedirects ? "on" : "off"})</span></span>} defaultOpen={Boolean(monitor && (!noBody || v.headers.length > 0 || v.followRedirects))}>
                <div className="flex flex-col gap-4 pt-1">
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium text-text">Request headers</span>
                    {v.headers.map((row, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                        <Input mono aria-label={`Header ${i + 1} name`} placeholder="X-Api-Key" value={row.key} onChange={(e) => set("headers", v.headers.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                        <Input mono aria-label={`Header ${i + 1} value`} placeholder="value" value={row.value} onChange={(e) => set("headers", v.headers.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
                        <Button variant="ghost" size="sm" aria-label={`Remove header ${i + 1}`} onClick={() => set("headers", v.headers.filter((_, j) => j !== i))}>
                          <X size={14} aria-hidden />
                        </Button>
                      </div>
                    ))}
                    {err("headers") ? (
                      <p className="flex items-center gap-1.5 text-xs text-down-text">
                        <CircleAlert size={14} aria-hidden />
                        {err("headers")}
                      </p>
                    ) : null}
                    <div>
                      <Button variant="secondary" size="sm" icon={Plus} onClick={() => set("headers", [...v.headers, { key: "", value: "" }])}>
                        Add header
                      </Button>
                    </div>
                  </div>
                  <Field label="Body" htmlFor="body" optional helper={noBody ? "GET and HEAD requests don't send a body." : "Sent as-is with the request."} error={err("body")}>
                    <Textarea mono disabled={noBody} {...register("body")} />
                  </Field>
                  <div className="flex items-center gap-3">
                    <Switch id="followRedirects" checked={v.followRedirects} onCheckedChange={(c) => set("followRedirects", c)} />
                    <label htmlFor="followRedirects" className="text-sm text-text">
                      Follow redirects
                    </label>
                  </div>
                </div>
              </Collapsible>
            </section>
          ) : null}

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-2 px-6 py-4">
            <p role="alert" className={cn("flex min-h-5 items-center gap-1.5 text-xs text-down-text", !footerMessage && "invisible")}>
              {footerMessage ? <CircleAlert size={14} aria-hidden className="shrink-0" /> : null}
              {footerMessage}
            </p>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting || create.isPending || update.isPending}>
                {monitor ? "Save changes" : "Save monitor"}
              </Button>
            </div>
          </div>
        </form>

        <aside className="flex flex-col gap-4">
          <BudgetCard used={settings.data?.checksPerMinute} budget={settings.data?.effectiveBudget} adds={adds} exempt={exempt} />
          <DownExplainer input={explainInputFromForm(v)} />
        </aside>
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard changes?"
        body="You have unsaved changes. If you leave now they are lost."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          allowLeave.current = true;
          navigate(monitor ? `/monitors/${monitor.id}` : "/monitors");
        }}
      />
    </div>
  );
};

type SetFn = <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;

const IntervalField = ({ v, set, error, helper = "1, 2, 3, 5, 10, 15, 30 or 60 min." }: { v: FormValues; set: SetFn; error?: string; helper?: string }) => (
  <Field label="Check every" htmlFor="intervalMin" helper={helper} error={error}>
    <Select value={v.intervalMin} onValueChange={(x) => set("intervalMin", x)} options={INTERVAL_OPTIONS} />
  </Field>
);

const ConfirmationsField = ({
  error,
  register,
  helper = "Failed checks in a row before Down (1-10).",
}: {
  error?: string;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  helper?: string;
}) => (
  <Field label="Confirmations" htmlFor="confirmations" helper={helper} error={error}>
    <Input mono inputMode="numeric" {...register("confirmations")} />
  </Field>
);
