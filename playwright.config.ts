import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: Boolean(process.env.CI),
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
  },
  webServer: [
    { command: "pnpm preview:child", url: "http://127.0.0.1:4173/" },
    { command: "pnpm preview:admin", url: "http://127.0.0.1:4174/" },
  ],
});
