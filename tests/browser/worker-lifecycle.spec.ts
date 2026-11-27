import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { preview } from "vite";
import { passiveWrapperHtml, workerPathForWrapper, wrapperHeaders, type ViewerRole } from "../../packages/contracts/src/viewer-wrapper.ts";
import { createMockGateway } from "../../scripts/mock-device-api.ts";
import { referenceLesson } from "../../scripts/reference-lesson.ts";
import { playFixture } from "./fixture-interaction.ts";
import { buildViewerWrapper, shellConfig, shellContentSecurityPolicy } from "../../scripts/shell-config.ts";

const project = new URL("../../", import.meta.url);
const fixture = fileURLToPath(new URL("fixtures/rocks-soil.html", project));
const mediaTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};

type WrapperFault = "missing" | "wrong-version" | "missing-header" | "wrong-policy" | "redirect" | "spa-fallback";

async function startVersionedShell(role: ViewerRole, installFault?: WrapperFault, staleController = false, withGateway = false) {
  const dist = fileURLToPath(new URL(`apps/${role}/dist/`, project));
  const wrapper = buildViewerWrapper(role);
  const files = new Map<string, Buffer>();
  for (const item of await readdir(dist, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) {
      const file = join(item.parentPath, item.name);
      files.set(`/${relative(dist, file)}`, await readFile(file));
    }
  }
  const originalWorker = files.get("/sw.js")?.toString();
  if (!originalWorker) throw new Error("Build the apps first.");
  const revision = originalWorker.match(/\b[a-f0-9]{24}\b/)?.[0];
  if (!revision) throw new Error("Missing generated shell revision.");
  const nextRevision = createHash("sha256").update(revision).digest("hex").slice(0, 24);
  const nextWorker = originalWorker.replaceAll(revision, nextRevision);
  let upgraded = false;
  let fault = installFault;
  let offline = false;
  let disconnected = false;
  let hits = 0;
  let wrapperHits = 0;
  let contentHits = 0;
  const refused: string[] = [];
  let gateway: ReturnType<typeof createMockGateway> | undefined;
  const server = createServer((request, response) => {
    const requestTarget = request.url ?? "/";
    const path = requestTarget.split("?")[0] || "/";
    hits += 1;
    if (disconnected) {
      refused.push(path);
      request.socket.destroy();
      return;
    }
    if (offline) {
      refused.push(path);
      response.writeHead(503).end();
      return;
    }
    if (gateway && (path.startsWith("/device/v1/") || path.startsWith("/__device-mock/"))) {
      if (path.startsWith("/__device-mock/content/")) contentHits += 1;
      void gateway(request, response, () => response.writeHead(404).end());
      return;
    }
    const origin = `http://${request.headers.host}`;
    if (staleController && path === "/stale-shell-setup") {
      response.writeHead(200, { "Content-Type": mediaTypes[".html"]! }).end("<p>Local worker setup</p>");
      return;
    }
    if (staleController && path === "/sw.js") {
      if (requestTarget !== "/sw.js") {
        response.writeHead(404).end();
      } else {
        response.writeHead(200, { "Content-Type": mediaTypes[".js"]! }).end(
          "self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));",
        );
      }
      return;
    }
    if (path === wrapper.path) {
      wrapperHits += 1;
      const headers: Record<string, string> = { ...wrapperHeaders, "Cache-Control": "no-store" };
      switch (fault) {
        case "missing": response.writeHead(404).end(); return;
        case "wrong-version": response.writeHead(200, headers).end(passiveWrapperHtml(role === "child" ? "admin" : "child")); return;
        case "missing-header": delete headers["Content-Security-Policy"]; break;
        case "wrong-policy": headers["Content-Security-Policy"] = "default-src 'none'"; break;
        case "redirect": response.writeHead(302, { Location: "/absent-test-wrapper" }).end(); return;
        case "spa-fallback":
          response.writeHead(200, {
            ...headers,
            "Content-Security-Policy": shellContentSecurityPolicy(origin, wrapper.path),
          }).end(files.get("/index.html"));
          return;
      }
      response.writeHead(200, headers).end(files.get(wrapper.path));
      return;
    }
    const asset = path === "/" ? "/index.html" : path;
    let body = files.get(asset);
    if (upgraded && asset === "/sw.js") body = Buffer.from(nextWorker);
    if (upgraded && asset === "/index.html" && body) {
      body = Buffer.from(body.toString().replace("<body>", '<body data-test-build="successor">'));
    }
    response.writeHead(body ? 200 : 404, {
      "Content-Type": mediaTypes[extname(asset)] ?? "text/plain",
      "Content-Security-Policy": shellContentSecurityPolicy(origin, wrapper.path),
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": asset === "/index.html" ? "no-store" : "no-cache",
    });
    response.end(body ?? "Nie znaleziono.");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port.");
  if (withGateway) gateway = createMockGateway(address.port);
  const prefix = role === "child" ? "mojanauka-shell-" : "mojanauka-preview-shell-";
  return {
    origin: `http://127.0.0.1:${address.port}`,
    currentCache: `${prefix}${revision}`,
    nextCache: `${prefix}${nextRevision}`,
    upgrade(nextFault?: WrapperFault) { upgraded = true; fault = nextFault; },
    cutoff() { offline = true; },
    disconnect() { disconnected = true; server.closeAllConnections(); },
    reconnect() { disconnected = false; },
    hits: () => hits,
    contentHits: () => contentHits,
    refused: () => [...refused],
    wrapperHits: () => wrapperHits,
    stop() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

const wrapperFrame = (page: Page) => page.locator("iframe.proof-frame").contentFrame();
const viewerFrame = (page: Page) => wrapperFrame(page).locator("iframe").contentFrame();

async function showChild(page: Page) {
  await page.getByRole("button", { name: /Przyroda/ }).click();
  await page.getByRole("listitem").filter({ hasText: "Skały i gleba" }).getByRole("button", { name: "Otwórz lekcję" }).click();
  await expect(viewerFrame(page).locator(".slide.active")).toBeVisible();
}

async function exactSource(page: Page) {
  const result = await wrapperFrame(page).locator("iframe").evaluate(async (frame: HTMLIFrameElement) => {
    const bytes = new TextEncoder().encode(frame.srcdoc);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return { size: bytes.length, digest: Array.from(digest, value => value.toString(16).padStart(2, "0")).join("") };
  });
  expect(result).toEqual({ size: referenceLesson.sizeBytes, digest: referenceLesson.sha256 });
}

for (const fault of ["missing", "wrong-version", "missing-header", "wrong-policy", "redirect", "spa-fallback"] as const) {
  test(`AT-16 ${fault} wrapper host response keeps the worker uncontrolled and fails closed`, async ({ page }) => {
    const server = await startVersionedShell("child", fault);
    try {
      await page.goto(server.origin + "/#s1-proof");
      await expect.poll(server.wrapperHits).toBeGreaterThan(0);
      await expect(page.getByRole("status")).toHaveText("Nie udało się uruchomić trybu offline.");
      await expect(page.getByRole("button", { name: "Otwórz lekcję" })).toBeDisabled();
      expect(await page.evaluate(() => navigator.serviceWorker.controller === null)).toBe(true);
      expect(await page.evaluate(async (path) => Boolean(await caches.match(path)), buildViewerWrapper("child").path)).toBe(false);
      await expect(page.locator("iframe")).toHaveCount(0);
      console.log(JSON.stringify({ fault, wrapperRequests: server.wrapperHits(), status: "unavailable", controlled: false, wrapperCached: false, mounted: false }));
    } finally {
      await server.stop();
    }
  });
}

test("AT-16 an old no-op controller and a valid seeded wrapper cache remain unavailable", async ({ browserName, playwright }, testInfo) => {
  const server = await startVersionedShell("child", undefined, true);
  const wrapper = buildViewerWrapper("child");
  const profile = await mkdtemp(join(tmpdir(), "moja-nauka-stale-controller-"));
  let context: BrowserContext | undefined;
  try {
    context = await playwright[browserName].launchPersistentContext(profile, profileOptions(testInfo));
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin + "/stale-shell-setup");
    await page.evaluate(async (path) => {
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const cache = await caches.open("g1-stale-controller-fixture");
      const url = new URL(path, location.origin).href;
      await cache.put(url, await fetch(url));
    }, wrapper.path);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.goto(server.origin + "/#s1-proof");
    await expect(page.getByRole("status")).toHaveText("Nie udało się uruchomić trybu offline.");
    await expect(page.getByRole("button", { name: "Otwórz lekcję" })).toBeDisabled();
    const staleReturn = await page.evaluate(async (path) => ({
      controller: navigator.serviceWorker.controller?.scriptURL,
      cacheReady: (await caches.match(path))?.status,
    }), wrapper.path);
    expect(staleReturn).toEqual({ controller: server.origin + "/sw.js", cacheReady: 200 });
    await expect(page.locator("iframe")).toHaveCount(0);
    console.log(JSON.stringify({ staleController: staleReturn.controller, seededExpectedWrapper: true, status: "unavailable", mounted: false }));
  } finally {
    await context?.close();
    await server.stop();
    await rm(profile, { recursive: true, force: true });
  }
});

test("AT-16 an unsuccessful update preserves an already approved controlling worker", async ({ page }) => {
  const server = await startVersionedShell("child");
  const path = buildViewerWrapper("child").path;
  try {
    await page.goto(server.origin + "/#s1-proof");
    await expect(page.getByRole("status")).toContainText("Aplikacja gotowa.");
    const wrapperHits = server.wrapperHits();
    server.upgrade("missing-header");
    await page.evaluate(async () => {
      (window as Window & { testApprovedController?: ServiceWorker | null }).testApprovedController = navigator.serviceWorker.controller;
      await (await navigator.serviceWorker.ready).update();
    });
    await expect.poll(server.wrapperHits).toBeGreaterThan(wrapperHits);
    await expect.poll(async () => page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return !reg?.installing && !reg?.waiting;
    })).toBe(true);
    await expect(page.getByRole("status")).toContainText("Aplikacja gotowa.");
    const preserved = await page.evaluate(async (path) => ({
      controller: navigator.serviceWorker.controller?.scriptURL,
      sameController: navigator.serviceWorker.controller ===
        (window as Window & { testApprovedController?: ServiceWorker | null }).testApprovedController,
      cached: (await caches.match(path))?.status,
    }), path);
    expect(preserved).toEqual({
      controller: server.origin + workerPathForWrapper(path), sameController: true, cached: 200,
    });
    console.log(JSON.stringify({ failedUpdate: true, preserved }));
  } finally {
    await server.stop();
  }
});

test("AT-16 Vite preview rejects wrong built wrapper bytes before granting wrapper headers", async ({ request }) => {
  const root = await mkdtemp(join(tmpdir(), "moja-nauka-wrapper-host-"));
  const wrapper = buildViewerWrapper("child");
  const built = join(root, "dist", wrapper.path.slice(1));
  try {
    await mkdir(dirname(built), { recursive: true });
    // This disposable build has the other role's passive wrapper at the expected path.
    await writeFile(built, passiveWrapperHtml("admin"));
    const server = await preview({ configFile: false, root, ...shellConfig(0, wrapper) });
    try {
      const address = server.httpServer.address();
      if (!address || typeof address === "string") throw new Error("Missing temporary preview port");
      const response = await request.get(`http://127.0.0.1:${address.port}${wrapper.path}`);
      expect(response.status()).toBe(404);
      expect(response.headers()["content-security-policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
      expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
      expect(await response.text()).toBe("Lekcja jest niedostępna.");
    } finally {
      await server.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function profileOptions(testInfo: TestInfo) {
  const { launchOptions, viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = testInfo.project.use;
  return {
    ...launchOptions,
    headless: true,
    ...(viewport !== undefined ? { viewport } : {}),
    ...(deviceScaleFactor !== undefined ? { deviceScaleFactor } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(userAgent !== undefined ? { userAgent } : {}),
  };
}

async function markCachedShell(page: Page, name: string) {
  const marker = randomUUID();
  await page.evaluate(async ({ name, marker }) => {
    const cache = await caches.open(name);
    const url = location.origin + "/";
    const entry = await cache.match(url);
    if (!entry) throw new Error("Missing cached document");
    const headers = new Headers(entry.headers);
    headers.set("X-Moja-Nauka-Offline-Proof", marker);
    // Only Cache Storage gets this response header; the origin never emits it.
    await cache.put(url, new Response(await entry.arrayBuffer(), { status: entry.status, headers }));
  }, { name, marker });
  return marker;
}

test("AT-04/COMPAT-01 child uses the verified offline wrapper across browser restart and worker update", async ({ playwright, browserName }, testInfo) => {
  test.setTimeout(60_000);
  const server = await startVersionedShell("child", undefined, false, true);
  const profile = await mkdtemp(join(tmpdir(), "moja-nauka-s1-profile-"));
  let context: BrowserContext | undefined;
  const engine = playwright[browserName];
  const launch = () => engine.launchPersistentContext(profile, profileOptions(testInfo));
  try {
    context = await launch();
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.getByLabel("Kod połączenia").fill("ABCDE-FG234");
    await page.getByRole("button", { name: "Połącz urządzenie" }).click();
    await expect(page.getByText("Dostępne offline: 2 z 2")).toBeVisible();
    const cachedPaths = await page.evaluate(async () => {
      const stores = await Promise.all((await caches.keys()).map(name => caches.open(name)));
      return (await Promise.all(stores.map(store => store.keys()))).flat()
        .map(request => new URL(request.url).pathname);
    });
    expect(cachedPaths.some(path => path.startsWith("/device/v1/") || path.startsWith("/__device-mock/"))).toBe(false);
    await showChild(page);
    await exactSource(page);

    server.upgrade();
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).waiting?.state))
      .toBe("installed");
    expect(await page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([server.currentCache, server.nextCache]));
    await expect(page.locator("body")).not.toHaveAttribute("data-test-build", "successor");
    await exactSource(page);
    await expect(viewerFrame(page).locator("body")).toBeVisible();
    const marker = await markCachedShell(page, server.nextCache);
    // Let the browser complete the waiting worker's last-client handoff before terminating it.
    const park = await context.newPage();
    await page.close();
    await expect.poll(async () => {
      const successor = await context!.newPage();
      try {
        const response = await successor.goto(server.origin, { waitUntil: "domcontentloaded" });
        return response?.headers()["x-moja-nauka-offline-proof"];
      } finally {
        await successor.close();
      }
    }, { intervals: [250, 500, 1000], timeout: 10_000 }).toBe(marker);
    await park.close();
    await context.setOffline(true);
    await context.close();
    context = undefined;

    const requests = server.hits();
    server.cutoff();
    context = await launch();
    await context.setOffline(true);
    page = context.pages()[0] ?? await context.newPage();
    const reopened = await page.goto(server.origin);
    expect(reopened?.status()).toBe(200);
    const workerStart = await page.evaluate(() =>
      (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.workerStart ?? 0);
    expect(reopened?.headers()["x-moja-nauka-offline-proof"]).toBe(marker);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(page.locator("body")).toHaveAttribute("data-test-build", "successor");
    await expect(page.getByText("Dostępne offline: 2 z 2")).toBeVisible();
    await showChild(page);
    await exactSource(page);
    expect(server.hits()).toBe(requests);
    const cached = await page.evaluate(() => caches.keys());
    expect(cached).toContain(server.nextCache);
    const inner = await wrapperFrame(page).locator("iframe").elementHandle();
    const fixtureFrame = await inner?.contentFrame();
    if (!fixtureFrame) throw new Error("Missing cached lesson viewer");
    await playFixture(fixtureFrame, Boolean(testInfo.project.use.hasTouch));
    await page.getByRole("button", { name: "Wróć do biblioteki" }).click();
    await expect(page.locator("iframe.proof-frame")).toHaveCount(0);
    const optionalBackgroundRequests = server.refused();
    expect(optionalBackgroundRequests.every(path => path === "/sw.js")).toBe(true);
    console.log(JSON.stringify({ profile: testInfo.project.name, restarted: true, offline: true, exactBlob: true,
      successorActive: true, fromServiceWorker: reopened?.fromServiceWorker(), workerStart, cacheMarkerMatched: true, originRequestsThroughViewerOpen: 0, optionalBackgroundRequests, oldCacheRetired: !cached.includes(server.currentCache), cached }));
  } finally {
    await context?.close();
    await server.stop();
    await rm(profile, { recursive: true, force: true });
  }
});

test("SEC-05 the local technical admin preview reopens after offline process restart within TTL", async ({ playwright, browserName }, testInfo) => {
  test.setTimeout(60_000);
  const server = await startVersionedShell("admin");
  const profile = await mkdtemp(join(tmpdir(), "moja-nauka-s1-preview-profile-"));
  let context: BrowserContext | undefined;
  const launch = () => playwright[browserName].launchPersistentContext(profile, profileOptions(testInfo));
  try {
    context = await launch();
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await page.getByLabel("Wybierz plik podglądu wzorcowego").setInputFiles(fixture);
    await expect(viewerFrame(page).locator(".slide.active")).toBeVisible();
    await exactSource(page);
    const marker = await markCachedShell(page, server.currentCache);
    await context.close();
    context = undefined;
    const requests = server.hits();
    server.cutoff();

    context = await launch();
    await context.setOffline(true);
    page = context.pages()[0] ?? await context.newPage();
    const reopened = await page.goto(server.origin);
    expect(reopened?.status()).toBe(200);
    expect(reopened?.headers()["x-moja-nauka-offline-proof"]).toBe(marker);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await expect(viewerFrame(page).locator(".slide.active")).toBeVisible();
    await exactSource(page);
    expect(server.hits()).toBe(requests);
    await page.getByRole("button", { name: "Zamknij podgląd" }).click();
    await expect(page.locator("iframe.proof-frame")).toHaveCount(0);
    console.log(JSON.stringify({ role: "admin", restarted: true, offline: true, exactBlob: true, cacheMarkerMatched: true, originRequests: 0 }));
  } finally {
    await context?.close();
    await server.stop();
    await rm(profile, { recursive: true, force: true });
  }
});

test("AT-15 cold child navigation gives inert offline recovery when only the shell cache is evicted", async ({ page, context }) => {
  const server = await startVersionedShell("child", undefined, false, true);
  try {
    await page.goto(server.origin);
    await page.getByLabel("Kod połączenia").fill("ABCDE-FG234");
    await page.getByRole("button", { name: "Połącz urządzenie" }).click();
    await expect(page.getByText("Dostępne offline: 2 z 2")).toBeVisible();
    const downloads = server.contentHits();
    expect(downloads).toBe(2);
    const persisted = await page.evaluate(async lessonId => {
      for (const key of await caches.keys()) await caches.delete(key);
      const cacheMissing = !await caches.match(location.origin + "/");
      const installed = await new Promise<boolean>((resolve, reject) => {
        const opening = indexedDB.open("mojanauka-child-v1");
        opening.onsuccess = () => {
          const db = opening.result;
          const read = db.transaction("installations").objectStore("installations").get(lessonId);
          read.onsuccess = () => { db.close(); resolve(Boolean(read.result)); };
          read.onerror = () => { db.close(); reject(read.error); };
        };
        opening.onerror = () => reject(opening.error);
      });
      return { cacheMissing, installed };
    }, referenceLesson.lessonId);
    expect(persisted).toEqual({ cacheMissing: true, installed: true });

    server.disconnect();
    const cold = await context.newPage();
    await page.close();
    const response = await cold.goto(server.origin);
    expect(response?.status()).toBe(503);
    expect(response?.headers()["cache-control"]).toBe("no-store");
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
    expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response?.headers()["x-content-type-options"]).toBe("nosniff");
    await expect(cold.getByRole("heading", { name: "Nie można teraz otworzyć aplikacji." })).toBeVisible();
    await expect(cold.getByText("Połącz się z internetem i otwórz Moja Nauka ponownie.")).toBeVisible();
    await expect(cold.locator("script, iframe, form")).toHaveCount(0);
    await expect(cold.getByText("Skały i gleba")).toHaveCount(0);
    expect(server.refused()).toContain("/");

    server.reconnect();
    await cold.goto(server.origin);
    await expect(cold.getByText("Dostępne offline: 2 z 2")).toBeVisible();
    expect(await cold.evaluate(async () => Boolean(await caches.match(location.origin + "/")))).toBe(true);
    await showChild(cold);
    await exactSource(cold);
    expect(server.contentHits()).toBe(downloads);
    console.log(JSON.stringify({ cacheMissing: true, idbRetained: true, transportCut: true, inertStatus: 503, restored: true, extraDownloads: 0 }));
  } finally {
    await server.stop();
  }
});
