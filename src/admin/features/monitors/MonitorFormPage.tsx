import { useParams, useSearchParams } from "react-router";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Link } from "react-router";
import { useMonitor } from "@/api/use-monitors";
import { isApiError } from "@/lib/api";
import { MonitorForm } from "@/features/monitors/MonitorForm";
import type { MonitorType } from "../../../core/types";

const isType = (v: string | null): v is MonitorType => v === "http" || v === "tcp" || v === "heartbeat";

const EditLoader = ({ id }: { id: string }) => {
  const { data, isPending, error } = useMonitor(id);
  if (isPending && !error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Edit monitor" breadcrumb={[{ label: "Monitors", to: "/monitors" }, { label: "…" }]} />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!data) {
    const missing = isApiError(error) && error.status === 404;
    return (
      <EmptyState
        illustration="error"
        title={missing ? "Monitor not found" : "Couldn't load the monitor"}
        body={missing ? "It may have been deleted." : "The admin API didn't answer. Try again in a moment."}
        actions={
          <Button asChild variant="secondary">
            <Link to="/monitors">Back to monitors</Link>
          </Button>
        }
      />
    );
  }
  return <MonitorForm key={data.id} monitor={data} initialType={data.type} />;
};

export default function MonitorFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  if (id) return <EditLoader id={id} />;
  const t = params.get("type");
  return <MonitorForm initialType={isType(t) ? t : "http"} />;
}
