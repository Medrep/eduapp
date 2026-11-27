import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";
import { passiveWrapperHtml, wrapperHeaders, wrapperResourcePolicy, type ViewerRole } from "../../packages/contracts/src/viewer-wrapper.ts";
import { buildViewerWrapper } from "../../scripts/shell-config.ts";
import { referenceLesson } from "../../scripts/reference-lesson.ts";
import { playFixture } from "./fixture-interaction.ts";

const childOrigin = "http://127.0.0.1:4173";
const adminOrigin = "http://127.0.0.1:4174";
const fixture = fileURLToPath(new URL("../../fixtures/rocks-soil.html", import.meta.url));

// Playwright's isolated WebKit context could not import the operator-selected file.
// Give each WebKit proof a fresh, persistent profile so it can exercise the same file picker.
const test = base.extend({
  context: async ({ context, browserName, playwright }, use, testInfo) => {
    if (browserName !== "webkit") {
      await use(context);
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), "moja-nauka-s1-webkit-"));
    const { launchOptions, viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = testInfo.project.use;
    try {
      const persistent = await playwright.webkit.launchPersistentContext(profile, {
        ...launchOptions,
        headless: true,
        ...(viewport !== undefined ? { viewport } : {}),
        ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
        ...(isMobile !== undefined ? { isMobile } : {}),
        ...(hasTouch !== undefined ? { hasTouch } : {}),
        ...(userAgent !== undefined ? { userAgent } : {}),
      });
      try {
        await use(persistent);
      } finally {
        await persistent.close();
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  },
});
const origins = { child: childOrigin, admin: adminOrigin } as const;

async function controlled(page: Page, role: ViewerRole) {
  const origin = origins[role];
  const response = await page.goto(role === "child" ? origin + "/#s1-proof" : origin);
  const csp = response?.headers()["content-security-policy"];
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp?.split("; ")).toContain(`frame-src ${origin}${buildViewerWrapper(role).path}`);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
}

const outer = (page: Page) => page.locator("iframe.proof-frame");
const inner = (page: Page) => outer(page).contentFrame().locator("iframe");

async function chooseChildFile(page: Page) {
  await page.getByLabel("Wybierz plik lekcji wzorcowej").setInputFiles(fixture);
  await expect(page.getByRole("status")).toContainText("Lekcja zapisana na urządzeniu");
}

async function openLesson(page: Page, role: ViewerRole, select = true) {
  const wrapper = buildViewerWrapper(role);
  const navigation = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === wrapper.path && candidate.request().isNavigationRequest());
  if (role === "child") {
    if (select) await chooseChildFile(page);
    await page.getByRole("button", { name: "Otwórz lekcję" }).click();
  } else if (select) {
    await page.getByLabel("Wybierz plik podglądu wzorcowego").setInputFiles(fixture);
  }
  const result = await navigation;
  const responseHeaders = result.headers();
  expect(result.status()).toBe(200);
  expect(result.fromServiceWorker()).toBe(true);
  for (const [name, expected] of Object.entries(wrapperHeaders)) {
    expect(responseHeaders[name.toLowerCase()], name).toBe(expected);
  }
  expect(result.url()).toBe(origins[role] + wrapper.path);
  expect(await result.text()).toBe(wrapper.html);
  await expect(inner(page)).toHaveAttribute("sandbox", "allow-scripts");
  await expect(inner(page)).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(await inner(page).getAttribute("src")).toBeNull();
  const delivery = await inner(page).evaluate(async (element) => {
    const doc = element.ownerDocument;
    const bytes = new TextEncoder().encode((element as HTMLIFrameElement).srcdoc);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return {
      version: doc.querySelector("meta[name='viewer-build']")?.getAttribute("content"),
      meta: doc.querySelector("head meta[http-equiv='Content-Security-Policy']")?.getAttribute("content"),
      byteLength: bytes.length,
      hash: Array.from(hash, value => value.toString(16).padStart(2, "0")).join(""),
    };
  });
  expect(delivery).toEqual({
    version: `s1-srcdoc-v1-${role}`, meta: wrapperResourcePolicy,
    byteLength: referenceLesson.sizeBytes, hash: referenceLesson.sha256,
  });
  const holder = await inner(page).elementHandle();
  const frame = await holder?.contentFrame();
  if (!frame) throw new Error("Missing inner frame");
  await expect(frame.locator(".slide.active")).toBeVisible();
  expect(frame.url()).toBe("about:srcdoc");
  expect(await frame.evaluate(() => window.origin)).toBe("null");
  console.log(JSON.stringify({ role, wrapper: result.url(), serviceWorker: result.fromServiceWorker(), headers: responseHeaders, delivery, innerOrigin: "null" }));
  return frame;
}


for (const role of ["child", "admin"] as const) {
  test(`AT-04/AT-16/SEC-05 ${role} exact fixture, wrapper policy and complete interaction`, async ({ page }, testInfo) => {
    test.setTimeout(70_000);
    await controlled(page, role);
    const frame = await openLesson(page, role);
    await playFixture(frame, Boolean(testInfo.project.use.hasTouch));
    await page.getByRole("button", { name: role === "child" ? "Zamknij lekcję" : "Zamknij podgląd" }).click();
    await expect(outer(page)).toHaveCount(0);
    if (role === "admin") await expect.poll(() => previewCount(page)).toBe(0);
  });
}

async function previewCount(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mojanauka-admin-preview-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = db.transaction("previewBytes", "readonly").objectStore("previewBytes").count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  });
}

async function alterChildRecords(page: Page, mode: "unauthorized" | "stale" | "corrupt") {
  await page.evaluate(async ([variant, ids]) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mojanauka-s1-regression", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const name = variant === "unauthorized" ? "authorizedCatalog" : variant === "stale" ? "installations" : "lessonBytes";
        const tx = db.transaction(name, "readwrite");
        const store = tx.objectStore(name);
        const key = variant === "unauthorized" ? "current" : variant === "stale" ? ids.lessonId : [ids.lessonId, ids.versionId];
        const request = store.get(key);
        request.onsuccess = () => {
          if (variant === "unauthorized") store.put({ ...request.result, lessons: [] }, key);
          else if (variant === "stale") store.put({ ...request.result, installedVersionId: crypto.randomUUID() });
          else store.put({ ...request.result, blob: new Blob([new Uint8Array(ids.sizeBytes)]) });
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, [mode, referenceLesson] as const);
}

for (const mode of ["unauthorized", "stale", "corrupt"] as const) {
  test(`AT-16 ${mode} installed data is denied before inner assignment`, async ({ page }) => {
    await controlled(page, "child");
    await chooseChildFile(page);
    await alterChildRecords(page, mode);
    await page.getByRole("button", { name: "Otwórz lekcję" }).click();
    await expect(page.getByRole("alert")).toContainText("Nie udało się bezpiecznie otworzyć lekcji");
    await expect(outer(page)).toHaveCount(0);
  });
}

test("SEC-05 rejects unverified bytes and removes active previews at TTL", async ({ page }) => {
  await controlled(page, "admin");
  const picker = page.getByLabel("Wybierz plik podglądu wzorcowego");
  await picker.setInputFiles({ name: "sample.html", mimeType: "text/html", buffer: Buffer.from("<p>inert</p>") });
  await expect(page.getByRole("alert")).toContainText("Niezgodny");
  await expect(outer(page)).toHaveCount(0);
  await page.clock.install();
  await openLesson(page, "admin");
  expect(await previewCount(page)).toBe(1);
  await page.clock.fastForward(10 * 60 * 1000 + 1);
  await expect(outer(page)).toHaveCount(0);
  await expect.poll(() => previewCount(page)).toBe(0);
});

test("SEC-05 startup sweeps expired retained preview records", async ({ page }) => {
  await controlled(page, "admin");
  await openLesson(page, "admin");
  expect(await previewCount(page)).toBe(1);
  await page.clock.install({ time: Date.now() + 10 * 60 * 1000 + 1 });
  await page.reload();
  await expect.poll(() => previewCount(page)).toBe(0);
  await expect(outer(page)).toHaveCount(0);
});

test("SEC-05 loopback proof restores only the reference lesson", async ({ page }) => {
  await controlled(page, "admin");
  const picker = page.getByLabel("Wybierz plik podglądu wzorcowego");
  await expect(picker).toBeEnabled();
  await page.evaluate(async () => {
    const blob = new Blob(["<!doctype html><html lang=pl><p>Inna lekcja</p></html>"], { type: "text/html" });
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
    const sha256 = [...digest].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mojanauka-admin-preview-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const createdAt = Date.now();
        const transaction = db.transaction("previewBytes", "readwrite");
        transaction.objectStore("previewBytes").add({
          id: crypto.randomUUID(), blob, sha256, sizeBytes: blob.size, createdAt, expiresAt: createdAt + 600_000,
        });
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { db.close(); }
  });
  await page.reload();
  await expect(picker).toBeEnabled();
  await expect(outer(page)).toHaveCount(0);
  expect(await previewCount(page)).toBe(1);

  await openLesson(page, "admin");
  await page.reload();
  await expect(inner(page)).toHaveAttribute("sandbox", "allow-scripts");
  await page.getByRole("button", { name: "Zamknij podgląd" }).click();
  await expect(outer(page)).toHaveCount(0);
  await expect.poll(() => previewCount(page)).toBe(1);
});

test("SEC-05 returning from suspension rechecks retained preview eligibility", async ({ page }) => {
  await controlled(page, "admin");
  await openLesson(page, "admin");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("mojanauka-admin-preview-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("previewBytes", "readwrite");
        const request = tx.objectStore("previewBytes").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.update({ ...cursor.value, expiresAt: Date.now() - 1 });
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await expect(outer(page)).toHaveCount(0);
  await expect.poll(() => previewCount(page)).toBe(0);
});

for (const variant of ["missing", "wrong-version"] as const) {
  test(`AT-16 ${variant} cached wrapper fails closed before the lesson mounts`, async ({ page }) => {
    await controlled(page, "child");
    await chooseChildFile(page);
    const path = buildViewerWrapper("child").path;
    const fault = variant === "wrong-version" ? passiveWrapperHtml("admin") : undefined;
    const changed = await page.evaluate(async ([path, fault, headers]) => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        if (!await cache.match(path)) continue;
        if (fault) await cache.put(path, new Response(fault, { headers }));
        else await cache.delete(path);
        return true;
      }
      return false;
    }, [path, fault, wrapperHeaders] as const);
    expect(changed).toBe(true);
    await page.getByRole("button", { name: "Otwórz lekcję" }).click();
    await expect(page.getByRole("alert")).toContainText("Nie udało się bezpiecznie otworzyć lekcji");
    await expect(outer(page)).toHaveCount(0);
    expect((await page.request.get(childOrigin + path)).status()).toBe(200);
  });
}

for (const role of ["child", "admin"] as const) {
  test(`SEC-01/02 ${role} inner sandbox denies trusted state and ordinary network resources`, async ({ page, context }) => {
    const contacts: string[] = [];
    const sink = createServer((request, response) => {
      contacts.push(request.url ?? "");
      response.writeHead(204).end();
    });
    sink.on("upgrade", (request, socket) => {
      contacts.push(request.url ?? "");
      socket.destroy();
    });
    await new Promise<void>((resolve, reject) => {
      sink.once("error", reject);
      sink.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = sink.address();
      if (!address || typeof address === "string") throw new Error("Missing inert loopback sink");
      const url = `http://127.0.0.1:${address.port}/control/`;
      await controlled(page, role);
      const shellUrl = page.url();
      await page.evaluate(() => {
        localStorage.setItem("g1-inert-marker", "g1-top-canary");
        document.cookie = "g1-inert-marker=g1-top-canary; SameSite=Strict";
      });
      const frame = await openLesson(page, role);
      const denied = await frame.evaluate(async () => {
        const attempt = (access: () => unknown) => {
          try { access(); return false; } catch { return true; }
        };
        let cookie = "";
        try { cookie = document.cookie; } catch { /* denied */ }
        let workerAccess = true;
        try {
          const serviceWorker = navigator.serviceWorker;
          workerAccess = !serviceWorker ||
            (!serviceWorker.controller && !(await serviceWorker.getRegistration()));
        } catch { /* denied */ }
        return {
          opaque: window.origin === "null",
          parent: attempt(() => window.parent.document.title),
          top: attempt(() => window.top!.document.documentElement),
          storage: attempt(() => localStorage.getItem("g1-inert-marker")),
          indexedDB: attempt(() => indexedDB.open("g1-inert-db")),
          cookie: !cookie.includes("g1-top-canary"),
          workerAccess,
        };
      });
      expect(Object.values(denied).every(Boolean), JSON.stringify(denied)).toBe(true);
      const before = context.pages().length;
      const checks = await frame.evaluate(async (endpoint) => {
        const seen = new Set<string>();
        const onPolicy = (event: SecurityPolicyViolationEvent) => seen.add(event.effectiveDirective);
        document.addEventListener("securitypolicyviolation", onPolicy);
        void fetch(endpoint + "fetch").catch(() => {});
        try {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", endpoint + "xhr");
          xhr.send();
        } catch { /* denied */ }
        try {
          const socket = new WebSocket(endpoint.replace("http:", "ws:") + "socket");
          socket.addEventListener("open", () => socket.close());
        } catch { /* denied */ }
        const style = document.createElement("style");
        style.textContent = `@import url("${endpoint}style");`;
        document.head.append(style);
        const image = document.createElement("img");
        image.src = endpoint + "image";
        document.body.append(image);
        const media = document.createElement("audio");
        media.preload = "auto";
        media.src = endpoint + "media";
        document.body.append(media);
        media.load();
        const script = document.createElement("script");
        script.src = endpoint + "script";
        document.body.append(script);
        const child = document.createElement("iframe");
        child.src = endpoint + "frame";
        document.body.append(child);
        try {
          const worker = new Worker(endpoint + "worker");
          worker.addEventListener("error", event => { event.preventDefault(); worker.terminate(); }, { once: true });
        } catch { /* denied */ }
        const form = document.createElement("form");
        form.action = endpoint + "form";
        document.body.append(form);
        try { form.submit(); } catch { /* denied */ }
        const topLink = document.createElement("a");
        topLink.href = endpoint + "top";
        topLink.target = "_top";
        document.body.append(topLink);
        topLink.click();
        let popupDenied = true;
        try { popupDenied = window.open(endpoint + "popup") === null; } catch { /* denied */ }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
        return { seen: [...seen].sort(), popupDenied };
      }, url);
      expect(context.pages()).toHaveLength(before);
      expect(checks.seen).toContain("connect-src");
      expect(checks.seen).toContain("img-src");
      expect(checks.popupDenied).toBe(true);
      expect(contacts).toEqual([]);
      expect(frame.url()).toBe("about:srcdoc");
      expect(page.url()).toBe(shellUrl);
      const replacementUrl = frame.waitForURL("about:blank");
      await frame.evaluate(() => { location.assign("about:blank"); });
      await replacementUrl;
      const replacement = await frame.evaluate(() => {
        let topAccessible = false;
        try { topAccessible = Boolean(window.top!.document.documentElement); } catch { /* denied */ }
        return { origin: window.origin, topAccessible };
      });
      expect(replacement).toEqual({ origin: "null", topAccessible: false });
      expect(page.url()).toBe(shellUrl);
      console.log(JSON.stringify({ role, denied, checks, loopbackTraffic: contacts,
        observedLocalSelfNavigation: replacement, trustedShellUnchanged: true }));
    } finally {
      await new Promise<void>((resolve, reject) => {
        sink.close(error => error ? reject(error) : resolve());
        sink.closeAllConnections();
      });
    }
  });
}

test("AT-16 retired child and admin response namespaces return no viewer bytes", async ({ page }) => {
  for (const role of ["child", "admin"] as const) {
    await controlled(page, role);
    const paths = [
      `/__offline_lesson/${referenceLesson.lessonId}/${referenceLesson.versionId}/index.html`,
      "/__preview_lesson/00000000-0000-4000-8000-000000000000/index.html",
    ];
    const result = await page.evaluate((paths) => Promise.all(paths.map(async (path) => {
      const response = await fetch(path);
      return [response.status, response.headers.get("cache-control"), await response.text()];
    })), paths);
    for (const item of result) expect(item).toEqual([404, "no-store", "Lekcja jest niedostępna."]);
  }
});
