import { useInfiniteQuery } from "@tanstack/react-query";
import type { EventsPage } from "@shared/admin-api";
import { api } from "@/lib/api";
import { qk } from "@/api/keys";

export const useEvents = (filter: { monitorId?: string } = {}) =>
  useInfiniteQuery({
    queryKey: qk.events(filter),
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (filter.monitorId) params.set("monitorId", filter.monitorId);
      if (pageParam != null) params.set("before", String(pageParam));
      const qs = params.toString();
      return api.get<EventsPage>(`/events${qs ? `?${qs}` : ""}`);
    },
    getNextPageParam: (last) => last.nextBefore,
  });
