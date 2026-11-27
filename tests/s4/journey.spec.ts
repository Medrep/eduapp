import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { devices, expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { playFixture } from "../browser/fixture-interaction.ts";

const original = readFileSync(new URL("../../fixtures/rocks-soil.html", import.meta.url));
const originalDigest = "7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c";
const staging = process.env.MOJA_S4_TARGET === "staging";
const adminOrigin = staging ? "https://moja-nauka-admin-staging.vercel.app" : "http://127.0.0.1:4174";
const childOrigin = staging ? "https://moja-nauka-child-staging.vercel.app" : "http://127.0.0.1:4173";
const tag = process.env.MOJA_S4_RUN_ID;
const owner = process.env.MOJA_S4_OWNER_EMAIL;
const password = process.env.MOJA_S4_OWNER_PASSWORD;
const backend = process.env.VITE_SUPABASE_URL;

if (!tag || !owner || !password || !backend) throw new Error("Run the S4 test with its disposable test provisioner.");

const lessonTitle = tag + " skały i gleba";
const otherTitle = tag + " bez zmian";
const familyLabel = tag + " rodzina";
const deviceLabel = tag + " tablet";
const version2 = Buffer.from(original.toString("utf8").replace("</body>", "<p id=\"s4-second-version\" hidden>Wersja druga</p></body>"));
const otherFile = Buffer.from("<!doctype html><html lang=pl><head><meta charset=utf-8><meta name=viewport content=\"width=device-width, initial-scale=1\"><title>Lekcja</title></head><body><h1>Lekcja bez zmian</h1></body></html>");

function button(page: Page, name: string | RegExp) {
  return page.getByRole("button", { name, exact: typeof name === "string" });
}

function edgeReply(page: Page, suffix: string, method: string) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === backend && url.pathname.endsWith(suffix) && response.request().method() === method;
  }, { timeout: 25_000 });
}

async function safeStatus(response: Response, expected: number, label: string) {
  expect(response.status(), label).toBe(expected);
  const providerId = (await response.headerValue("sb-request-id")) ?? undefined;
  console.log(JSON.stringify({ check: label, status: expected, providerId }));
}

async function signIn(page: Page) {
  await checkShell(await page.goto(adminOrigin), adminOrigin);
  await page.getByLabel("E-mail", { exact: true }).fill(owner!);
  await page.getByLabel("Hasło", { exact: true }).fill(password!);
  const authorized = edgeReply(page, "/admin/v1/subjects", "GET");
  await button(page, "Zaloguj").click();
  await safeStatus(await authorized, 200, "active owner authorization");
}

async function checkShell(response: Response | null, origin: string) {
  expect(response?.status()).toBe(200);
  const csp = await response?.headerValue("content-security-policy");
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain("connect-src 'self' " + backend + ";");
  expect(csp).toContain("frame-src " + origin + "/__viewer/");
  expect(csp).toContain("frame-ancestors 'none';");
  expect(await response?.headerValue("referrer-policy")).toBe("no-referrer");
}

async function expectOriginalSource(page: Page) {
  const inner = page.locator("iframe.proof-frame").contentFrame().locator("iframe");
  const source = await inner.getAttribute("srcdoc") ?? "";
  expect(Buffer.byteLength(source)).toBe(original.length);
  expect(createHash("sha256").update(source).digest("hex")).toBe(originalDigest);
}

async function openLesson(page: Page, title: string) {
  const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await row.getByRole("button", { name: "Otwórz lekcję" }).click();
  return lessonFrame(page);
}

async function lessonFrame(page: Page) {
  const external = page.locator("iframe.proof-frame").contentFrame().locator("iframe");
  await expect(external).toHaveAttribute("sandbox", "allow-scripts");
  await expect(external).toHaveAttribute("srcdoc", /.+/);
  const frame = await (await external.elementHandle())?.contentFrame();
  if (!frame) throw new Error("The opaque lesson frame did not mount.");
  expect(await frame.evaluate(() => {
    try { return { origin: self.origin, parentReadable: Boolean(parent.document) }; }
    catch { return { origin: self.origin, parentReadable: false }; }
  })).toEqual({ origin: "null", parentReadable: false });
  return frame;
}

function previewCount(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open("mojanauka-admin-preview-v1");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("previewBytes");
      const count = tx.objectStore("previewBytes").count();
      tx.oncomplete = () => { db.close(); resolve(count.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

function closeChild(page: Page) {
  return button(page, "Wróć do biblioteki").click();
}

async function ready(page: Page, downloaded: number, total: number) {
  await expect(page.getByText(`Dostępne offline: ${downloaded} z ${total}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Synchronizacja · Pobieranie lekcji", { exact: true })).toHaveCount(0);
}

function observeDownloads(context: BrowserContext) {
  const versions: string[] = [];
  context.on("response", response => {
    const url = new URL(response.url());
    if (url.origin !== backend || response.request().method() !== "GET" || !response.ok()) return;
    const match = /\/storage\/v1\/object\/sign\/lesson-bundles\/lessons\/[^/]+\/versions\/([^/]+)\.html$/.exec(url.pathname);
    if (match?.[1]) versions.push(match[1]);
  });
  return versions;
}

async function upload(page: Page, input: Buffer, name: string) {
  const finalize = edgeReply(page, "/upload-finalize", "POST");
  const put = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === backend && url.pathname.includes("/upload/sign/lesson-staging/") &&
      response.request().method() === "PUT";
  });
  await page.getByLabel("Plik HTML", { exact: true }).setInputFiles({ name, mimeType: "text/html", buffer: input });
  await button(page, "Prześlij i sprawdź").click();
  const transferred = await put;
  await safeStatus(transferred, 200, "private signed upload");
  const headers = await transferred.request().allHeaders();
  expect(Boolean(headers.authorization || headers.apikey || headers.cookie), "Storage upload is credentialless").toBe(false);
  const completed = await finalize;
  await safeStatus(completed, 200, "server validation and finalization");
  const version = (await completed.json()).version;
  expect(version.sha256).toBe(createHash("sha256").update(input).digest("hex"));
  expect(version.sizeBytes).toBe(input.length);
  expect(version.validationReport.valid).toBe(true);
  return version as { id: string; versionNumber: number; sha256: string };
}

async function navigate(page: Page, name: string) {
  await button(page, name).click();
}

async function manageSubject(page: Page) {
  const initialName = tag + " przedmiot";
  const editedName = tag + " przedmiot zmieniony";
  await navigate(page, "Przedmioty");
  await page.getByLabel("Nazwa przedmiotu").fill(initialName);
  await page.getByLabel("Identyfikator URL").fill(tag!);
  const created = edgeReply(page, "/admin/v1/subjects", "POST");
  await navigate(page, "Dodaj przedmiot");
  await safeStatus(await created, 201, "subject created");
  await page.getByRole("article", { name: initialName, exact: true })
    .getByRole("button", { name: "Edytuj przedmiot" }).click();
  await page.getByLabel("Nazwa przedmiotu").fill(editedName);
  const { subject: { id } } = await (await created).json();
  const edited = edgeReply(page, "/subjects/" + id, "PATCH");
  await navigate(page, "Zapisz przedmiot");
  const updated = await edited;
  await safeStatus(updated, 200, "subject edited");
  expect(updated.request().postDataJSON()).not.toHaveProperty("slug");
  const archived = edgeReply(page, "/subjects/" + id, "PATCH");
  const subject = page.getByRole("article", { name: editedName, exact: true });
  await subject.getByRole("button", { name: "Archiwizuj przedmiot" }).click();
  await safeStatus(await archived, 200, "subject archived");
  await expect(subject.getByText(/W archiwum/)).toBeVisible();
}

async function createFamily(page: Page) {
  await navigate(page, "Rodziny i urządzenia");
  const response = edgeReply(page, "/admin/v1/families", "POST");
  await page.getByLabel("Nazwa rodziny", { exact: true }).fill(familyLabel);
  await navigate(page, "Dodaj rodzinę");
  await safeStatus(await response, 201, "family created");
}

async function issueCode(page: Page) {
  await navigate(page, "Rodziny i urządzenia");
  const family = page.getByRole("article", { name: familyLabel, exact: true });
  const response = edgeReply(page, "/pairing-codes", "POST");
  await family.getByRole("button", { name: "Wygeneruj kod", exact: true }).click();
  const issued = await response;
  await safeStatus(issued, 200, "pairing code issued");
  const { code } = await issued.json();
  expect(typeof code === "string" && /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)).toBe(true);
  await expect.poll(async () => (await family.getByLabel("Kod parowania").textContent()) === code).toBe(true);
  return code as string;
}

async function createLesson(page: Page, title: string) {
  await navigate(page, "Lekcje");
  await navigate(page, "Nowa lekcja");
  await page.getByLabel("Tytuł", { exact: true }).fill(title);
  await page.getByRole("combobox", { name: "Przedmiot", exact: true }).selectOption({ label: "Przyroda" });
  const defaultFamily = page.getByRole("checkbox", { name: "Dom", exact: true });
  await expect(defaultFamily).toBeChecked();
  await defaultFamily.uncheck();
  await page.getByRole("checkbox", { name: familyLabel, exact: true }).check();
  const response = edgeReply(page, "/admin/v1/lessons", "POST");
  await navigate(page, "Zapisz szkic");
  const created = await response;
  await safeStatus(created, 201, "assigned draft created");
  const { lesson } = await created.json();
  expect(lesson.status).toBe("draft");
  expect(lesson.visibility).toBe("selected");
}

async function selectLesson(page: Page, title: string) {
  await navigate(page, "Lekcje");
  await page.getByRole("article", { name: title, exact: true })
    .getByRole("button", { name: "Edytuj lekcję", exact: true }).click();
}

function versionRow(page: Page, n: number) {
  return page.getByRole("article", { name: `Wersja ${n}`, exact: true });
}

async function publish(page: Page, n: number) {
  const response = edgeReply(page, "/publish", "POST");
  await versionRow(page, n).getByRole("button", { name: "Opublikuj tę wersję", exact: true }).click();
  const published = await response;
  await safeStatus(published, 200, "publish version " + n);
  const { lesson } = await published.json();
  expect(lesson.status).toBe("published");
}

async function manualSync(page: Page) {
  const response = edgeReply(page, "/device/v1/catalog", "GET");
  await button(page, /Synchronizuj teraz|Spróbuj ponownie/).click();
  await safeStatus(await response, 200, "authorized complete catalog snapshot");
}

async function openSubject(page: Page) {
  await button(page, /Przyroda/).click();
}

async function exerciseOwnerAndChild(admin: Page, child: Page, childContext: BrowserContext, downloads: string[], touch: boolean) {
  await manageSubject(admin);
  await createFamily(admin);
  await createLesson(admin, lessonTitle);
  const v1 = await upload(admin, original, "rocks-soil.html");
  const originalPreview = versionRow(admin, 1).getByRole("button", { name: "Podgląd", exact: true });
  await originalPreview.click();
  const adminV1 = await lessonFrame(admin);
  await expect(adminV1.locator(".slide")).toHaveCount(12);
  await expectOriginalSource(admin);
  await navigate(admin, "Zamknij podgląd");
  await expect(admin.locator("iframe.proof-frame")).toHaveCount(0);
  await expect.poll(() => previewCount(admin)).toBe(0);
  await publish(admin, 1);
  await navigate(admin, "Lekcje");
  const publishedCard = admin.getByRole("article", { name: lessonTitle, exact: true });
  await expect(publishedCard).toContainText("Identyfikator aktywnej wersji");
  await expect(publishedCard).toContainText(v1.id);
  await createLesson(admin, otherTitle);
  const unchanged = await upload(admin, otherFile, "unchanged.html");
  await publish(admin, 1);

  const code = await issueCode(admin);
  await checkShell(await child.goto(childOrigin), childOrigin);
  const blocked = await child.evaluate(async endpoint => {
    try { await fetch(endpoint + "/functions/v1/admin-api/admin/v1/subjects", { credentials: "omit" }); return false; }
    catch { return true; }
  }, backend!);
  expect(blocked).toBe(true);
  await child.getByLabel("Kod połączenia").fill(code);
  await child.getByLabel(/Nazwa urządzenia/).fill(deviceLabel);
  const pair = edgeReply(child, "/device/v1/pair", "POST");
  await navigate(child, "Połącz urządzenie");
  await safeStatus(await pair, 200, "one disposable device paired");
  await ready(child, 2, 2);
  expect(new Set(downloads)).toEqual(new Set([v1.id, unchanged.id]));
  expect(downloads).toHaveLength(2);
  const worker = await child.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  expect(worker).toBeTruthy();

  let start = downloads.length;
  await manualSync(child);
  await ready(child, 2, 2);
  expect(downloads.slice(start)).toHaveLength(0);
  await childContext.setOffline(true);
  await child.reload();
  await ready(child, 2, 2);
  await openSubject(child);
  const originalOffline = await openLesson(child, lessonTitle);
  await expectOriginalSource(child);
  await playFixture(originalOffline, touch);
  await closeChild(child);
  await childContext.setOffline(false);
  await ready(child, 2, 2);
  await child.evaluate(() => {
    const marker = document.documentElement.dataset;
    marker.s4ControllerChanged = "false";
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      marker.s4ControllerChanged = "true";
    }, { once: true });
  });

  await selectLesson(admin, lessonTitle);
  const v2 = await upload(admin, version2, "rocks-soil-v2.html");
  expect(v2.versionNumber).toBe(2);
  await signIn(admin);
  await selectLesson(admin, lessonTitle);
  const retainedPreviews = await previewCount(admin);
  const olderGrant = edgeReply(admin, "/download-url", "POST");
  await versionRow(admin, 1).getByRole("button", { name: "Podgląd", exact: true }).click();
  await safeStatus(await olderGrant, 200, "owner private URL for older version");
  await expect((await lessonFrame(admin)).locator(".slide")).toHaveCount(12);
  await expectOriginalSource(admin);
  await expect.poll(() => previewCount(admin)).toBe(retainedPreviews + 1);
  await navigate(admin, "Zamknij podgląd");
  await expect(admin.locator("iframe.proof-frame")).toHaveCount(0);
  await expect.poll(() => previewCount(admin)).toBe(retainedPreviews);

  start = downloads.length;
  await publish(admin, 2);
  await manualSync(child);
  await ready(child, 2, 2);
  expect(downloads.slice(start)).toEqual([v2.id]);
  await expect((await openLesson(child, lessonTitle)).locator("#s4-second-version")).toHaveCount(1);
  await closeChild(child);
  expect(await child.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(worker);

  start = downloads.length;
  await publish(admin, 1);
  await manualSync(child);
  await ready(child, 2, 2);
  expect(downloads.slice(start).every(id => id === v1.id)).toBe(true);
  const rolledBack = await openLesson(child, lessonTitle);
  await expect(rolledBack.locator("#s4-second-version")).toHaveCount(0);
  await expect(rolledBack.locator(".slide")).toHaveCount(12);
  await closeChild(child);
  expect(await child.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(worker);
  await expect(child.locator("html")).toHaveAttribute("data-s4-controller-changed", "false");

  const unpublication = edgeReply(admin, "/unpublish", "POST");
  await navigate(admin, "Ukryj lekcję");
  await safeStatus(await unpublication, 200, "unpublish with optimistic revision");
  await manualSync(child);
  await ready(child, 1, 1);
  await expect(child.getByRole("heading", { name: lessonTitle, exact: true })).toHaveCount(0);

  await navigate(admin, "Rodziny i urządzenia");
  const device = admin.getByRole("listitem", { name: deviceLabel, exact: true });
  const revoke = edgeReply(admin, "/revoke", "POST");
  const warning = admin.waitForEvent("dialog");
  await device.getByRole("button", { name: "Unieważnij dostęp", exact: true }).click();
  const text = (await warning).message();
  expect(text).toMatch(/zdalnie usunąć/);
  expect(text).toMatch(/podpisany adres pobierania.*do wygaśnięcia/);
  await safeStatus(await revoke, 200, "device revoked after showing both limitations");
  const denied = edgeReply(child, "/device/v1/catalog", "GET");
  await button(child, /Synchronizuj teraz|Spróbuj ponownie/).click();
  await safeStatus(await denied, 403, "revoked device rejected while retaining installed content");
  await expect(child.getByText(/Pobrane lekcje pozostają dostępne offline/)).toBeVisible();
  await expect((await openLesson(child, otherTitle)).getByRole("heading", { name: "Lekcja bez zmian" })).toBeVisible();
  await navigate(admin, "Wyloguj");
  await expect(button(admin, "Zaloguj")).toBeVisible();
  expect(retainedPreviews).toBe(1);
  await admin.clock.fastForward(11 * 60_000);
  await expect.poll(() => previewCount(admin)).toBe(0);
  console.log(JSON.stringify({ initialTransfers: 2, unchangedTransfers: 0, changedTransfers: 1,
    rollbackUnexpectedTransfers: 0, sameWorker: true, olderVersionPrivatePreview: true, closeAndExpiryCleanup: true, crossOriginAdminDenied: true,
    exactOriginalBytes: original.length, exactOriginalSha256: originalDigest }));
}

test("owner-to-child original fixture, offline, incremental update and rollback", async ({ browser, hasTouch }) => {
  expect(original.length).toBe(333_033);
  expect(createHash("sha256").update(original).digest("hex")).toBe(originalDigest);
  expect(version2.length).toBeGreaterThan(original.length);
  const adminContext = await browser.newContext();
  const childContext = await browser.newContext(hasTouch ? { ...devices["Galaxy Tab S4"] } : {});
  try {
    const admin = await adminContext.newPage();
    await admin.clock.install();
    admin.on("dialog", dialog => void dialog.accept());
    const child = await childContext.newPage();
    const downloads = observeDownloads(childContext);
    await signIn(admin);
    await exerciseOwnerAndChild(admin, child, childContext, downloads, Boolean(hasTouch));
    console.log(JSON.stringify({ engine: browser.browserType().name(), version: browser.version(), emulatedTablet: hasTouch,
      backend, originSplit: new URL(admin.url()).origin !== new URL(child.url()).origin, originalDigest, originalBytes: original.length }));
  } finally {
    await Promise.all([adminContext.close(), childContext.close()]);
  }
});
