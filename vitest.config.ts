import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations("migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // bundled workerd lags behind the production compatibility date
        compatibilityDate: "2026-08-22",
        bindings: {
          TEST_MIGRATIONS: migrations,
          ADMIN_PASSWORD: "test-password",
          ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        },
      },
    }),
  ],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    include: ["test/worker/**/*.spec.ts"],
    globalSetup: ["./test/worker/global-setup.ts"],
    setupFiles: ["./test/worker/apply-migrations.ts"],
  },
});
