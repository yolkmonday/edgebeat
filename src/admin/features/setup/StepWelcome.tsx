import { useNavigate } from "react-router";
import { Illustration } from "@/components/shared/Illustration";
import { Button } from "@/components/ui/button";
import { useWizard } from "@/features/setup/wizard-store";
import { useUi } from "@/stores/ui";

export const StepWelcome = () => {
  const navigate = useNavigate();
  const dismissSetup = useUi((s) => s.dismissSetup);
  const next = useWizard((s) => s.next);
  const skip = () => {
    dismissSetup();
    navigate("/monitors");
  };
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <Illustration name="welcome" className="w-[200px]" />
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-text">Let's add your first monitor</h1>
        <p className="text-sm text-muted">
          Upflare checks it from your Cloudflare account and shows the result on your status page. Takes about a minute.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={skip}>
          Skip for now
        </Button>
        <Button onClick={next}>Start setup</Button>
      </div>
    </div>
  );
};
