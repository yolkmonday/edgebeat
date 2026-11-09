import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "system" | "light" | "dark";

type UiState = {
  theme: Theme;
  setupDismissed: boolean;
  sidebarOpen: boolean;
  setTheme: (theme: Theme) => void;
  dismissSetup: () => void;
  resetSetup: () => void;
  setSidebarOpen: (open: boolean) => void;
};

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: "system",
      setupDismissed: false,
      sidebarOpen: false,
      setTheme: (theme) => set({ theme }),
      dismissSetup: () => set({ setupDismissed: true }),
      resetSetup: () => set({ setupDismissed: false }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: "edgebeat-admin-ui",
      partialize: ({ theme, setupDismissed }) => ({ theme, setupDismissed }),
    },
  ),
);
