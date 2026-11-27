import { workerPathForWrapper, type ViewerWrapper } from "../packages/contracts/src/viewer-wrapper.ts";

declare const __VIEWER_WRAPPER__: ViewerWrapper;

function expectedWorkerUrl() {
  return new URL(workerPathForWrapper(__VIEWER_WRAPPER__.path), location.origin).href;
}

function matchesWorker(worker: ServiceWorker | null, expected: string) {
  return worker?.scriptURL === expected && worker.state !== "redundant";
}

export function controllingProofWorker() {
  const controller = navigator.serviceWorker?.controller ?? null;
  return matchesWorker(controller, expectedWorkerUrl()) ? controller : null;
}

export function observeWorker(setState: (state: "waiting" | "ready" | "failed") => void) {
  const serviceWorker = navigator.serviceWorker;
  if (!serviceWorker) {
    setState("failed");
    return;
  }

  const expected = expectedWorkerUrl();
  let registration: ServiceWorkerRegistration | undefined;
  let installing: ServiceWorker | null = null;
  let disposed = false;
  let rejected = false;

  const refresh = () => {
    if (disposed) return;
    const current = registration?.installing ?? null;
    if (current !== installing) {
      installing?.removeEventListener("statechange", refresh);
      installing = current;
      installing?.addEventListener("statechange", refresh);
    }

    if (matchesWorker(serviceWorker.controller, expected)) {
      setState("ready");
    } else if (rejected || (registration && ![
      current, registration.waiting, registration.active,
    ].some(worker => matchesWorker(worker, expected)))) {
      setState("failed");
    } else {
      setState("waiting");
    }
  };

  serviceWorker.addEventListener("controllerchange", refresh);
  refresh();
  void serviceWorker.register(expected, { scope: "/", updateViaCache: "none" }).then((value) => {
    if (disposed) return;
    registration = value;
    registration.addEventListener("updatefound", refresh);
    refresh();
  }, () => {
    rejected = true;
    refresh();
  });
  return () => {
    disposed = true;
    serviceWorker.removeEventListener("controllerchange", refresh);
    registration?.removeEventListener("updatefound", refresh);
    installing?.removeEventListener("statechange", refresh);
  };
}
