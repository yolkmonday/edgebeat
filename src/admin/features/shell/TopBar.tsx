import { useNavigate } from "react-router";
import { ExternalLink, LogOut, Menu } from "lucide-react";
import type { Session } from "@shared/admin-api";
import { useLogout } from "@/api/use-session";
import { Button } from "@/components/ui/button";
import { useUi } from "@/stores/ui";

export const TopBar = ({ session }: { session: Session }) => {
  const navigate = useNavigate();
  const logout = useLogout();
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  const onLogout = () => logout.mutate(undefined, { onSettled: () => navigate("/login") });
  return (
    <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <Button variant="ghost" size="sm" className="lg:hidden" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>
          <Menu size={16} aria-hidden />
        </Button>
        <span className="truncate text-sm font-medium text-text">{session.siteName}</span>
        <span className="hidden truncate font-mono text-xs text-muted sm:inline">{location.host}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* icon-only below 640 px so the site name keeps its room */}
        <Button asChild variant="secondary" size="sm" className="text-sm">
          <a href="/" target="_blank" rel="noopener" aria-label="View status page">
            <ExternalLink size={14} aria-hidden />
            <span className="hidden sm:inline">View status page</span>
          </a>
        </Button>
        <Button variant="ghost" size="sm" className="text-sm" icon={LogOut} loading={logout.isPending} onClick={onLogout} aria-label="Log out">
          <span className="hidden sm:inline">Log out</span>
        </Button>
      </div>
    </header>
  );
};
