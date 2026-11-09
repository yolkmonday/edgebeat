import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Group, GroupCreate, GroupPatch } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

const invalidateGroupData = (qc: QueryClient) =>
  Promise.all([qk.groups, qk.monitors, qk.session].map((queryKey) => qc.invalidateQueries({ queryKey })));

export const useGroups = () => useQuery({ queryKey: qk.groups, queryFn: () => api.get<Group[]>("/groups") });

export const useCreateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GroupCreate) => api.post<Group>("/groups", input),
    onSuccess: () => invalidateGroupData(qc),
  });
};

export const useUpdateGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: GroupPatch }) => api.patch<Group>(`/groups/${id}`, patch),
    onSuccess: () => invalidateGroupData(qc),
  });
};

export const useDeleteGroup = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/groups/${id}`),
    onSuccess: () => invalidateGroupData(qc),
  });
};
