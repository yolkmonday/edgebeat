import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => (!isApiError(e) || e.status >= 500 ? n < 2 : false),
    },
  },
});
