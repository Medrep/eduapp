import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { type Catalog, type Lesson } from "../../packages/contracts/src/device.ts";

const origin = "http://127.0.0.1:4173";
const familyId = "9fdd4a77-ff54-4f1b-825b-6102451dcdba";
const subject = { id: "60c0572e-eeab-43b2-ba75-c5c0f7d9275d", slug: "przyroda", namePl: "Przyroda", sortOrder: 1 };
const now = "2026-11-19T18:00:00Z";
const code = "ABCDE-FG234";
const dbName = "mojanauka-child-v1";

function id(number: number) {
  return `6e64c984-c836-4371-a01a-${number.toString(16).padStart(12, "0")}`;
}

function deferred() {
  let release: () => void = () => undefined;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { release, wait };
}

function lesson(n: number, version: number, body = `<!doctype html><h1>Lekcja ${n}, wersja ${version}</h1>`) {
  const meta: Lesson = {
    id: id(n), subjectId: subject.id, title: `Lekcja ${n}`, description: null, grade: 4, publishedAt: now,
    version: { id: id(n * 100 + version), number: version, sha256: createHash("sha256").update(body).digest("hex"),
      sizeBytes: Buffer.byteLength(body) },
  };
  return { meta, body };
}

type Item = ReturnType<typeof lesson>;

function snapshot(revision: number, ...items: Item[]): Catalog {
  return {
    schemaVersion: 1, revision, generatedAt: now, family: { id: familyId, label: "Dom" },
    subjects: [subject], lessons: items.map(item => item.meta),
  };
}

type Fault = "hash" | "short" | "large" | "unavailable" | "expired" | "interrupted";

class DeviceFixture {
  catalog: Catalog;
  catalogs = 0;
  catalogStatus = 200;
  catalogCapture?: (response: Catalog) => Promise<Catalog>;
  downloads = new Map<string, number>();
  faults = new Map<string, Fault>();
  beforeFile?: (versionId: string) => Promise<void>;
  authorizeFile?: (versionId: string) => Promise<boolean>;
  signedGrant?: (url: string) => string;
  active = 0;
  maxActive = 0;
  #items = new Map<string, Item>();

  constructor(...items: Item[]) {
    this.catalog = snapshot(1, ...items);
    for (const item of items) this.add(item);
  }

  add(item: Item) {
    this.#items.set(item.meta.version.id, item);
  }

  async serve(page: Page) {
    await page.route(origin + "/device/v1/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/pair")) {
        await route.fulfill({ json: {
          deviceId: id(9000), familyId, familyLabel: "Dom", deviceToken: "A".repeat(43), serverTime: now,
        } });
      } else if (path.endsWith("/catalog")) {
        this.catalogs++;
        const response = this.catalog;
        await route.fulfill({ status: this.catalogStatus, json: await this.catalogCapture?.(response) ?? response });
      } else {
        const { versionId, lessonId } = route.request().postDataJSON();
        const item = this.#items.get(versionId);
        if (!item || item.meta.id !== lessonId) { await route.fulfill({ status: 404 }); return; }
        if (this.authorizeFile && !await this.authorizeFile(versionId)) { await route.fulfill({ status: 403 }); return; }
        const { sha256, sizeBytes } = item.meta.version;
        const signedPath = versionId.replaceAll("-", "").repeat(2);
        const localGrant = origin + "/__device-mock/content/" + signedPath;
        await route.fulfill({ json: { signedUrl: this.signedGrant?.(localGrant) ?? localGrant,
          expiresAt: new Date(Date.now() + 60_000).toISOString(), sha256, sizeBytes } });
      }
    });
    await page.route(origin + "/__device-mock/content/*", async route => {
      const item = [...this.#items.values()].find(entry =>
        route.request().url().endsWith(entry.meta.version.id.replaceAll("-", "").repeat(2)));
      if (!item) { await route.fulfill({ status: 404 }); return; }
      const key = item.meta.version.id;
      const attempt = (this.downloads.get(key) ?? 0) + 1;
      this.downloads.set(key, attempt);
      this.active++;
      this.maxActive = Math.max(this.active, this.maxActive);
      try {
        await this.beforeFile?.(key);
        if (page.isClosed()) return;
        const fault = this.faults.get(key);
        if (fault === "interrupted") { await route.abort("failed"); return; }
        if (fault === "unavailable") { await route.fulfill({ status: 503 }); return; }
        if (fault === "expired" && attempt === 1) { await route.fulfill({ status: 410 }); return; }
        const bytes = Buffer.from(item.body);
        if (fault === "hash") bytes[0] = 35;
        const body = fault === "short" ? bytes.subarray(0, bytes.length - 1)
          : fault === "large" ? Buffer.concat([bytes, Buffer.from("x")]) : bytes;
        await route.fulfill({ contentType: "application/octet-stream", body });
      } finally {
        this.active--;
      }
    });
  }
}

async function pair(page: Page) {
  await page.getByLabel("Kod połączenia").fill(code.toLowerCase());
  await page.getByRole("button", { name: "Połącz urządzenie" }).click();
}

function settings(page: Page) {
  return page.getByRole("button", { name: "Ustawienia i pomoc" });
}

function exitSettings(page: Page) {
  return page.getByRole("button", { name: "Ustawienia — wróć" });
}

async function openSubject(page: Page) {
  if (await exitSettings(page).isVisible()) await exitSettings(page).click();
  await page.getByRole("button", { name: /Przyroda/ }).click();
}

function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function openLesson(page: Page, title: string, content: string) {
  await row(page, title).getByRole("button", { name: "Otwórz lekcję" }).click();
  const outer = page.locator("iframe.proof-frame").contentFrame();
  await expect(outer.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  await expect(outer.locator("iframe").contentFrame().getByRole("heading", { name: content })).toBeVisible();
}

async function returnToLibrary(page: Page) {
  await page.getByRole("button", { name: "Wróć do biblioteki" }).click();
}

async function ready(page: Page, count: number, total: number) {
  if (await page.locator("#subject-heading").isVisible() || await exitSettings(page).isVisible()) {
    const alreadyInSettings = await exitSettings(page).isVisible();
    if (!alreadyInSettings) await settings(page).click();
    await expect(page.locator(".settings-count")).toHaveText(`${count} / ${total}`);
    if (!alreadyInSettings) await exitSettings(page).click();
    return;
  }
  const offlineCount = page.getByText(`Dostępne offline: ${count} z ${total}`, { exact: true });
  if (count === 0 && !await page.evaluate(() => navigator.onLine)) {
    await expect(offlineCount.or(page.getByText("Brak pobranych lekcji", { exact: true }))).toBeVisible();
  } else {
    await expect(offlineCount).toBeVisible();
  }
}

async function sync(page: Page) {
  await settings(page).click();
  await page.getByRole("button", { name: /^(Synchronizuj teraz|Spróbuj ponownie)$/ }).click();
  await exitSettings(page).click();
}

async function reconnectReopenedPage(page: Page) {
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  if (await page.getByText("Brak internetu", { exact: true }).isVisible()) {
    // A Firefox page created offline may miss the DOM event when Playwright restores its context.
    // Dispatch the current connectivity state only after the browser confirms online access.
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
}

async function waitIdle(page: Page) {
  await expect(page.getByText("Synchronizacja · Pobieranie lekcji", { exact: true })).toHaveCount(0);
}

async function checkChildLayout(page: Page) {
  const layout = await page.evaluate(() => {
    const smallTargets = [...document.querySelectorAll("button, input, summary")].flatMap(element => {
      const { width, height } = element.getBoundingClientRect();
      return width && height && (width < 44 || height < 44) ? [element.textContent?.trim() || element.tagName] : [];
    });
    const { clientWidth, scrollWidth } = document.documentElement;
    return { smallTargets, overflow: scrollWidth - clientWidth, font: Number.parseFloat(getComputedStyle(document.documentElement).fontSize) };
  });
  expect(layout.smallTargets).toEqual([]);
  expect(layout.overflow).toBe(0);
  expect(layout.font).toBeCloseTo(20.8, 1);
}

test("UX-01 Polish child library fits a narrow enlarged layout and restores keyboard focus and reading position", async ({ page }) => {
  const lessons = Array.from({ length: 8 }, (_, index) => lesson(index + 1, 1));
  const last = lessons.at(-1)!;
  last.meta.title = "Zadanie " + "Ł".repeat(95);
  last.meta.description = "Ż".repeat(250);
  const mock = new DeviceFixture(...lessons);
  await mock.serve(page);
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto(origin);
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });

  const codeInput = page.getByLabel("Kod połączenia");
  await expect(codeInput).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(codeInput).toBeFocused();
  expect(await codeInput.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
  const installation = page.locator("summary").filter({ hasText: "Instrukcja instalacji" });
  await installation.focus();
  await installation.press("Enter");
  await expect(page.getByText(/Instalacja jest opcjonalna/)).toBeVisible();
  await expect(page.getByText(/Dodaj do ekranu głównego/)).toBeVisible();
  await expect(page.getByText(/Do ekranu początkowego/)).toBeVisible();
  await checkChildLayout(page);

  await pair(page);
  await ready(page, 8, 8);
  await expect(page.getByRole("heading", { name: "Moja Nauka" })).toBeFocused();
  const subjectButton = page.getByRole("button", { name: /Przyroda 8 lekcji/ });
  await subjectButton.focus();
  await subjectButton.press("Enter");
  await expect(page.getByRole("heading", { name: "Przyroda" })).toBeFocused();
  await checkChildLayout(page);
  for (const viewport of [{ width: 712, height: 1138 }, { width: 1138, height: 712 }]) {
    await page.setViewportSize(viewport);
    await checkChildLayout(page);
  }
  await page.setViewportSize({ width: 360, height: 720 });
  const opener = row(page, last.meta.title).getByRole("button", { name: "Otwórz lekcję" });
  await opener.focus();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await opener.press("Enter");
  const close = page.getByRole("button", { name: "Wróć do biblioteki" });
  await expect(close).toBeFocused();
  await checkChildLayout(page);
  await close.press("Enter");
  await expect(opener).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  const back = page.getByRole("button", { name: "Wróć do przedmiotów" });
  await back.focus();
  await back.press("Enter");
  await expect(subjectButton).toBeFocused();

  await page.getByRole("button", { name: "Ustawienia i pomoc" }).click();
  const reset = page.getByRole("button", { name: "Odłącz urządzenie" });
  await reset.focus();
  await reset.press("Enter");
  const cancel = page.getByRole("button", { name: "Anuluj" });
  await expect(cancel).toBeFocused();
  await cancel.press("Escape");
  await expect(reset).toBeFocused();
});

test("UX-01 Child viewer fills the four design viewports and preserves the original lesson on rotation", async ({ page }, testInfo) => {
  const original = await readFile(new URL("../../fixtures/rocks-soil.html", import.meta.url), "utf8");
  const item = lesson(1, 1, original);
  const longTitle = "Skały i gleba — powstawanie skał, rodzaje gleby oraz obieg materii w przyrodzie";
  item.meta.title = longTitle;
  item.meta.grade = null;
  const mock = new DeviceFixture(item);
  await mock.serve(page);
  const viewports = [
    { name: "portrait", width: 800, height: 1280 },
    { name: "landscape", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
    { name: "minimum", width: 360, height: 780 },
  ];
  await page.setViewportSize(viewports[0]!);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await openSubject(page);
  await expect(page.locator(".lesson-card")).toHaveCount(1);
  await row(page, longTitle).getByRole("button", { name: "Otwórz lekcję" }).click();
  const iframe = page.locator("iframe.proof-frame");
  const frameElement = await iframe.elementHandle();
  const nested = iframe.contentFrame().locator("iframe");
  await expect(nested).toHaveAttribute("sandbox", "allow-scripts");
  const nestedElement = await nested.elementHandle();
  const content = nested.contentFrame();
  await expect(content.locator(".slide.active")).toHaveCount(1);
  for (let index = 0; index < 10; index += 1) await content.locator("#next").click();
  await content.locator("#start-quiz").click();
  await content.locator("[data-answer]").first().click();
  const explanation = content.locator("#quiz-explain");
  await expect(explanation).not.toBeEmpty();
  const readingState = await explanation.textContent();

  for (const { name, width, height } of viewports) {
    await page.setViewportSize({ width, height });
    await expect.poll(() => iframe.boundingBox()).toEqual({ x: 0, y: 56, width, height: height - 56 });
    expect(await iframe.evaluate((current, initial) => current === initial, frameElement)).toBe(true);
    expect(await nested.evaluate((current, initial) => current === initial, nestedElement)).toBe(true);
    await expect(explanation).toHaveText(readingState ?? "");
    const measurements = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>(".viewer > header")!;
      const title = toolbar.querySelector("h1")!;
      const { clientWidth, clientHeight, scrollWidth, scrollHeight } = document.documentElement;
      return { toolbar: toolbar.offsetHeight, titleX: title.getBoundingClientRect().x,
        ellipsis: getComputedStyle(title).textOverflow, clipped: title.scrollWidth > title.clientWidth,
        overflow: [scrollWidth - clientWidth, scrollHeight - clientHeight], scroll: [window.scrollX, window.scrollY] };
    });
    expect(measurements).toMatchObject({ toolbar: 56, titleX: 168, ellipsis: "ellipsis", overflow: [0, 0], scroll: [0, 0] });
    if (width < 400) expect(measurements.clipped).toBe(true);
    await expect(page.getByRole("heading", { name: longTitle })).toBeVisible();
    await expect(page.getByRole("button", { name: "Wróć do biblioteki" })).toBeVisible();
    await testInfo.attach(`viewer-geometry-${name}`, { body: JSON.stringify({ width, height, ...measurements }),
      contentType: "application/json" });
    if (process.env.EDUAPP_CHILD_UX_SCREENSHOTS) await page.screenshot({ path: testInfo.outputPath(`viewer-long-title-${name}.png`) });
  }

  await returnToLibrary(page);
  await expect(row(page, longTitle).getByRole("button", { name: "Otwórz lekcję" })).toBeFocused();
});

test("UX-01 Child renders the subject grid and leaves paired lessons usable while downloads are pending", async ({ page }) => {
  const available = lesson(1, 1);
  const subjects = [subject, ...[
    ["matematyka", "Matematyka"], ["jezyk-polski", "Język polski"], ["historia", "Historia"],
    ["temat-dodatkowy", "Dodatkowy przedmiot o wyjątkowo długiej nazwie"],
  ].map(([slug, namePl], index) => ({ id: id(20 + index), slug: slug!, namePl: namePl!, sortOrder: 2 + index }))];
  const remaining = subjects.slice(1).map((entry, index) => {
    const item = lesson(2 + index, 1);
    item.meta.subjectId = entry.id;
    return item;
  });
  const mock = new DeviceFixture(available, ...remaining);
  mock.catalog.subjects = subjects;
  const pending = deferred();
  mock.beforeFile = async version => { if (version !== available.meta.version.id) await pending.wait; };
  await mock.serve(page);
  await page.goto(origin);
  try {
    await pair(page);
    await ready(page, 1, 5);
    const tiles = page.locator(".subject-tile");
    await expect(tiles).toHaveCount(5);
    await expect(tiles.last()).toHaveAttribute("data-subject", "inne");
    for (const [width, height, columns] of [[800, 1280, 2], [1280, 800, 3], [390, 844, 1], [360, 780, 1]] as const) {
      await page.setViewportSize({ width, height });
      const actual = await tiles.evaluateAll(cards => new Set(cards.map(card => card.getBoundingClientRect().left)).size);
      expect(actual).toBe(columns);
    }
    await settings(page).click();
    await page.getByRole("button", { name: "Lekcje dostępne offline — postęp pobierania" }).click();
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "1");
    await expect(page.getByRole("button", { name: "Spróbuj ponownie" })).toBeDisabled();
    await page.getByRole("button", { name: "Przejdź do biblioteki" }).click();
    await openSubject(page);
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
  } finally {
    pending.release();
  }
});

async function readStore(page: Page, storeName: string, key: string | string[]) {
  return page.evaluate(({ dbName, storeName, key }) => new Promise<unknown>((resolve, reject) => {
    const opening = indexedDB.open(dbName);
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(storeName);
      const read = tx.objectStore(storeName).get(key);
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), { dbName, storeName, key });
}

async function deleteStoreKey(page: Page, storeName: string, key: string | string[]) {
  await page.evaluate(({ dbName, storeName, key }) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open(dbName);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    opening.onerror = () => reject(opening.error);
  }), { dbName, storeName, key });
}

test("AT-03 two versions install, unchanged sync avoids downloads, delta installs one item", async ({ page }) => {
  const alpha = lesson(1, 1);
  const beta = lesson(2, 1);
  const beta2 = lesson(2, 2);
  const mock = new DeviceFixture(alpha, beta);
  mock.add(beta2);
  mock.faults.set(alpha.meta.version.id, "expired");
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 2, 2);
  await waitIdle(page);
  expect(mock.downloads.get(alpha.meta.version.id)).toBe(2);
  expect(mock.downloads.get(beta.meta.version.id)).toBe(1);

  await sync(page);
  await waitIdle(page);
  expect(mock.downloads.get(beta.meta.version.id)).toBe(1);
  expect(mock.downloads.get(alpha.meta.version.id)).toBe(2);

  mock.catalog = snapshot(2, alpha, beta2);
  await sync(page);
  await ready(page, 2, 2);
  await waitIdle(page);
  expect(mock.downloads.get(beta2.meta.version.id)).toBe(1);
  expect(mock.downloads.get(beta.meta.version.id)).toBe(1);
  expect(mock.downloads.get(alpha.meta.version.id)).toBe(2);
  await openSubject(page);
  await openLesson(page, "Lekcja 2", "Lekcja 2, wersja 2");
});

test("AT-03/AT-07 the first of 100 items opens while two download workers remain bounded", async ({ page }) => {
  const entries = Array.from({ length: 100 }, (_, index) => lesson(index + 1, 1));
  const mock = new DeviceFixture(...entries);
  const gate = deferred();
  mock.beforeFile = async versionId => {
    if (versionId !== entries[0]!.meta.version.id) await gate.wait;
  };
  await mock.serve(page);
  try {
    await page.goto(origin);
    await pair(page);
    await ready(page, 1, 100);
    await expect.poll(() => mock.active).toBe(2);
    await openSubject(page);
    await expect(row(page, "Lekcja 100").getByRole("button", { name: "Otwórz lekcję" })).toBeDisabled();
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
    expect(mock.downloads.size).toBe(3);
    expect(mock.maxActive).toBe(2);
    await returnToLibrary(page);
    gate.release();
    await ready(page, 100, 100);
    expect(mock.downloads.size).toBe(100);
  } finally {
    gate.release();
  }
});

for (const fault of ["hash", "short", "large", "unavailable", "interrupted"] as const) {
  test(`AT-05 rolls back the ${fault} update, retains v1 and completes another lesson`, async ({ page }) => {
    const alpha = lesson(1, 1);
    const alpha2 = lesson(1, 2);
    const beta = lesson(2, 1);
    const mock = new DeviceFixture(alpha);
    mock.add(alpha2);
    mock.add(beta);
    await mock.serve(page);
    await page.goto(origin);
    await pair(page);
    await ready(page, 1, 1);
    await waitIdle(page);
    mock.catalog = snapshot(2, alpha2, beta);
    mock.faults.set(alpha2.meta.version.id, fault);
    await sync(page);
    await ready(page, 1, 2);
    await waitIdle(page);
    expect(mock.downloads.get(alpha2.meta.version.id)).toBe(3);
    expect(await readStore(page, "lessonBytes", [alpha2.meta.id, alpha2.meta.version.id])).toBeUndefined();
    await openSubject(page);
    await expect(row(page, "Lekcja 1")).toContainText("Starsza wersja dostępna offline.");
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
    await returnToLibrary(page);
    await openLesson(page, "Lekcja 2", "Lekcja 2, wersja 1");
    await returnToLibrary(page);
    mock.faults.delete(alpha2.meta.version.id);
    await sync(page);
    await ready(page, 2, 2);
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 2");
  });
}

test("AT-07 malformed/family-mismatched catalog and revoked auth preserve last-known verified offline content", async ({ page }) => {
  const alpha = lesson(1, 1);
  const mock = new DeviceFixture(alpha);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  mock.catalog = { ...snapshot(2), family: { id: id(666), label: "Inna rodzina" } };
  await sync(page);
  await expect(page.getByRole("alert")).toContainText("Zaktualizuj aplikację");
  await ready(page, 1, 1);
  mock.catalogStatus = 403;
  await sync(page);
  await expect(page.getByRole("alert")).toContainText("Pobrane lekcje pozostają dostępne offline");
  await ready(page, 1, 1);
  await openSubject(page);
  await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
});

test("AT-15 detects lost shell cache independently, restores it online and safely re-pairs after IDB eviction", async ({ page, context }) => {
  const item = lesson(1, 1);
  const mock = new DeviceFixture(item);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await page.getByRole("button", { name: "Ustawienia i pomoc" }).click();
  await expect(page.getByText(/Przeglądarka może usunąć zapisane dane/)).toBeVisible();
  await context.setOffline(true);
  const cacheRemoved = await page.evaluate(async () => {
    for (const cache of await caches.keys()) await caches.delete(cache);
    return !await caches.match(location.origin + "/");
  });
  expect(cacheRemoved).toBe(true);
  // Allow one five-second health check interval and the worker's four-second response budget.
  await expect(page.getByText("Przygotowywanie trybu offline.", { exact: false })).toBeVisible({ timeout: 12_000 });
  await expect(page.locator(".settings-count")).toHaveCount(0);
  expect(await readStore(page, "installations", item.meta.id)).toBeDefined();
  await openSubject(page);
  await expect(row(page, "Lekcja 1").getByRole("button", { name: "Otwórz lekcję" })).toBeDisabled();
  await context.setOffline(false);
  await ready(page, 1, 1);
  expect(mock.downloads.get(item.meta.version.id)).toBe(1);

  await page.evaluate(dbName => new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(dbName);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
  }), dbName);
  await page.reload();
  await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
  await expect(page.getByText("Dostępne offline: 1 z 1")).toHaveCount(0);
  await pair(page);
  await ready(page, 1, 1);
  expect(mock.downloads.get(item.meta.version.id)).toBe(2);
});

test("AT-15 missing installed bytes fail closed and re-download instead of opening a remote lesson", async ({ page, context }) => {
  const item = lesson(1, 1);
  const mock = new DeviceFixture(item);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await context.setOffline(true);
  await deleteStoreKey(page, "lessonBytes", [item.meta.id, item.meta.version.id]);
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto(origin);
  await ready(reopened, 0, 1);
  await openSubject(reopened);
  await expect(row(reopened, "Lekcja 1")).toContainText("Zapisana lekcja jest niedostępna.");
  await expect(row(reopened, "Lekcja 1").getByRole("button", { name: /Spróbuj ponownie pobrać lekcję/ })).toBeDisabled();
  await expect(row(reopened, "Lekcja 1").getByRole("button", { name: "Otwórz lekcję" })).toHaveCount(0);
  await mock.serve(reopened);
  await reconnectReopenedPage(reopened);
  await sync(reopened);
  await ready(reopened, 1, 1);
  expect(mock.downloads.get(item.meta.version.id)).toBe(2);
});

test("AT-09/AT-17 reset clears child data across tabs and rejects an outstanding pre-reset download", async ({ page, context }) => {
  const initial = lesson(1, 1);
  const pending = lesson(2, 1);
  const mock = new DeviceFixture(initial);
  mock.add(pending);
  const gate = deferred();
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 1, 1);
  await waitIdle(peer);

  mock.catalog = snapshot(2, initial, pending);
  mock.beforeFile = async version => {
    if (version === pending.meta.version.id) await gate.wait;
  };
  try {
    await sync(page);
    await expect.poll(() => mock.downloads.get(pending.meta.version.id)).toBe(1);
    await peer.getByRole("button", { name: "Ustawienia i pomoc" }).click();
    await peer.getByRole("button", { name: "Odłącz urządzenie" }).click();
    await peer.getByRole("button", { name: "Odłącz i usuń lekcje" }).click();
    await expect(peer.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
    gate.release();
    await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
    await waitIdle(page);
    expect(await readStore(page, "identity", "identity")).toBeUndefined();
    expect(await readStore(page, "authorizedCatalog", "current")).toBeUndefined();
    expect(await readStore(page, "installations", initial.meta.id)).toBeUndefined();
    expect(await readStore(page, "lessonBytes", [pending.meta.id, pending.meta.version.id])).toBeUndefined();
  } finally {
    gate.release();
  }
});

for (const injected of ["quota", "abort"] as const) {
  test(`AT-05 ${injected} during atomic activation retains the old pointer and leaves no partial Blob`, async ({ page }) => {
    const item = lesson(1, 1);
    const updated = lesson(1, 2);
    const mock = new DeviceFixture(item);
    mock.add(updated);
    await mock.serve(page);
    await page.goto(origin);
    await pair(page);
    await ready(page, 1, 1);
    await waitIdle(page);
    await page.evaluate(mode => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        if (this.name === "installations" && mode === "quota") throw new DOMException("Injected storage limit", "QuotaExceededError");
        const result = original.call(this, value, key);
        if (this.name === "installations" && mode === "abort") this.transaction.abort();
        return result;
      };
    }, injected);
    mock.catalog = snapshot(2, updated);
    await sync(page);
    await ready(page, 0, 1);
    await waitIdle(page);
    if (injected === "quota") await expect(page.getByRole("alert")).toContainText("Brak miejsca na nowe lekcje.");
    expect(await readStore(page, "installations", item.meta.id)).toMatchObject({ installedVersionId: item.meta.version.id });
    expect(await readStore(page, "lessonBytes", [item.meta.id, updated.meta.version.id])).toBeUndefined();
    await openSubject(page);
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
    await page.reload();
    await ready(page, 1, 1);
    await waitIdle(page);
    expect(await readStore(page, "installations", item.meta.id)).toMatchObject({ installedVersionId: updated.meta.version.id });
  });
}

test("AT-05 closing a tab before its delayed download has finished leaves v1 intact for offline reopening", async ({ page, context }) => {
  const item = lesson(1, 1);
  const updated = lesson(1, 2);
  const mock = new DeviceFixture(item);
  mock.add(updated);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  mock.catalog = snapshot(2, updated);
  const gate = deferred();
  mock.beforeFile = async version => { if (version === updated.meta.version.id) await gate.wait; };
  try {
    await sync(page);
    await expect.poll(() => mock.downloads.get(updated.meta.version.id)).toBe(1);
    await page.close();
    gate.release();
    await context.setOffline(true);
    const restored = await context.newPage();
    await restored.goto(origin);
    await ready(restored, 0, 1);
    expect(await readStore(restored, "lessonBytes", [item.meta.id, updated.meta.version.id])).toBeUndefined();
    await openSubject(restored);
    await openLesson(restored, "Lekcja 1", "Lekcja 1, wersja 1");
  } finally {
    gate.release();
  }
});

test("AT-17 out-of-order catalog revisions and revoked in-flight lessons cannot overwrite current authorization", async ({ page, context }) => {
  const retired = lesson(1, 1);
  const visible = lesson(2, 1);
  const late = lesson(3, 1);
  const mock = new DeviceFixture(retired, visible);
  mock.add(late);
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 2, 2);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 2, 2);
  await waitIdle(peer);

  const staleCatalog = deferred();
  const arrived = deferred();
  const staleBytes = deferred();
  const staleReplacement = deferred();
  try {
    mock.catalogCapture = async current => {
      if (current.revision === 2) { arrived.release(); await staleCatalog.wait; }
      return current;
    };
    mock.catalog = snapshot(2, retired, visible);
    await sync(page);
    await arrived.wait;
    mock.catalog = snapshot(3, visible);
    await sync(peer);
    await ready(peer, 1, 1);
    staleCatalog.release();
    await ready(page, 1, 1);
    await waitIdle(page);
    expect(await readStore(page, "authorizedCatalog", "current")).toMatchObject({ revision: 3 });
    expect(await readStore(page, "installations", retired.meta.id)).toBeUndefined();

    mock.catalog = snapshot(4, visible, late);
    mock.beforeFile = async version => { if (version === late.meta.version.id) await staleBytes.wait; };
    await sync(page);
    await expect.poll(() => mock.downloads.get(late.meta.version.id)).toBe(1);
    mock.catalog = snapshot(5, visible);
    await sync(peer);
    await ready(peer, 1, 1);
    staleBytes.release();
    await waitIdle(page);
    expect(await readStore(page, "authorizedCatalog", "current")).toMatchObject({ revision: 5 });
    expect(await readStore(page, "installations", late.meta.id)).toBeUndefined();
    expect(await readStore(page, "lessonBytes", [late.meta.id, late.meta.version.id])).toBeUndefined();
    const replacement = lesson(3, 2);
    mock.add(replacement);
    mock.catalog = snapshot(6, visible, late);
    mock.beforeFile = async version => { if (version === late.meta.version.id) await staleReplacement.wait; };
    await sync(page);
    await expect.poll(() => mock.downloads.get(late.meta.version.id)).toBe(2);
    mock.catalog = snapshot(7, visible, replacement);
    await sync(peer);
    await ready(peer, 2, 2);
    staleReplacement.release();
    await waitIdle(page);
    expect(await readStore(page, "authorizedCatalog", "current")).toMatchObject({ revision: 7 });
    expect(await readStore(page, "installations", late.meta.id)).toMatchObject({ installedVersionId: replacement.meta.version.id });
    expect(await readStore(page, "lessonBytes", [late.meta.id, late.meta.version.id])).toBeUndefined();
    await page.reload();
    await ready(page, 2, 2);
  } finally {
    staleCatalog.release();
    staleBytes.release();
    staleReplacement.release();
  }
});

test("G2 garbage collection retains an open viewer's previous Blob and reclaims it after its tab closes", async ({ page, context }) => {
  const old = lesson(1, 1);
  const updated = lesson(1, 2);
  const mock = new DeviceFixture(old);
  mock.add(updated);
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 1, 1);
  await waitIdle(peer);

  await openSubject(page);
  await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
  expect(await page.evaluate(async () => (await navigator.locks.query()).held?.some(item => item.name?.startsWith("viewer:")))).toBe(true);
  mock.catalog = snapshot(2, updated);
  await sync(peer);
  await ready(peer, 1, 1);
  await waitIdle(peer);
  expect(await readStore(peer, "installations", old.meta.id)).toMatchObject({ installedVersionId: updated.meta.version.id });
  expect(await readStore(peer, "lessonBytes", [old.meta.id, old.meta.version.id])).toBeDefined();
  await expect(page.locator("iframe.proof-frame").contentFrame().locator("iframe").contentFrame().getByRole("heading", { name: "Lekcja 1, wersja 1" }))
    .toBeVisible();
  await page.close();
  await expect.poll(() => peer.evaluate(async () => (await navigator.locks.query()).held?.some(item => item.name?.startsWith("viewer:")))).toBe(false);
  await sync(peer);
  await waitIdle(peer);
  expect(await readStore(peer, "lessonBytes", [old.meta.id, old.meta.version.id])).toBeUndefined();
});

for (const named of ["legacy pair", "unpaired S1 proof"] as const) {
  test(`G2 safe v1-to-v2 migration: ${named}`, async ({ page }) => {
    const item = lesson(1, 1);
    const mock = new DeviceFixture(item);
    mock.catalogStatus = 503;
    await mock.serve(page);
    await page.route(origin + "/s2-migration-setup", async route => {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Migration fixture</title>" });
    });
    await page.goto(origin + "/s2-migration-setup");
    await page.evaluate(({ dbName, now, catalog, item, paired, deviceId }) => new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open(dbName, 1);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        const identity = db.createObjectStore("identity");
        const snapshots = db.createObjectStore("authorizedCatalog");
        const bytes = db.createObjectStore("lessonBytes", { keyPath: ["lessonId", "versionId"] });
        const installs = db.createObjectStore("installations", { keyPath: "lessonId" });
        db.createObjectStore("syncMeta");
        if (paired) {
          identity.put({ schemaVersion: 1, deviceId, familyId: catalog.family.id, familyLabel: "Dom",
            deviceToken: "A".repeat(43), pairedAt: now }, "identity");
        }
        snapshots.put({ ...catalog, receivedAt: now, lastSuccessfulSyncAt: now }, "current");
        const { id: versionId, sha256, sizeBytes } = item.meta.version;
        bytes.put({ lessonId: item.meta.id, versionId, sha256, sizeBytes, blob: new Blob([item.body]), verifiedAt: now });
        installs.put({ lessonId: item.meta.id, installedVersionId: versionId, sha256, sizeBytes, installedAt: now });
      };
      opening.onsuccess = () => { opening.result.close(); resolve(); };
      opening.onerror = () => reject(opening.error);
    }), { dbName, now, catalog: mock.catalog, item, paired: named === "legacy pair", deviceId: id(9100) });
    await page.goto(origin);
    if (named === "legacy pair") {
      await ready(page, 1, 1);
      await openSubject(page);
      await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
      expect(await readStore(page, "identity", "identity")).toMatchObject({ generation: expect.any(String) });
    } else {
      await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeEnabled();
      await expect(page.getByRole("button", { name: /Przyroda/ })).toHaveCount(0);
    }
    const version = await page.evaluate(dbName => new Promise<number>((resolve, reject) => {
      const opening = indexedDB.open(dbName);
      opening.onsuccess = () => {
        const database = opening.result;
        resolve(database.version);
        database.close();
      };
      opening.onerror = () => reject(opening.error);
    }), dbName);
    expect(version).toBe(2);
    expect(mock.downloads.size).toBe(0);
  });
}

test("AT-15 persistence grant and estimate are advisory and safe settings exclude credentials", async ({ page }) => {
  await page.addInitScript(() => {
    let calls = 0;
    Object.defineProperty(navigator.storage, "persist", { value: async () => { calls++; return false; } });
    Object.defineProperty(navigator.storage, "persisted", { value: async () => false });
    Object.defineProperty(navigator.storage, "estimate", { value: async () => ({ usage: 2 * 1024 * 1024, quota: 32 * 1024 * 1024 }) });
    Object.defineProperty(window, "testPersistCalls", { get: () => calls });
  });
  const mock = new DeviceFixture(lesson(1, 1));
  await mock.serve(page);
  await page.goto(origin);
  await page.getByLabel("Nazwa urządzenia").fill("Tablet do nauki");
  await pair(page);
  await ready(page, 1, 1);
  await page.getByRole("button", { name: "Ustawienia i pomoc" }).click();
  await page.locator("summary").filter({ hasText: "Instrukcja instalacji" }).click();
  await expect(page.getByText("Przeglądarka nie przyznała trwałej pamięci.")).toBeVisible();
  await expect(page.getByText("Szacowane użycie pamięci: 2 MB.")).toBeVisible();
  await expect(page.getByText("Nazwa urządzenia: Tablet do nauki", { exact: true })).toBeVisible();
  await expect(page.getByText("Identyfikator urządzenia: 6e64c984", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Ostatnia udana synchronizacja:/)).toBeVisible();
  await expect(page.getByText(/^Wersja aplikacji:/)).toBeVisible();
  await expect(page.getByText("A".repeat(43))).toHaveCount(0);
  await expect(page.getByText(id(9000))).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "testPersistCalls"))).toBe(1);
});

test("AT-07 foreground and reconnect trigger sync, unpaired offline explains first-connection requirement", async ({ page, context }) => {
  const item = lesson(1, 1);
  const updated = lesson(1, 2);
  const mock = new DeviceFixture(item);
  mock.add(updated);
  await mock.serve(page);
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByText("Do pierwszego połączenia potrzebny jest internet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeDisabled();
  await context.setOffline(false);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  const attempts = mock.catalogs;
  mock.catalog = snapshot(2, updated);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => mock.catalogs).toBeGreaterThan(attempts);
  await waitIdle(page);
  expect(mock.downloads.get(updated.meta.version.id)).toBe(1);
  await context.setOffline(true);
  const calls = mock.catalogs;
  mock.catalog = snapshot(3);
  await context.setOffline(false);
  await expect.poll(() => mock.catalogs).toBeGreaterThan(calls);
  await expect(page.getByText("Nie ma jeszcze lekcji.", { exact: true })).toBeVisible();
  await expect(page.getByText("Poproś opiekuna o dodanie pierwszej.", { exact: true })).toBeVisible();
  await expect(page.locator(".subject-list li")).toHaveCount(0);
  await expect(page.getByText("Wszystkie lekcje są dostępne offline")).toHaveCount(0);
});

test("AT-15 newer storage schema is preserved and shown as update-required", async ({ page }) => {
  await page.route(origin + "/s2-schema-setup", async route => {
    await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Future schema fixture</title>" });
  });
  await page.goto(origin + "/s2-schema-setup");
  await page.evaluate(dbName => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(dbName, 3);
    request.onupgradeneeded = () => request.result.createObjectStore("futureSchema").put("kept", "probe");
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), dbName);
  await page.goto(origin);
  await expect(page.getByRole("alert")).toContainText("Zaktualizuj aplikację");
  await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toHaveCount(0);
  expect(await readStore(page, "futureSchema", "probe")).toBe("kept");
});

test("AT-16 same-size corrupted local bytes never retain ready status or mount", async ({ page, context }) => {
  const item = lesson(1, 1);
  const mock = new DeviceFixture(item);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await context.setOffline(true);
  await page.evaluate(({ dbName, lemma, now }) => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open(dbName);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("lessonBytes", "readwrite");
      const { id: versionId, sizeBytes, sha256 } = lemma.version;
      tx.objectStore("lessonBytes").put({ lessonId: lemma.id, versionId, sizeBytes, sha256, verifiedAt: now,
        blob: new Blob([new Uint8Array(sizeBytes).fill(65)]) });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    opening.onerror = () => reject(opening.error);
  }), { dbName, lemma: item.meta, now });
  const reopened = await context.newPage();
  await page.close();
  await reopened.goto(origin);
  await ready(reopened, 0, 1);
  await openSubject(reopened);
  await expect(row(reopened, "Lekcja 1")).toContainText("Zapisana lekcja jest niedostępna.");
  await expect(row(reopened, "Lekcja 1").getByRole("button", { name: /Spróbuj ponownie pobrać lekcję/ })).toBeDisabled();
  await expect(row(reopened, "Lekcja 1").getByRole("button", { name: "Otwórz lekcję" })).toHaveCount(0);
  await expect(reopened.locator("iframe.proof-frame")).toHaveCount(0);
  await mock.serve(reopened);
  await reconnectReopenedPage(reopened);
  await sync(reopened);
  await ready(reopened, 1, 1);
  await openLesson(reopened, "Lekcja 1", "Lekcja 1, wersja 1");
});

test("AT-07 denied download authorization cancels pending writes and preserves last-known offline content", async ({ page }) => {
  const installed = lesson(1, 1);
  const denied = lesson(2, 1);
  const pending = lesson(3, 1);
  const mock = new DeviceFixture(installed);
  mock.add(denied);
  mock.add(pending);
  await mock.serve(page);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);

  const started = deferred();
  const hold = deferred();
  mock.beforeFile = async versionId => {
    if (versionId === pending.meta.version.id) { started.release(); await hold.wait; }
  };
  mock.authorizeFile = async versionId => {
    if (versionId !== denied.meta.version.id) return true;
    await started.wait;
    return false;
  };
  try {
    mock.catalog = snapshot(2, installed, denied, pending);
    await sync(page);
    await expect(page.getByRole("alert")).toContainText("Nie można teraz synchronizować.");
    await ready(page, 1, 3);
    expect(await readStore(page, "installations", pending.meta.id)).toBeUndefined();
    expect(await readStore(page, "installations", denied.meta.id)).toBeUndefined();
    await openSubject(page);
    await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");
    await returnToLibrary(page);
    hold.release();
    delete mock.authorizeFile;
    delete mock.beforeFile;
    await sync(page);
    await ready(page, 3, 3);
  } finally {
    hold.release();
  }
});

test("G2 retains a no-lock viewer's aged pin until explicit close", async ({ page, context }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "locks", { value: undefined }); });
  const old = lesson(1, 1);
  const updated = lesson(1, 2);
  const mock = new DeviceFixture(old);
  mock.add(updated);
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 1, 1);
  await waitIdle(peer);
  await openSubject(page);
  await openLesson(page, "Lekcja 1", "Lekcja 1, wersja 1");

  const agedPin = await page.evaluate(dbName => new Promise<string>((resolve, reject) => {
    const opening = indexedDB.open(dbName);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction("syncMeta", "readwrite");
      const cursor = tx.objectStore("syncMeta").openCursor();
      let pin: string | undefined;
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (typeof entry.key === "string" && entry.key.startsWith("viewer:") && entry.value.locked === false) {
          pin = entry.key;
          entry.update({ ...entry.value, pinnedAt: Date.now() - 48 * 60 * 60 * 1000 });
        } else entry.continue();
      };
      tx.oncomplete = () => { db.close(); if (pin) resolve(pin); else reject(new Error("Missing viewer pin")); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    opening.onerror = () => reject(opening.error);
  }), dbName);

  mock.catalog = snapshot(2, updated);
  await sync(peer);
  await ready(peer, 1, 1);
  await waitIdle(peer);
  expect(await readStore(peer, "installations", old.meta.id)).toMatchObject({ installedVersionId: updated.meta.version.id });
  expect(await readStore(peer, "lessonBytes", [old.meta.id, old.meta.version.id])).toBeDefined();
  await expect(page.locator("iframe.proof-frame").contentFrame().locator("iframe").contentFrame()
    .getByRole("heading", { name: "Lekcja 1, wersja 1" })).toBeVisible();

  await returnToLibrary(page);
  await expect.poll(() => readStore(peer, "syncMeta", agedPin)).toBeUndefined();
  await sync(peer);
  await waitIdle(peer);
  expect(await readStore(peer, "lessonBytes", [old.meta.id, old.meta.version.id])).toBeUndefined();
});

test("AT-07 authorization denial persists across tabs and offline reopening until newer authentication or reset", async ({ page, context }) => {
  const entry = lesson(1, 1);
  const mock = new DeviceFixture(entry);
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 1, 1);
  await waitIdle(peer);

  const denial = "Nie można teraz synchronizować.";
  mock.catalogStatus = 403;
  await sync(page);
  await expect(page.getByRole("alert")).toContainText(denial);
  await expect(peer.getByRole("alert")).toContainText(denial);
  await context.setOffline(true);
  const offline = await context.newPage();
  await offline.goto(origin);
  await expect(offline.getByRole("alert")).toContainText(denial);
  await ready(offline, 1, 1);
  await openSubject(offline);
  await openLesson(offline, "Lekcja 1", "Lekcja 1, wersja 1");
  await returnToLibrary(offline);

  mock.catalogStatus = 200;
  await mock.serve(offline);
  await context.setOffline(false);
  await sync(peer);
  await expect(peer.getByRole("alert")).toHaveCount(0);
  await waitIdle(peer);
  await expect(offline.getByRole("alert")).toHaveCount(0);
  expect(mock.downloads.get(entry.meta.version.id)).toBe(1);

  mock.catalogStatus = 403;
  await sync(peer);
  await expect(peer.getByRole("alert")).toContainText(denial);
  await peer.getByRole("button", { name: "Ustawienia i pomoc" }).click();
  await peer.getByRole("button", { name: "Odłącz urządzenie" }).click();
  await peer.getByRole("button", { name: "Odłącz i usuń lekcje" }).click();
  await expect(offline.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
  await expect(offline.getByRole("alert")).toHaveCount(0);
  expect(await readStore(offline, "syncMeta", "status")).toBeUndefined();
});

test("AT-17 a late library digest cannot repaint the previous identity after reset and re-pair", async ({ page, context }) => {
  const old = lesson(1, 1);
  const newest = lesson(2, 1);
  const mock = new DeviceFixture(old);
  mock.add(newest);
  const peer = await context.newPage();
  await Promise.all([mock.serve(page), mock.serve(peer)]);
  await page.goto(origin);
  await pair(page);
  await ready(page, 1, 1);
  await waitIdle(page);
  await peer.goto(origin);
  await ready(peer, 1, 1);
  await waitIdle(peer);
  await openSubject(page);

  const captured = deferred();
  const catalog = deferred();
  mock.catalog = snapshot(2, old);
  mock.catalogCapture = async value => {
    if (value.revision === 2) { captured.release(); await catalog.wait; }
    return value;
  };
  try {
    await sync(page);
    await captured.wait;
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      let unblock: () => void = () => undefined;
      const gate = new Promise<void>(resolve => { unblock = resolve; });
      const observation = { started: false, resolved: false, oldVisible: false };
      Reflect.set(window, "s2DigestObservation", observation);
      Reflect.set(window, "s2ReleaseDigest", unblock);
      Object.defineProperty(crypto.subtle, "digest", { value: async (algorithm: AlgorithmIdentifier, bytes: BufferSource) => {
        if (observation.started) return original(algorithm, bytes);
        observation.started = true;
        await gate;
        const hash = await original(algorithm, bytes);
        observation.resolved = true;
        return hash;
      } });
    });
    catalog.release();
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "s2DigestObservation").started)).toBe(true);
    await peer.getByRole("button", { name: "Ustawienia i pomoc" }).click();
    await peer.getByRole("button", { name: "Odłącz urządzenie" }).click();
    await peer.getByRole("button", { name: "Odłącz i usuń lekcje" }).click();
    await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
    mock.catalog = snapshot(1, newest);
    await pair(peer);
    await ready(peer, 1, 1);
    await expect(row(page, "Lekcja 2")).toBeVisible();
    await page.evaluate(() => {
      const observation = Reflect.get(window, "s2DigestObservation");
      new MutationObserver(() => {
        if (document.querySelector("main")?.textContent?.includes("Lekcja 1")) observation.oldVisible = true;
      }).observe(document.getElementById("root")!, { childList: true, subtree: true, characterData: true });
      Reflect.get(window, "s2ReleaseDigest")();
    });
    await expect.poll(() => page.evaluate(() => Reflect.get(window, "s2DigestObservation").resolved)).toBe(true);
    await expect(row(page, "Lekcja 2")).toBeVisible();
    await expect(row(page, "Lekcja 1")).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, "s2DigestObservation").oldVisible)).toBe(false);
  } finally {
    catalog.release();
    await page.evaluate(() => Reflect.get(window, "s2ReleaseDigest")?.()).catch(() => undefined);
  }
});

test("AT-05 rejects signed grants outside the exact local immutable download address", async ({ page }) => {
  const item = lesson(1, 1);
  const mock = new DeviceFixture(item);
  await mock.serve(page);
  await page.goto(origin);
  const requests: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname.includes("/__device-mock/")) requests.push(url.pathname);
  });

  const invalidGrants = [
    (url: string) => url.replace("127.0.0.1:4173", "127.0.0.1:4174"),
    (url: string) => url.replace("http:", "https:"),
    (url: string) => url.replace("/content/", "/wrong/"),
    (url: string) => url + "?",
    (url: string) => url + "#anchor",
    (url: string) => url.replace("/content/", "/content/../content/"),
    (url: string) => url.slice(0, -1) + "A",
  ];
  for (const [index, grant] of invalidGrants.entries()) {
    mock.signedGrant = grant;
    if (index === 0) await pair(page);
    else await sync(page);
    await expect(page.getByRole("alert")).toContainText("Pobrany plik lekcji jest niekompletny lub uszkodzony.");
    await waitIdle(page);
  }
  await ready(page, 0, 1);
  expect(requests).toEqual([]);
  expect(await readStore(page, "installations", item.meta.id)).toBeUndefined();
  delete mock.signedGrant;
  await sync(page);
  await ready(page, 1, 1);
  expect(mock.downloads.get(item.meta.version.id)).toBe(1);
});
