import { isRetiredViewerPath, matchesWrapperResponse, type ViewerWrapper } from "../packages/contracts/src/viewer-wrapper.ts";

declare const __SHELL_ASSETS__: string[];
declare const __SHELL_REVISION__: string;
declare const __VIEWER_WRAPPER__: ViewerWrapper;

type LifetimeEvent = { waitUntil(promise: Promise<unknown>): void };
type ShellMessage = LifetimeEvent & { data: unknown; ports: MessagePort[] };
type FetchWorkerEvent = LifetimeEvent & { request: Request; respondWith(response: Promise<Response> | Response): void };
const worker = globalThis as unknown as {
  location: Location;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", listener: (event: LifetimeEvent) => void): void;
  addEventListener(type: "message", listener: (event: ShellMessage) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchWorkerEvent) => void): void;
};

function unavailable() {
  return new Response("Lekcja jest niedostępna.", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function registerStaticShellWorker(cachePrefix: string, childRecovery?: () => Response) {
  const { origin } = worker.location;
  const wrapper = __VIEWER_WRAPPER__;
  const wrapperUrl = new URL(wrapper.path, origin).href;
  const cacheName = `${cachePrefix}${__SHELL_REVISION__}`;
  const shellAssets = new Set(__SHELL_ASSETS__);

  async function populate() {
    const asset = await fetch(wrapperUrl, { cache: "reload", redirect: "error" });
    if (!await matchesWrapperResponse(asset, wrapperUrl, wrapper)) throw new Error("Invalid passive wrapper");
    const cache = await caches.open(cacheName);
    const shell = [...shellAssets].filter((path) => path !== wrapper.path);
    await cache.addAll(shell.map((path) => new Request(new URL(path, origin), { cache: "reload", redirect: "error" })));
    await cache.put(wrapperUrl, asset);
  }

  worker.addEventListener("install", (event) => {
    event.waitUntil(populate());
  });

  if (childRecovery) {
    let repair: Promise<void> | undefined;
    async function ready() {
      const cache = await caches.open(cacheName);
      const entries = new Set((await cache.keys()).map(request => request.url));
      const wrapperEntry = await cache.match(wrapperUrl);
      return [...shellAssets].every(path => entries.has(new URL(path, origin).href)) &&
        Boolean(wrapperEntry && await matchesWrapperResponse(wrapperEntry, wrapperUrl, wrapper));
    }
    worker.addEventListener("message", (event) => {
      const port = event.ports[0];
      if (!port || !["check-child-shell", "repair-child-shell"].includes(String(event.data))) return;
      event.waitUntil((async () => {
        try {
          let available = await ready();
          if (!available && event.data === "repair-child-shell") {
            repair ??= populate().finally(() => { repair = undefined; });
            await repair;
            available = await ready();
          }
          port.postMessage(available);
        } catch {
          port.postMessage(false);
        }
      })());
    });
  }

  worker.addEventListener("activate", (event) => {
    event.waitUntil((async () => {
      const obsolete = (await caches.keys()).filter((name) => name.startsWith(cachePrefix) && name !== cacheName);
      if (__SHELL_REVISION__ !== "development") await Promise.all(obsolete.map((name) => caches.delete(name)));
      await worker.clients.claim();
    })());
  });

  worker.addEventListener("fetch", (event) => {
    const { request } = event;
    const url = new URL(request.url);
    if (url.origin !== origin) return;
    if (isRetiredViewerPath(url.pathname)) {
      event.respondWith(unavailable());
      return;
    }
    if (url.pathname === "/__viewer" || url.pathname.startsWith("/__viewer/")) {
      if (url.href !== wrapperUrl || request.method !== "GET") {
        event.respondWith(unavailable());
        return;
      }
      event.respondWith((async () => {
        const response = await (await caches.open(cacheName)).match(wrapperUrl);
        return response && await matchesWrapperResponse(response, wrapperUrl, wrapper)
          ? response : unavailable();
      })().catch(() => unavailable()));
      return;
    }
    if (request.method !== "GET" || url.search || !shellAssets.has(url.pathname)) return;
    if (childRecovery && url.pathname === "/" && request.mode === "navigate") {
      event.respondWith((async () => {
        const cached = await caches.match(url.href, { cacheName }).catch(() => undefined);
        return cached ?? fetch(request, { cache: "no-store" }).catch(childRecovery);
      })());
      return;
    }
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(url.href) ?? fetch(request);
    })());
  });
}
