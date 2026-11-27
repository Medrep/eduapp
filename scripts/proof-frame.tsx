import { useEffect, useRef } from "react";
import { decodeExactUtf8, matchesWrapperResponse, type ViewerWrapper } from "../packages/contracts/src/viewer-wrapper.ts";
import { controllingProofWorker } from "./register-proof-worker.ts";

declare const __VIEWER_WRAPPER__: ViewerWrapper;
const deniedFeatures = "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'";

function waitForLoad(frame: HTMLIFrameElement, parent: HTMLElement, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      frame.removeEventListener("load", loaded);
      reject(signal.reason);
    };
    const loaded = () => {
      signal.removeEventListener("abort", cancel);
      resolve();
    };
    frame.addEventListener("load", loaded, { once: true });
    signal.addEventListener("abort", cancel, { once: true });
    parent.append(frame);
  });
}

export function ProofFrame({
  title, read, onUnavailable, isEligible, confirmEligibility,
}: {
  title: string;
  read: () => Promise<Blob | undefined>;
  onUnavailable: () => void;
  isEligible?: () => boolean;
  confirmEligibility?: () => Promise<boolean>;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = root.current;
    if (!parent) return;
    const task = new AbortController();
    const { signal } = task;
    let disposed = false;
    const timeout = window.setTimeout(() => task.abort(), 10_000);
    const wrapper = __VIEWER_WRAPPER__;
    const url = new URL(wrapper.path, location.origin).href;
    const expected = new DOMParser().parseFromString(wrapper.html, "text/html").documentElement.outerHTML;

    async function mount() {
      const controllingWorker = controllingProofWorker();
      if (!controllingWorker) throw new Error("Uncontrolled shell");
      // Preflight the immutable cached response without a network-dependent fetch.
      // The controlling worker also validates the response it serves to the outer frame.
      const response = await caches.match(url);
      if (!response || !await matchesWrapperResponse(response, url, wrapper)) throw new Error("Invalid wrapper response");

      const outer = document.createElement("iframe");
      outer.className = "proof-frame";
      outer.title = "Izolowana ramka lekcji";
      outer.referrerPolicy = "no-referrer";
      outer.allow = deniedFeatures;
      outer.src = url;
      await waitForLoad(outer, parent!, signal);
      const target = outer.contentDocument;
      if (target?.URL !== url || target.doctype?.name !== "html" ||
          target.documentElement.outerHTML !== expected || controllingProofWorker() !== controllingWorker) {
        throw new Error("Unexpected wrapper document");
      }

      // The trusted storage reader checks eligibility after the wrapper is ready.
      const blob = await read();
      if (!blob) throw new Error("Unavailable source");
      const html = decodeExactUtf8(await blob.arrayBuffer());
      if (confirmEligibility && !await confirmEligibility()) throw new Error("Viewer authorization changed");
      signal.throwIfAborted();
      if (outer.contentDocument !== target || target.URL !== url ||
          target.documentElement.outerHTML !== expected || controllingProofWorker() !== controllingWorker ||
          (isEligible && !isEligible())) {
        throw new Error("Wrapper or eligibility changed");
      }

      const inner = target.createElement("iframe");
      inner.title = title;
      inner.setAttribute("sandbox", "allow-scripts");
      inner.referrerPolicy = "no-referrer";
      inner.allow = deniedFeatures;
      inner.srcdoc = html;
      target.body.append(inner);
    }

    void mount().catch(() => {
      if (disposed) return;
      // Let the host observe focus inside the failing frame before its immediate removal.
      try {
        onUnavailable();
      } finally {
        parent.replaceChildren();
      }
    }).finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      task.abort();
      window.clearTimeout(timeout);
      parent.replaceChildren();
    };
  }, [confirmEligibility, isEligible, onUnavailable, read, title]);

  return <div ref={root} />;
}
