import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Monitor, MonitorCreate, MonitorDetail, MonitorPatch, TestCheckResult } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

const invalidateMonitorData = (qc: QueryClient, id?: string) =>
  Promise.all([
    qc.invalidateQueries({ queryKey: qk.monitors }),
    ...(id ? [qc.invalidateQueries({ queryKey: qk.monitor(id) })] : []),
    qc.invalidateQueries({ queryKey: qk.overview }),
    qc.invalidateQueries({ queryKey: qk.session }),
    qc.invalidateQueries({ queryKey: qk.groups }),
    qc.invalidateQueries({ queryKey: qk.settings }),
  ]);

export const useMonitors = () =>
  useQuery({
    queryKey: qk.monitors,
    queryFn: () => api.get<Monitor[]>("/monitors"),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

/** 15 s polling; 5 s when `fast` is set or the monitor is still pending. */
export const useMonitor = (id: string, opts: { fast?: boolean } = {}) =>
  useQuery({
    queryKey: qk.monitor(id),
    queryFn: () => api.get<MonitorDetail>(`/monitors/${id}`),
    refetchInterval: (q) => (opts.fast || q.state.data?.status.state === "pending" ? 5_000 : 15_000),
    refetchIntervalInBackground: false,
  });

export const useCreateMonitor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MonitorCreate) => api.post<Monitor>("/monitors", input),
    onSuccess: (m) => invalidateMonitorData(qc, m.id),
  });
};

export const useUpdateMonitor = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: MonitorPatch) => api.patch<Monitor>(`/monitors/${id}`, patch),
    onSuccess: () => invalidateMonitorData(qc, id),
  });
};

export const useDeleteMonitor = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/monitors/${id}`),
    onSuccess: (_, id) => invalidateMonitorData(qc, id),
  });
};

export const useRotateToken = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Monitor>(`/monitors/${id}/rotate-token`),
    onSuccess: () => invalidateMonitorData(qc, id),
  });
};

export const useTestCheck = (id: string) =>
  useMutation({ mutationFn: () => api.post<TestCheckResult>(`/monitors/${id}/check`) });
