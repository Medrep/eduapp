import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "ux.spec.ts",
  outputDir: "../../test-results/s5-admin-ux-results",
  forbidOnly: Boolean(process.env.CI),
  use: { ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: {
    cwd: new URL("../../", import.meta.url).pathname,
    command: "pnpm --filter @moja-nauka/admin exec vite build --outDir ../../test-results/s5-admin-ux-build --emptyOutDir && " +
      "pnpm --filter @moja-nauka/admin exec vite preview --outDir ../../test-results/s5-admin-ux-build --port 4274",
    url: "http://127.0.0.1:4274/",
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:5182", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_ux_fixture" },
  },
});
