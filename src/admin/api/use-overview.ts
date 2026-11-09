import { useQuery } from "@tanstack/react-query";
import type { Overview } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

export const useOverview = () =>
  useQuery({
    queryKey: qk.overview,
    queryFn: () => api.get<Overview>("/overview"),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
