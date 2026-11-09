import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router";

// Route table (fixed in task 0). Each page module is owned by a later task; replace the module, not this file.
const LoginPage = lazy(() => import("@/features/auth/LoginPage"));
const SetupPage = lazy(() => import("@/features/setup/SetupPage"));
const AppLayout = lazy(() => import("@/features/shell/AppLayout"));
const NotFoundPage = lazy(() => import("@/features/shell/NotFoundPage"));
const OverviewPage = lazy(() => import("@/features/overview/OverviewPage"));
const MonitorsPage = lazy(() => import("@/features/monitors/MonitorsPage"));
const HeartbeatsPage = lazy(() => import("@/features/monitors/HeartbeatsPage"));
const MonitorFormPage = lazy(() => import("@/features/monitors/MonitorFormPage"));
const MonitorDetailPage = lazy(() => import("@/features/monitors/MonitorDetailPage"));
const GroupsPage = lazy(() => import("@/features/groups/GroupsPage"));
const StatusPageSettingsPage = lazy(() => import("@/features/status-page/StatusPageSettingsPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const EventsPage = lazy(() => import("@/features/events/EventsPage"));

export const AppRoutes = () => (
  <Suspense fallback={null}>
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="setup" element={<SetupPage />} />
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="monitors" element={<MonitorsPage />} />
        <Route path="heartbeats" element={<HeartbeatsPage />} />
        <Route path="monitors/new" element={<MonitorFormPage />} />
        <Route path="monitors/:id" element={<MonitorDetailPage />} />
        <Route path="monitors/:id/edit" element={<MonitorFormPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="status-page" element={<StatusPageSettingsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  </Suspense>
);
