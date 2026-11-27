import { defineConfig, devices } from "@playwright/test";

const hosted = process.env.MOJA_S4_TARGET === "staging";
const useTablet = process.env.MOJA_S4_BROWSER === "tablet";
const useFirefox = process.env.MOJA_S4_BROWSER === "firefox";
const pinnedTlsKey = process.env.MOJA_S4_TEST_TLS_SPKI;
const testPort = process.env.MOJA_S4_TEST_TLS_PORT;
const repo = new URL("../../", import.meta.url).pathname;

if (hosted && (!pinnedTlsKey || !testPort || useFirefox)) {
  throw new Error("Staging browser verification requires the ephemeral Chromium loopback TLS setup.");
}

export default defineConfig({
  testDir: ".",
  testMatch: "journey.spec.ts",
  timeout: 180_000,
  workers: 1,
  retries: 0,
  use: {
    ...(useTablet ? devices["Galaxy Tab S4"] : useFirefox ? devices["Desktop Firefox"] : devices["Desktop Chrome"]),
    browserName: useFirefox ? "firefox" : "chromium",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(hosted ? { launchOptions: { args: [
      `--ignore-certificate-errors-spki-list=${pinnedTlsKey}`,
      `--host-resolver-rules=MAP moja-nauka-admin-staging.vercel.app 127.0.0.1:${testPort},MAP moja-nauka-child-staging.vercel.app 127.0.0.1:${testPort}`,
      "--no-proxy-server",
    ] } } : {}),
  },
  webServer: [
    { command: "pnpm preview:child", cwd: repo, url: "http://127.0.0.1:4173/" },
    { command: "pnpm preview:admin", cwd: repo, url: "http://127.0.0.1:4174/" },
  ],
});
