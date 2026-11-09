import { ArrowLeft, Globe, Server, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioCards, type RadioCardItem } from "@/components/ui/radio-card";
import { useWizard, type MonitorType } from "@/features/setup/wizard-store";

const ITEMS: RadioCardItem[] = [
  { value: "http", title: "Website (HTTP)", description: "We open a URL every few minutes and check it answers with the right status, and text if you want.", icon: Globe },
  { value: "tcp", title: "Server port (TCP)", description: "We try to connect to a host and port, like a database or mail server. No request is sent.", icon: Server },
  { value: "heartbeat", title: "Cron job (Heartbeat)", description: "Your job calls a secret URL when it runs. If the call is late, we mark it down.", icon: Timer },
];

export const StepType = () => {
  const { type, setType, next, back } = useWizard();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">What should Edgebeat watch?</h1>
        <p className="text-sm text-muted">Pick one to start. You can add the other kinds later.</p>
      </div>
      <RadioCards aria-label="Monitor type" columns={3} items={ITEMS} value={type} onValueChange={(v) => setType(v as MonitorType)} />
      <div className="flex items-center justify-between">
        <Button variant="ghost" icon={ArrowLeft} onClick={back}>
          Back
        </Button>
        <Button onClick={next}>Continue</Button>
      </div>
    </div>
  );
};
