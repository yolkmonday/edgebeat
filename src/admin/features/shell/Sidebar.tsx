import { NavLink, useMatch } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Activity, Folder, Globe, LayoutGrid, Settings, Timer, type LucideIcon } from "lucide-react";
import type { MonitorDetail, Session } from "@shared/admin-api";
import { qk } from "@/api/keys";
import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import { useUi } from "@/stores/ui";

type NavEntry = { to: string; label: string; icon: LucideIcon; end?: boolean; count?: (s: Session) => number };

const NAV: NavEntry[] = [
  { to: "/", label: "Overview", icon: LayoutGrid, end: true },
  { to: "/monitors", label: "Monitors", icon: Activity, count: (s) => s.counts.monitors },
  { to: "/heartbeats", label: "Heartbeats", icon: Timer, count: (s) => s.counts.heartbeats },
  { to: "/groups", label: "Groups", icon: Folder, count: (s) => s.counts.groups },
  { to: "/status-page", label: "Status page", icon: Globe },
  { to: "/settings", label: "Settings", icon: Settings },
];

/**
 * Heartbeats live under /monitors/:id too; light up "Heartbeats" instead of "Monitors" for them.
 * Reads the detail page's cached query without fetching (enabled: false).
 */
const useOnHeartbeat = () => {
  const match = useMatch("/monitors/:id/*");
  const id = match?.params.id && match.params.id !== "new" ? match.params.id : "";
  const { data } = useQuery<MonitorDetail>({ queryKey: qk.monitor(id), enabled: false });
  return id !== "" && data?.type === "heartbeat";
};

const planLabel = (plan: Session["plan"]) => (plan === "paid" ? "Paid" : "Free");

const SidebarContent = ({ session, onNavigate }: { session: Session; onNavigate?: () => void }) => {
  const onHeartbeat = useOnHeartbeat();
  const active = (to: string, isActive: boolean) => (to === "/monitors" ? isActive && !onHeartbeat : isActive || (to === "/heartbeats" && onHeartbeat));
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Logo wordmark />
      </div>
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1 px-3 py-3">
        {NAV.map(({ to, label, icon: Icon, end, count }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text",
                active(to, isActive) && "bg-surface-3 font-medium text-text",
              )
            }
          >
            <Icon size={16} aria-hidden />
            <span className="flex-1">{label}</span>
            {count ? <span className="font-mono text-xs text-muted tabular-nums">{count(session)}</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="flex flex-col gap-0.5 px-5 py-5 text-xs text-muted">
        <span className="font-mono">Edgebeat {session.version}</span>
        <span>{planLabel(session.plan)} plan · open source, MIT</span>
      </div>
    </div>
  );
};

/** Fixed rail from 1024 px, a left sheet below. */
export const Sidebar = ({ session }: { session: Session }) => {
  const open = useUi((s) => s.sidebarOpen);
  const setOpen = useUi((s) => s.setSidebarOpen);
  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent session={session} />
      </aside>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay lg:hidden" />
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-y-0 left-0 z-50 w-60 border-r border-border bg-surface shadow-xl lg:hidden"
          >
            <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
            <SidebarContent session={session} onNavigate={() => setOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
};
