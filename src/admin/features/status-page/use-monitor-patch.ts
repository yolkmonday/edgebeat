import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Monitor, MonitorPatch } from "@shared/admin-api";
import { qk } from "@/api/keys";
import { api } from "@/lib/api";

/** PATCH any monitor by id (the shared `useUpdateMonitor` is bound to a single id). */
export const useMonitorPatch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: MonitorPatch }) => api.patch<Monitor>(`/monitors/${id}`, patch),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.monitors }),
  });
};
