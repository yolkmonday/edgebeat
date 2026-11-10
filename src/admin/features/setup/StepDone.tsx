import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { ExternalLink, Globe, Loader2, Plus } from "lucide-react";
import type { Monitor } from "@shared/admin-api";
import { useTestCheck } from "@/api/use-monitors";
import { Illustration } from "@/components/shared/Illustration";
import { StatePill } from "@/components/shared/StatePill";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { errorLabel, intervalLabel, ms } from "@/lib/format";
import { useWizard } from "@/features/setup/wizard-store";
import { useUi } from "@/stores/ui";

const Actions = () => {
  const navigate = useNavigate();
  const reset = useWizard((s) => s.reset);
  const dismissSetup = useUi((s) => s.dismissSetup);
  return (
    <div className="flex items-center justify-center gap-2">
      <Button variant="ghost" icon={Plus} onClick={reset}>
        Add another
      </Button>
      <Button
        onClick={() => {
          dismissSetup();
          navigate("/");
        }}
      >
        Go to dashboard
      </Button>
    </div>
  );
};

const Heading = ({ title, body }: { title: string; body: string }) => (
  <div className="flex max-w-md flex-col gap-2">
    <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">{title}</h1>
    <p className="text-sm text-muted">{body}</p>
  </div>
);

const HeartbeatDone = ({ monitor }: { monitor: Monitor }) => (
  <div className="flex flex-col items-center gap-6 text-center">
    <Illustration name="heartbeat" className="w-[200px]" />
    <Heading title="Now call your beat URL" body={`${monitor.name} stays pending until your job calls this URL for the first time.`} />
    <div className="w-full text-left">
      <CodeBlock caption="Run this from your job" code={`curl -fsS ${monitor.beatUrl ?? ""}`} />
    </div>
    <Actions />
  </div>
);

const CheckDone = ({ monitor }: { monitor: Monitor }) => {
  const check = useWizard((s) => s.check);
  const setCheck = useWizard((s) => s.setCheck);
  const test = useTestCheck(monitor.id);
  const started = useRef(false);

  useEffect(() => {
    if (check || started.current) return;
    started.current = true;
    test.mutate(undefined, {
      onSuccess: setCheck,
      onError: () => setCheck({ ok: false, latencyMs: null, code: null, error: "other", at: Date.now() }),
    });
  }, [check, test, setCheck]);

  if (!check) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center" role="status">
        <Loader2 size={24} className="animate-spin text-accent" aria-hidden />
        <p className="text-sm text-muted">Running the first check…</p>
      </div>
    );
  }

  const detail = [check.latencyMs != null ? ms(check.latencyMs) : null, check.code != null ? String(check.code) : null].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <Illustration name={check.ok ? "done" : "error"} className="w-[200px]" />
      {check.ok ? (
        <Heading
          title="Your status page is ready"
          body={`${monitor.name} passed its first check. We'll check it every ${intervalLabel(monitor.intervalMin).replace(/^1 min$/, "minute")} from now on.`}
        />
      ) : (
        <Heading
          title={`${monitor.name} didn't pass its first check`}
          body={`${check.error ? `${errorLabel(check.error)}. ` : ""}Upflare keeps checking. It turns Down only after ${monitor.confirmations} failures in a row.`}
        />
      )}
      <div className="w-full overflow-hidden rounded-lg border border-border text-left">
        <div className="flex items-center gap-3 bg-surface px-4 py-3">
          <StatePill state={check.ok ? "up" : "down"} label={check.ok ? "Up" : "Down"} />
          <span className="flex-1 truncate text-sm text-text">{monitor.name}</span>
          {detail ? <span className="font-mono text-xs text-muted">{detail}</span> : null}
        </div>
        <div className="flex items-center gap-2 bg-surface-2 px-4 py-2">
          <Globe size={16} className="text-muted" aria-hidden />
          <span className="flex-1 truncate font-mono text-xs text-text">{location.host}</span>
          <Button asChild variant="secondary" size="sm">
            <a href="/" target="_blank" rel="noopener">
              <ExternalLink size={14} aria-hidden />
              Open status page
            </a>
          </Button>
        </div>
      </div>
      <Actions />
    </div>
  );
};

export const StepDone = () => {
  const created = useWizard((s) => s.created);
  if (!created) return null;
  return created.type === "heartbeat" ? <HeartbeatDone monitor={created} /> : <CheckDone monitor={created} />;
};
