import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/api/use-session";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError, setUnauthorizedHandler } from "@/lib/api";
import { useUi } from "@/stores/ui";
import { Sidebar } from "@/features/shell/Sidebar";
import { TopBar } from "@/features/shell/TopBar";

const loginPath = (from: string) => `/login?next=${encodeURIComponent(from)}`;

const LayoutSkeleton = () => (
  <div className="flex min-h-screen">
    <div className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block" />
    <div className="flex flex-1 flex-col">
      <div className="h-16 border-b border-border bg-surface" />
      <div className="flex flex-col gap-4 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  </div>
);

export default function AppLayout() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const qc = useQueryClient();
  const session = useSession();
  const setupDismissed = useUi((s) => s.setupDismissed);
  const from = pathname + search;
  const unauthorized = session.isError && isApiError(session.error) && session.error.status === 401;

  useEffect(() => {
    setUnauthorizedHandler(() => {
      qc.clear();
      navigate(loginPath(from), { replace: true });
    });
  }, [qc, navigate, from]);

  useEffect(() => {
    if (unauthorized) navigate(loginPath(from), { replace: true });
  }, [unauthorized, navigate, from]);

  const counts = session.data?.counts;
  const empty = counts ? counts.monitors + counts.heartbeats === 0 : false;
  useEffect(() => {
    if (empty && !setupDismissed && pathname === "/") navigate("/setup", { replace: true });
  }, [empty, setupDismissed, pathname, navigate]);

  if (!session.data && session.isError && !unauthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <EmptyState
          illustration="error"
          title="Can't load the admin"
          body="The Worker didn't answer. Check your connection and try again."
          actions={<Button onClick={() => session.refetch()}>Retry</Button>}
        />
      </div>
    );
  }
  if (!session.data) return <LayoutSkeleton />;

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar session={session.data} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar session={session.data} />
        <main className="flex flex-1 flex-col gap-6 p-4 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
