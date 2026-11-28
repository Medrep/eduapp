import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
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

async function mockOwnerApi(page: Page, lessons = [lesson]) {
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
        lessons: { lessons },
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
  await expect(page.getByRole("textbox", { name: "Tytuł", exact: true })).toHaveValue(lesson.title);
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
  await expect(page.getByRole("textbox", { name: "Tytuł", exact: true })).toBeHidden();
  await page.clock.fastForward(10 * 60_000 + 1000);
  await expect(close).toHaveCount(0);
  await expect(preview).toBeFocused();
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

test("Admin library filters the loaded catalog and protects unsaved work at the approved sizes", async ({ page }, testInfo) => {
  const visualRoot = process.env.EDUAPP_ADMIN_REFERENCE_DIR;
  const entries: AdminLesson[] = Array.from({ length: 99 }, (_, index) => ({
    ...lesson, id: `6e64c984-c836-4371-a01a-${String(index + 1).padStart(12, "0")}`,
    title: `Ćwiczenie ${String(index + 1).padStart(2, "0")}`, status: "draft", activeVersionId: null, publishedAt: null,
  }));
  const viewports = [
    { name: "desktop", width: 1440, height: 900 }, { name: "laptop", width: 1280, height: 800 },
    { name: "tablet-portrait", width: 800, height: 1280 }, { name: "mobile", width: 390, height: 844 },
    { name: "min360", width: 360, height: 844 },
  ];
  async function compare(layout: string) {
    for (const { name, width, height } of viewports) {
      await page.setViewportSize({ width, height });
      expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
      if (visualRoot) {
        await page.screenshot({ path: testInfo.outputPath(`${layout}-${name}-runtime.png`) });
        const reference = await page.context().newPage();
        await reference.setViewportSize({ width, height });
        await reference.goto(pathToFileURL(`${visualRoot}/screens/${layout}-${name}.svg`).href);
        await reference.screenshot({ path: testInfo.outputPath(`${layout}-${name}-reference.png`) });
        await reference.close();
      }
    }
  }

  await mockOwnerApi(page, [lesson, ...entries]);
  const reads: string[] = [];
  page.on("request", request => {
    if (request.method() === "GET" && request.url().startsWith(backend)) reads.push(request.url());
  });
  await page.goto(admin);
  await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
  await compare("login-normal");
  await page.getByLabel("E-mail").fill("operator@example.invalid");
  await page.getByLabel("Hasło").fill("fixture-password");
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();

  const table = page.getByRole("table", { name: "Biblioteka lekcji" });
  await expect(table.locator("tbody tr")).toHaveCount(100);
  const count = reads.length;
  await page.getByLabel("Przedmiot", { exact: true }).selectOption(subject.id);
  await page.getByLabel("Status", { exact: true }).selectOption("published");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Szukaj lekcji").fill("Ł".repeat(6).toLowerCase());
  await expect(table.getByRole("heading", { name: lesson.title })).toBeVisible();
  await page.getByLabel("Szukaj lekcji").fill("Brak wyników");
  await expect(page.getByText("Nie ma lekcji pasujących do wyszukiwania.")).toBeVisible();
  await page.getByRole("button", { name: "Wyczyść filtry" }).click();
  await page.getByLabel("Sortowanie").selectOption("title");
  await expect(table.locator("tbody tr").first()).toContainText("Ćwiczenie 01");
  expect(reads).toHaveLength(count);
  await page.getByLabel("Szukaj lekcji").fill("Ćwiczenie 0");
  await expect(table.locator("tbody tr")).toHaveCount(9);
  await compare("library-normal");

  await page.getByRole("button", { name: "Nowa lekcja" }).click();
  await expect(page.getByRole("heading", { name: "Nowa lekcja" })).toBeFocused();
  await page.getByRole("textbox", { name: "Tytuł", exact: true }).fill("Szkic do zachowania");
  await page.locator(".create-lesson").getByRole("combobox", { name: /^Przedmiot/ }).selectOption(subject.id);
  await page.getByLabel("Udostępnij").selectOption("all");
  await page.getByRole("button", { name: "Zapisz szkic" }).click();
  const all = page.getByRole("dialog", { name: "Udostępnić wszystkim rodzinom?" });
  await expect(all.getByRole("button", { name: "Anuluj" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Zapisz szkic" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Tytuł", exact: true })).toHaveValue("Szkic do zachowania");
  await page.getByRole("button", { name: "Przedmioty", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Odrzuć zmiany" }).click();
  await expect(page.getByRole("heading", { name: "Przedmioty" })).toBeFocused();
  await page.getByRole("button", { name: "Archiwizuj przedmiot" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Anuluj" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Archiwizuj przedmiot" })).toBeFocused();
  await compare("subjects-normal");
  await page.getByRole("button", { name: "Rodziny i urządzenia" }).click();
  await expect(page.getByRole("heading", { name: "Rodziny i urządzenia" })).toBeFocused();
  await compare("families-normal");
});

test("Admin draft upload, validation, publish, rollback and device revocation use the existing contracts", async ({ page }) => {
  const id = "6e64c984-c836-4371-a01a-000000009001";
  const uploadId = "6e64c984-c836-4371-a01a-000000009002";
  const device = { id: "6e64c984-c836-4371-a01a-000000009003", familyId: family.id, label: "Tablet testowy", lastSeenAt: null, revokedAt: null };
  let draft: AdminLesson = { ...lesson, id, title: "Lekcja robocza", status: "draft", activeVersionId: null, publishedAt: null };
  const first = { ...version, id: "6e64c984-c836-4371-a01a-000000009004" };
  const latest = { ...version, id: uploadId, versionNumber: 2 };
  const operations: string[] = [];
  await mockOwnerApi(page, []);
  await page.route(backend + "/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const resource = url.pathname.split("/").at(-1);
    const method = request.method();
    const headers = { "access-control-allow-origin": admin, "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
      "access-control-allow-headers": "apikey, authorization, content-type" };
    if (method === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    let json: unknown;
    if (resource === "lessons" && method === "POST") {
      expect(request.postDataJSON()).toMatchObject({ title: draft.title, familyIds: [family.id] });
      operations.push("draft");
      json = { lesson: draft };
    } else if (resource === "versions" && url.pathname.includes(id)) {
      json = { versions: [first] };
    } else if (resource === "upload-init") {
      expect(request.postDataJSON()).toMatchObject({ sizeBytes: latest.sizeBytes, sha256: latest.sha256 });
      operations.push("stage");
      json = { uploadId, uploadUrl: backend + `/storage/v1/object/upload/sign/lesson-staging/uploads/${uploadId}.html?token=local-test-grant`,
        expiresAt: new Date(Date.now() + 600_000).toISOString() };
    } else if (method === "PUT" && url.pathname.includes(uploadId)) {
      expect(request.postDataBuffer()).toEqual(Buffer.from(body));
      operations.push("put");
      json = {};
    } else if (resource === "upload-finalize") {
      expect(request.postDataJSON()).toEqual({ uploadId });
      operations.push("validate");
      json = { version: latest };
    } else if (resource === "publish" || resource === "unpublish") {
      const input = request.postDataJSON();
      expect(input.expectedUpdatedAt).toBe(draft.updatedAt);
      operations.push(resource === "publish" ? input.versionId : "hide");
      draft = resource === "publish" ? { ...draft, status: "published", activeVersionId: input.versionId, publishedAt: now }
        : { ...draft, status: "unpublished" };
      json = { lesson: draft };
    } else if (resource === "devices") {
      json = { devices: [device] };
    } else if (resource === "pairing-codes") {
      operations.push("code");
      json = { code: "ABCDE-FG234", expiresAt: new Date(Date.now() + 60_000).toISOString() };
    } else if (resource === "revoke") {
      operations.push("revoke");
      json = { device: { ...device, revokedAt: now } };
    } else { await route.fallback(); return; }
    await route.fulfill({ headers, json });
  });
  await page.goto(admin);
  await page.getByLabel("E-mail").fill("operator@example.invalid");
  await page.getByLabel("Hasło").fill("fixture-password");
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();
  await expect(page.getByText("Nie ma jeszcze lekcji.")).toBeVisible();
  await page.getByRole("button", { name: "Nowa lekcja" }).click();
  await page.getByRole("textbox", { name: "Tytuł" }).fill(draft.title);
  await page.locator(".create-lesson").getByRole("combobox", { name: /^Przedmiot/ }).selectOption(subject.id);
  await page.getByRole("button", { name: "Zapisz szkic" }).click();
  await expect(page.getByRole("heading", { name: draft.title, exact: true })).toBeVisible();
  await page.getByLabel("Plik HTML").setInputFiles({ name: "lekcja.html", mimeType: "text/html", buffer: Buffer.from(body) });
  await page.getByRole("button", { name: "Prześlij i sprawdź" }).click();
  await expect(page.getByText("Plik przeszedł walidację. Zapisano wersję.")).toBeVisible();
  await page.getByRole("button", { name: "Opublikuj tę wersję" }).click();
  await expect(page.getByText("Opublikowano wersję lekcji.")).toBeVisible();
  await page.getByRole("button", { name: "Historia wersji" }).click();
  await page.getByRole("article", { name: "Wersja 1" }).getByRole("button", { name: "Opublikuj tę wersję" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Opublikuj wersję" }).click();
  await expect(page.getByText("Aktywna wersja: 1")).toBeVisible();
  await page.getByRole("button", { name: "Wróć do danych lekcji" }).click();
  await page.getByRole("button", { name: "Ukryj lekcję" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ukryj lekcję" }).click();
  await expect(page.getByText("Ukryto lekcję.")).toBeVisible();
  await page.getByRole("button", { name: "Rodziny i urządzenia" }).click();
  await page.getByRole("button", { name: "Wygeneruj kod" }).click();
  await expect(page.locator("output")).toHaveText("ABCDE-FG234");
  await page.getByRole("button", { name: "Ukryj kod" }).click();
  await expect(page.locator("output")).toHaveCount(0);
  await page.getByRole("button", { name: "Unieważnij dostęp" }).click();
  await expect(page.getByRole("dialog")).toContainText("nie można zdalnie usunąć");
  await page.getByRole("dialog").getByRole("button", { name: "Unieważnij dostęp" }).click();
  await expect(page.getByText(/Dostęp cofnięty:/)).toBeVisible();
  expect(operations).toEqual(["draft", "stage", "put", "validate", latest.id, first.id, "hide", "code", "revoke"]);
});
