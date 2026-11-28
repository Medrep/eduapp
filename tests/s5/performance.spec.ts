import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test";
import { type Catalog, type Lesson } from "../../packages/contracts/src/device.ts";
import { referenceLesson } from "../../scripts/reference-lesson.ts";

const origin = "http://127.0.0.1:4185";
const subject = { id: id(20_001), slug: "przyroda", namePl: "Przyroda", sortOrder: 1 };
const family = { id: id(20_002), label: "Dom" };
const generatedAt = "2026-11-19T18:00:00Z";
const fixture = readFileSync(new URL("../../fixtures/rocks-soil.html", import.meta.url));
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function id(index: number) {
  return `6e64c984-c836-4371-a01a-${index.toString(16).padStart(12, "0")}`;
}

function lessonTitle(index: number) {
  return `Lekcja ${String(index).padStart(4, "0")}`;
}

async function mockCatalog(context: BrowserContext, count: number, withBodies: boolean) {
  const lessons: Lesson[] = Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      id: id(index), subjectId: subject.id, title: lessonTitle(index), description: null, grade: 4,
      publishedAt: generatedAt,
      version: { id: id(10_000 + index), number: 1, sha256: referenceLesson.sha256, sizeBytes: fixture.length },
    };
  });
  const catalog: Catalog = { schemaVersion: 1, revision: 1, generatedAt, family, subjects: [subject], lessons };
  const byVersion = new Map(lessons.map(lesson => [lesson.version.id, lesson]));
  const byPath = new Map(lessons.map(lesson => [lesson.version.id.replaceAll("-", "").repeat(2), lesson]));
  const transfer = { calls: 0, bytes: 0, active: 0, maxConcurrent: 0, grants: 0 };
  const deliveredVersions = new Set<string>();

  await context.route(origin + "/device/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/device/v1/pair") {
      await route.fulfill({ json: {
        deviceId: id(20_003), familyId: family.id, familyLabel: family.label,
        deviceToken: "A".repeat(43), serverTime: generatedAt,
      } });
    } else if (path === "/device/v1/catalog") {
      await route.fulfill({ json: catalog });
    } else if (path === "/device/v1/download-url") {
      transfer.grants++;
      const { versionId, lessonId } = route.request().postDataJSON();
      const lesson = byVersion.get(versionId);
      if (!withBodies || !lesson || lesson.id !== lessonId) {
        if (!withBodies) await delay(250);
        await route.fulfill({ status: 404 }).catch(error => {
          if (withBodies) throw error;
        });
        return;
      }
      const name = lesson.version.id.replaceAll("-", "").repeat(2);
      await route.fulfill({ json: {
        signedUrl: origin + "/__device-mock/content/" + name,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        sha256: lesson.version.sha256, sizeBytes: lesson.version.sizeBytes,
      } });
    } else {
      await route.fulfill({ status: 404 });
    }
  });

  await context.route(origin + "/__device-mock/content/*", async route => {
    const record = byPath.get(new URL(route.request().url()).pathname.split("/").at(-1) ?? "");
    if (!withBodies || !record) {
      await route.fulfill({ status: 404 });
      return;
    }
    transfer.calls++;
    transfer.active++;
    transfer.maxConcurrent = Math.max(transfer.active, transfer.maxConcurrent);
    try {
      await delay(20);
      await route.fulfill({ contentType: "application/octet-stream", body: fixture });
      deliveredVersions.add(record.version.id);
      transfer.bytes += fixture.length;
    } finally {
      transfer.active--;
    }
  });
  return { transfer, deliveredVersions, catalogBytes: Buffer.byteLength(JSON.stringify(catalog)) };
}

function observeHome(context: BrowserContext, count: number) {
  return context.addInitScript(total => {
    const mark = (name: string) => {
      if (!performance.getEntriesByName(name).length) performance.mark(name);
    };
    if (location.href === "about:srcdoc") {
      const inspect = () => {
        const active = document.querySelector(".slide.active");
        const image = document.querySelector('img[src^="data:image/jpeg;base64,"]');
        if (!active || !(image instanceof HTMLImageElement)) return;
        view.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => mark("bench-viewer-frame")));
        void image.decode().then(() => {
          if (image.naturalWidth > 0) mark("bench-viewer-image");
        }).catch(() => undefined);
      };
      const view = new MutationObserver(inspect);
      view.observe(document, { subtree: true, childList: true, attributes: true });
      inspect();
      return;
    }
    if (window !== top) return;
    document.addEventListener("submit", () => mark("bench-pair"), { capture: true });
    const update = () => {
      if (document.querySelector("main form input#code")) mark("bench-unpaired-home");
      for (const summary of document.querySelectorAll("main.library-content .child-notice strong")) {
        if (summary.textContent === "Brak pobranych lekcji" && document.querySelector(".subject-tile")) {
          mark("bench-library-home");
        }
        const ready = /^Dostępne offline: (\d+) z (\d+)$/.exec(summary.textContent ?? "");
        if (!ready || Number(ready[2]) !== total) continue;
        mark("bench-library-home");
        if (Number(ready[1]) > 0 && !performance.getEntriesByName("bench-first-install").length) {
          performance.mark("bench-first-install", { detail: Number(ready[1]) });
        }
        if (Number(ready[1]) === total) mark("bench-all-installed");
      }
    };
    new MutationObserver(update).observe(document, { subtree: true, childList: true, characterData: true });
  }, count);
}

function ready(page: Page, count: number, total: number) {
  return page.getByText(`Dostępne offline: ${count} z ${total}`, { exact: true });
}

async function start(page: Page) {
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "Połącz urządzenie" })).toBeVisible();
  const coldHomeMs = await page.evaluate(() => performance.getEntriesByName("bench-unpaired-home")[0]?.startTime);
  expect(coldHomeMs).toBeDefined();
  await page.getByLabel("Kod połączenia").fill("ABCDE-FG234");
  await page.getByRole("button", { name: "Połącz urządzenie" }).click();
  return coldHomeMs;
}

function marks(page: Page) {
  return page.evaluate(() => Object.fromEntries(performance.getEntriesByType("mark")
    .filter((mark): mark is PerformanceMark => mark instanceof PerformanceMark && mark.name.startsWith("bench-"))
    .map(mark => [mark.name, { ms: mark.startTime, detail: mark.detail as unknown }])));
}

async function measureRendering(page: Page, count: number) {
  return page.getByRole("button", { name: /Przyroda/ }).evaluate((node, expected) =>
    new Promise<{ rows: number; renderMs: number; presentationMs: number }>((resolve, reject) => {
      const from = performance.now();
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error("Catalog did not render its expected rows."));
      }, 10_000);
      const observer = new MutationObserver(() => {
        const rows = document.querySelectorAll(".lesson-list > li").length;
        if (rows !== expected) return;
        observer.disconnect();
        clearTimeout(timeout);
        const renderMs = performance.now() - from;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          resolve({ rows, renderMs, presentationMs: performance.now() - from });
        }));
      });
      observer.observe(document.body, { childList: true, subtree: true });
      (node as HTMLElement).click();
    }), count);
}

function measureScroll(page: Page) {
  return page.evaluate(async () => {
    const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
    const summaries: number[] = [];
    const span = document.documentElement.scrollHeight - innerHeight;
    window.scrollTo(0, 0);
    let before = await frame();
    const start = before;
    for (let step = 1; step <= 60; step++) {
      window.scrollTo(0, Math.round(step * span / 60));
      const current = await frame();
      summaries.push(current - before);
      before = current;
    }
    const arrival = scrollY;
    const sorted = summaries.sort((a, b) => a - b);
    const p = (fraction: number) => sorted[Math.ceil(summaries.length * fraction) - 1];
    return {
      scrollablePixels: span, pixelsReached: arrival, frames: summaries.length, testMs: before - start,
      frameMsMedian: p(0.50), frameMsP95: p(0.95), frameMsMax: sorted.at(-1),
    };
  });
}

async function heap(context: BrowserContext, target: Page | Frame) {
  const session = await context.newCDPSession(target);
  try {
    return await session.send("Runtime.getHeapUsage");
  } finally {
    await session.detach();
  }
}

async function auditStorage(page: Page, count: number) {
  return page.evaluate(async ({ expectedSize, expectedHash, count }) => {
    const result = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mojanauka-child-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = <T>(query: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      query.onsuccess = () => resolve(query.result);
      query.onerror = () => reject(query.error);
    });
    try {
      const keys = await read(result.transaction("lessonBytes").objectStore("lessonBytes").getAllKeys());
      const installationRecords = await read(result.transaction("installations").objectStore("installations").count());
      const recordCount = await read(result.transaction("authorizedCatalog").objectStore("authorizedCatalog").count());
      let storedBytes = 0;
      let verifiedBlobs = 0;
      for (const key of keys) {
        const record = await read(result.transaction("lessonBytes").objectStore("lessonBytes").get(key)) as
          { sizeBytes: number; sha256: string; blob: Blob };
        const digest = await crypto.subtle.digest("SHA-256", await record.blob.arrayBuffer());
        const hash = Array.from(new Uint8Array(digest), piece => piece.toString(16).padStart(2, "0")).join("");
        if (record.blob.size === expectedSize && record.sizeBytes === expectedSize && record.sha256 === expectedHash &&
            hash === expectedHash) verifiedBlobs++;
        storedBytes += record.blob.size;
      }
      return { blobRecords: keys.length, verifiedBlobs, storedBytes, installationRecords, catalogRecords: recordCount,
        expectedLessonCount: count, originEstimate: await navigator.storage.estimate() };
    } finally {
      result.close();
    }
  }, { expectedSize: fixture.length, expectedHash: referenceLesson.sha256, count });
}

async function measureOfflineOpen(page: Page, last: number) {
  const button = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: lessonTitle(last), exact: true }) })
    .getByRole("button", { name: "Otwórz lekcję" });
  await button.scrollIntoViewIfNeeded();
  const from = await button.evaluate(node => {
    const start = performance.timeOrigin + performance.now();
    (node as HTMLElement).click();
    return start;
  });
  const outer = page.locator("iframe.proof-frame").contentFrame();
  const inner = outer.locator("iframe");
  await expect(inner).toHaveAttribute("sandbox", "allow-scripts");
  const slide = inner.contentFrame().locator(".slide.active");
  await expect(slide).toBeVisible();
  const read = () => slide.evaluate((_node, started) => {
    const relative = (name: string) => {
      const entry = performance.getEntriesByName(name)[0];
      return entry ? performance.timeOrigin + entry.startTime - started : null;
    };
    return {
      openToPresentationFrameMs: relative("bench-viewer-frame"),
      openToFirstDecodedImageMs: relative("bench-viewer-image"),
    };
  }, from);
  await expect.poll(async () => Object.values(await read()).every(value => value !== null && value > 0)).toBe(true);
  const innerHandle = await inner.elementHandle();
  const childFrame = await innerHandle?.contentFrame();
  return { metrics: await read(), childFrame };
}

for (const scenario of [{ count: 100, withBodies: true }, { count: 1_000, withBodies: false }]) {
  const { count, withBodies } = scenario;
  test(`PERF-01 ${count} ${withBodies ? "verified HTML lessons" : "metadata-only lessons"}`,
    async ({ context, page, browser }, testInfo) => {
      expect(fixture.length).toBe(referenceLesson.sizeBytes);
      expect(createHash("sha256").update(fixture).digest("hex")).toBe(referenceLesson.sha256);
      const mock = await mockCatalog(context, count, withBodies);
      await observeHome(context, count);
      const coldHomeMs = await start(page);
      const installed = withBodies ? count : 0;
      await expect(ready(page, installed, count)).toBeVisible({ timeout: 120_000 });
      const onlineMarks = await marks(page);
      await context.setOffline(true);
      const response = await page.reload();
      expect(response?.fromServiceWorker()).toBe(true);
      const offlineSummary = withBodies ? ready(page, installed, count) : page.getByText("Brak pobranych lekcji", { exact: true });
      await expect(offlineSummary).toBeVisible({ timeout: 45_000 });
      const offlineMarks = await marks(page);
      const rendering = await measureRendering(page, count);
      const scrolling = await measureScroll(page);
      expect(scrolling.scrollablePixels).toBeGreaterThan(0);
      expect(Math.abs(scrolling.scrollablePixels - scrolling.pixelsReached)).toBeLessThanOrEqual(2);
      const beforeViewer = await heap(context, page);
      const offlineOpening = withBodies ? await measureOfflineOpen(page, count) : null;
      const withViewer = withBodies ? await heap(context, page) : null;
      const innerFrame = offlineOpening?.childFrame ? await heap(context, offlineOpening.childFrame).catch(() => null) : null;
      const storage = await auditStorage(page, count);
      expect(storage.blobRecords).toBe(installed);
      expect(storage.verifiedBlobs).toBe(installed);
      expect(storage.installationRecords).toBe(installed);
      expect(storage.catalogRecords).toBe(1);
      expect(storage.storedBytes).toBe(fixture.length * installed);
      expect(mock.transfer.calls).toBe(installed);
      expect(mock.deliveredVersions.size).toBe(installed);
      expect(mock.transfer.bytes).toBe(fixture.length * installed);
      expect(mock.transfer.maxConcurrent).toBe(withBodies ? 2 : 0);
      const pair = onlineMarks["bench-pair"]?.ms;
      const first = onlineMarks["bench-first-install"];
      const all = onlineMarks["bench-all-installed"];
      const offlineHomeMs = offlineMarks["bench-library-home"]?.ms;
      const pairedHome = onlineMarks["bench-library-home"]?.ms;
      expect(offlineHomeMs).toBeDefined();
      expect(pair).toBeDefined();
      expect(pairedHome).toBeGreaterThan(pair ?? 0);
      if (withBodies) {
        expect(first?.ms).toBeGreaterThan(pair ?? 0);
        expect(all?.ms).toBeGreaterThan(first?.ms ?? 0);
      }
      const result = {
        case: count, withBodies, profile: testInfo.project.name, browser: browser.version(),
        environment: await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight }, devicePixelRatio, touchPoints: navigator.maxTouchPoints,
        })),
        fixture: withBodies ? { sha256: referenceLesson.sha256, sizeBytes: fixture.length } : null,
        coldHomeMs, offlineHomeMs, catalogResponseBytes: mock.catalogBytes,
        pairToCatalogHomeMs: pairedHome !== undefined && pair !== undefined ? pairedHome - pair : null,
        downloads: { ...mock.transfer, distinctVersions: mock.deliveredVersions.size,
          fixedLoopbackDelayMs: withBodies ? 20 : 0,
          firstInstalledMsFromPair: first && pair !== undefined ? first.ms - pair : null,
          firstObservedInstallCount: first?.detail ?? null,
          completeMsFromPair: all && pair !== undefined ? all.ms - pair : null,
        },
        rendering, scrolling, offlineOpening: offlineOpening?.metrics ?? null, storage,
        memory: {
          scope: "CDP Runtime.getHeapUsage for the top-level renderer before/after mounting. No forced GC. Excludes browser, GPU and OS process memory. A separate sandbox renderer is sampled only if Playwright exposes its CDP session.",
          beforeViewer, withViewer, separateInnerFrame: innerFrame,
        },
      };
      await testInfo.attach("performance-metrics", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
      console.log("PERF-01", JSON.stringify(result));
    });
}
