import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type { AdminLesson, AdminSubject, Family } from "../../packages/contracts/src/admin.ts";

const admin = "http://127.0.0.1:4274";
const backend = "http://127.0.0.1:5182";
const now = "2026-11-26T08:00:00Z";
const subject: AdminSubject = {
  id: "c751e139-8d66-4cc3-be99-dc49b3345fb9",
  namePl: "Przyroda",
  slug: "przyroda",
  sortOrder: 1,
  archivedAt: null,
};
const family: Family = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "Dom",
  createdAt: now,
  enabled: true,
};
const lesson: AdminLesson = {
  id: "1fa1400b-bdc4-4bd6-b69c-9634dbd4349a",
  subjectId: subject.id,
  title: "Skały, gleba i " + "Ł".repeat(95),
  description: null,
  grade: 4,
  visibility: "selected",
  familyIds: [family.id],
  status: "published",
  activeVersionId: "be52bef8-87f4-4365-a688-eec5ff9b87bc",
  publishedAt: now,
  createdAt: now,
  updatedAt: now,
};
const body = "<!doctype html><html lang=pl><meta charset=utf-8><title>Podgląd</title><h1>Sprawdzona lekcja</h1>";
const version = {
  id: lesson.activeVersionId,
  versionNumber: 1,
  sha256: createHash("sha256").update(body).digest("hex"),
  sizeBytes: Buffer.byteLength(body),
  validationReport: { valid: true, checked: ["utf8", "html5"] },
  createdAt: now,
};

async function mockOwnerApi(page: Page) {
  await page.route(backend + "/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const headers = {
      "access-control-allow-origin": admin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "apikey, authorization, content-type",
    };
    if (request.method() === "OPTIONS" || path === "/auth/v1/logout") {
      await route.fulfill({ status: 204, headers });
    } else if (path.startsWith("/storage/v1/object/sign/")) {
      await route.fulfill({ status: 200, contentType: "application/octet-stream", headers, body });
    } else {
      const resource = path.split("/").at(-1);
      const data: Record<string, unknown> = {
        token: { access_token: "fixture.session.token", expires_at: Math.floor(Date.now() / 1000) + 3600 },
        subjects: { subjects: [subject] },
        lessons: { lessons: [lesson] },
        families: { families: [family] },
        devices: { devices: [] },
        versions: { versions: [version] },
        "download-url": {
          ...version,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          signedUrl: backend + `/storage/v1/object/sign/lesson-bundles/lessons/${lesson.id}/versions/${version.id}.html?token=local-test-grant&download=lesson.html`,
        },
      };
      if (!resource || !Object.hasOwn(data, resource)) {
        await route.fulfill({ status: 404, headers });
      } else {
        await route.fulfill({ json: data[resource], headers });
      }
    }
  });
}

async function auditLayout(page: Page) {
  const result = await page.evaluate(() => {
    const small = [...document.querySelectorAll("button, input, select, textarea, summary")].flatMap(element => {
      const target = element.matches("input[type=checkbox]") ? element.closest("label") ?? element : element;
      const { width, height } = target.getBoundingClientRect();
      return width && height && (width < 44 || height < 44) ? [element.tagName] : [];
    });
    const root = document.documentElement;
    return { small, overflow: root.scrollWidth - root.clientWidth, font: Number.parseFloat(getComputedStyle(root).fontSize) };
  });
  expect(result.overflow).toBe(0);
  expect(result.small).toEqual([]);
  expect(result.font).toBeCloseTo(20.8, 1);
}

test("UX-01 configured owner panel supports enlarged layouts and keyboard transitions", async ({ page }) => {
  await mockOwnerApi(page);
  await page.clock.install();
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(admin);
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  const email = page.getByLabel("E-mail");
  await expect(email).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(email).toBeFocused();
  expect(await email.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
  await email.fill("operator@example.invalid");
  const password = page.getByLabel("Hasło");
  await password.fill("fixture-password");
  await auditLayout(page);
  await password.press("Enter");
  const dashboardHeading = page.getByRole("heading", { name: "Panel administratora" });
  await expect(dashboardHeading).toBeFocused();
  await expect(page.getByRole("heading", { name: lesson.title })).toBeVisible();
  await auditLayout(page);

  const edit = page.getByRole("button", { name: "Edytuj lekcję" });
  await edit.focus();
  await edit.press("Enter");
  await expect(page.getByRole("heading", { name: lesson.title })).toBeFocused();
  await expect(page.getByLabel("Tytuł")).toHaveValue(lesson.title);
  await expect(page.getByRole("checkbox", { name: "Dom" })).toBeChecked();
  await auditLayout(page);
  for (const viewport of [{ width: 712, height: 1138 }, { width: 1138, height: 712 }]) {
    await page.setViewportSize(viewport);
    await auditLayout(page);
  }
  await page.setViewportSize({ width: 360, height: 720 });
  const preview = page.getByRole("button", { name: "Podgląd", exact: true });
  await expect(preview).toBeEnabled();
  await preview.focus();
  await preview.press("Enter");
  const close = page.getByRole("button", { name: "Zamknij podgląd" });
  await expect(close).toBeFocused();
  await expect(page.locator("iframe.proof-frame").contentFrame().locator("iframe").contentFrame()
    .getByRole("heading", { name: "Sprawdzona lekcja" })).toBeVisible();
  await close.press("Enter");
  await expect(preview).toBeFocused();
  await preview.press("Enter");
  const outerFrame = page.locator("iframe.proof-frame");
  await outerFrame.focus();
  await expect(outerFrame).toBeFocused();
  await page.clock.fastForward(10 * 60_000 + 1000);
  await expect(close).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("Podgląd wygasł");
  await expect(preview).toBeFocused();

  await page.clock.setSystemTime(new Date());
  await preview.press("Enter");
  await expect(close).toBeFocused();
  const title = page.getByLabel("Tytuł");
  await title.focus();
  await page.clock.fastForward(10 * 60_000 + 1000);
  await expect(close).toHaveCount(0);
  await expect(title).toBeFocused();
  const back = page.getByRole("button", { name: "Wróć do listy lekcji" });
  await back.focus();
  await back.press("Enter");
  await expect(page.getByRole("heading", { name: "Lekcje", exact: true })).toBeFocused();
  const logout = page.getByRole("button", { name: "Wyloguj" });
  await logout.focus();
  await logout.press("Enter");
  await expect(dashboardHeading).toBeFocused();
  await expect(email).toBeVisible();
});
