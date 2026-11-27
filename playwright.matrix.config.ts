import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.ts";

const profiles = [
  ["chromium-desktop", "Desktop Chrome"],
  ["firefox-desktop", "Desktop Firefox"],
  ["chromium-android-tablet-portrait", "Galaxy Tab S4"],
  ["chromium-android-tablet-landscape", "Galaxy Tab S4 landscape"],
] as const;

export default defineConfig({
  ...base,
  projects: profiles.map(([name, preset]) => ({
    name,
    use: {
      ...devices[preset],
      ...(name === "firefox-desktop" && process.env.MOJA_NAUKA_FIREFOX_ROOT
        ? { launchOptions: { env: { ...process.env, CFFIXED_USER_HOME: process.env.MOJA_NAUKA_FIREFOX_ROOT } } }
        : {}),
    },
  })),
  workers: 2,
});
