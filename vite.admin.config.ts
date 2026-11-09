import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const worker = "http://localhost:8787";

// Built after the status page (vite.config.ts), which empties dist/status-page.
export default defineConfig({
  root: "src/admin",
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": new URL("./src/admin", import.meta.url).pathname,
      "@shared": new URL("./src/shared", import.meta.url).pathname,
    },
  },
  build: { outDir: "../../dist/status-page/admin", emptyOutDir: true, sourcemap: false },
  server: {
    // the Worker's Origin check compares against its own origin
    proxy: {
      "/api": { target: worker, headers: { origin: worker } },
      "/beat": { target: worker, headers: { origin: worker } },
    },
  },
});
