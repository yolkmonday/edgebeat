import { Plus } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
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
        <>
          <Button
            variant="ghost"
            onClick={() => {
              resetSetup();
              navigate("/setup");
            }}
          >
            Run setup again
          </Button>
          <Button asChild>
            <Link to="/monitors/new">
              <Plus size={16} aria-hidden />
              Add monitor
            </Link>
          </Button>
        </>
      }
    />
  );
};
