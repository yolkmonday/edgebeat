import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { QuickAdd } from "@/features/monitors/QuickAdd";
import { useUi } from "@/stores/ui";

export const MonitorsEmpty = () => {
  const navigate = useNavigate();
  const resetSetup = useUi((s) => s.resetSetup);
  return (
    <EmptyState
      size="lg"
      illustration="empty-monitors"
      title="No monitors yet"
      body="Add a website, a server port or a cron job. Until the first check runs, your status page shows Status unknown."
      actions={
        <div className="flex w-full max-w-md flex-col gap-4 text-left">
          <QuickAdd autoFocus />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="secondary">
              <Link to="/monitors/new">More options</Link>
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                resetSetup();
                navigate("/setup");
              }}
            >
              Run setup again
            </Button>
          </div>
        </div>
      }
    />
  );
};
