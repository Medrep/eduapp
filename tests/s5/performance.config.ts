import { defineConfig, devices } from "@playwright/test";

const build = process.env.MOJA_S5_PERF_BUILD;
if (!build || !/^\/[\w./-]+$/.test(build)) {
  throw new Error("Set MOJA_S5_PERF_BUILD to the absolute, isolated child build directory.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "performance.spec.ts",
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: { trace: "off", video: "off", screenshot: "off" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "android-tablet-emulation", use: { ...devices["Galaxy Tab S4"] } },
  ],
  webServer: {
    command: `pnpm --filter @moja-nauka/child preview --port 4185 --outDir ${build}`,
    cwd: new URL("../../", import.meta.url).pathname,
    url: "http://127.0.0.1:4185/",
    reuseExistingServer: false,
  },
});
