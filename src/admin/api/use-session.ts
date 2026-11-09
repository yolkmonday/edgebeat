import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

export const useSession = () =>
  useQuery({ queryKey: qk.session, queryFn: () => api.get<Session>("/session"), retry: false });

export const useLogin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<void>("/login", { password }),
    onSuccess: () => qc.invalidateQueries(),
  });
};

export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>("/logout"),
    onSuccess: () => qc.clear(),
  });
};
