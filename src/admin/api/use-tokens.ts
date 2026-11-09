import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiToken, ApiTokenCreate, ApiTokenCreated } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

export const useTokens = () => useQuery({ queryKey: qk.tokens, queryFn: () => api.get<ApiToken[]>("/tokens") });

export const useCreateToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApiTokenCreate) => api.post<ApiTokenCreated>("/tokens", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
};

export const useDeleteToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.tokens }),
  });
};
