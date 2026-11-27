import { expect, test } from "@playwright/test";
import { workerPathForWrapper } from "../../packages/contracts/src/viewer-wrapper.ts";
import { buildViewerWrapper } from "../../scripts/shell-config.ts";

const childOrigin = "http://127.0.0.1:4173";
const adminOrigin = "http://127.0.0.1:4174";

test("the child shell loads on its own origin and registers its worker", async ({ page }) => {
  const shell = await page.goto(childOrigin);
  expect(shell?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.getByRole("heading", { name: "Moja Nauka" })).toBeVisible();

  const manifest = await page.request.get(`${childOrigin}/manifest.webmanifest`);
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    name: "Moja Nauka",
    start_url: "/",
    scope: "/",
    display: "standalone",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192" },
      { src: "/icons/icon-512.png", sizes: "512x512" },
    ],
  });

  const registration = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready;
    return { scope: worker.scope, scriptUrl: worker.active?.scriptURL };
  });
  expect(registration).toEqual({ scope: `${childOrigin}/`, scriptUrl: childOrigin + workerPathForWrapper(buildViewerWrapper("child").path) });
});

test("the admin shell loads on a separate origin with its own preview worker", async ({ page }) => {
  const shell = await page.goto(adminOrigin);
  expect(shell?.headers()["content-security-policy"]).toContain("script-src 'self'");
  await expect(page.getByRole("heading", { name: "Panel administratora" })).toBeVisible();
  expect(await page.evaluate(() => location.origin)).toBe(adminOrigin);
  const registration = await page.evaluate(async () => {
    const worker = await navigator.serviceWorker.ready;
    return { scope: worker.scope, scriptUrl: worker.active?.scriptURL };
  });
  expect(registration).toEqual({ scope: `${adminOrigin}/`, scriptUrl: adminOrigin + workerPathForWrapper(buildViewerWrapper("admin").path) });
});

test("reserved virtual paths do not fall through to either static shell", async ({ request }) => {
  const id = "00000000-0000-4000-8000-000000000000";
  const child = await request.get(`${childOrigin}/__offline_lesson/${id}/${id}/index.html`);
  const admin = await request.get(`${adminOrigin}/__preview_lesson/${id}/index.html`);
  expect(child.status()).toBe(404);
  expect(admin.status()).toBe(404);
});
