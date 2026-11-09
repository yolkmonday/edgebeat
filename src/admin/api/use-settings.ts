import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Settings, SettingsPatch } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.get<Settings>("/settings") });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<Settings>("/settings", patch),
    onSuccess: () => Promise.all([qk.settings, qk.session, qk.overview].map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
};
