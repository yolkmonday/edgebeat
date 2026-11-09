import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { Toaster } from "@/components/ui/toaster";
import { setUnauthorizedHandler } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { AppRoutes } from "@/routes";
import { useUi } from "@/stores/ui";

// any 401 outside /login means the session is gone: drop cached data and go sign in again
setUnauthorizedHandler(() => {
  if (location.pathname.startsWith("/admin/login")) return;
  queryClient.clear();
  location.assign("/admin/login");
});

const useThemeSync = () => {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
};

export const App = () => {
  useThemeSync();
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename="/admin">
        <AppRoutes />
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
};
