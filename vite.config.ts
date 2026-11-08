import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/status-page",
  plugins: [tailwindcss()],
  build: { outDir: "../../dist/status-page", emptyOutDir: true },
});
