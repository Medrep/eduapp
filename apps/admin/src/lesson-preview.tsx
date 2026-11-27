import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Integrity } from "../../../packages/contracts/src/device.ts";
import { ProofFrame } from "../../../scripts/proof-frame.tsx";
import { controllingProofWorker } from "../../../scripts/register-proof-worker.ts";
import { deletePreview, readPreview, savePreview } from "./preview-store.ts";

type Version = Integrity & { id: string };
type Preview = Awaited<ReturnType<typeof savePreview>> & { version: Version };

export function useLessonPreview(ready: boolean) {
  const stored = useRef<Preview | undefined>(undefined);
  const active = useRef(true);
  const pending = useRef<symbol | undefined>(undefined);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef<HTMLButtonElement | null>(null);
  const previewPanel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [prepared, setPrepared] = useState<Preview>();
  const [visible, setVisible] = useState<Preview>();
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const opener = restoreFocus.current;
    restoreFocus.current = null;
    const focused = document.activeElement;
    if (visible) closeButton.current?.focus();
    else if (opener?.isConnected && (!focused?.isConnected || focused === document.body || focused === document.documentElement)) {
      opener.focus();
    }
  }, [visible]);

  const clear = useCallback(async (message = "") => {
    const preview = stored.current;
    if (previewPanel.current?.contains(document.activeElement)) {
      restoreFocus.current = previewTrigger.current;
    }
    previewTrigger.current = null;
    stored.current = undefined;
    setPrepared(undefined);
    setVisible(undefined);
    setError(message);
    if (preview) await deletePreview(preview.id).catch(() => {
      if (active.current) setError("Nie udało się usunąć zapisu podglądu.");
    });
  }, []);

  const close = useCallback((message = "") => {
    pending.current = undefined;
    return clear(message);
  }, [clear]);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      pending.current = undefined;
      const preview = stored.current;
      stored.current = undefined;
      if (preview) void deletePreview(preview.id).catch(() => undefined);
    };
  }, []);

  // The same expiry applies to bytes waiting for their first preview and to an open frame.
  useEffect(() => {
    if (!prepared) return;
    const expire = () => {
      if (stored.current === prepared) void clear(visible ? "Podgląd wygasł lub jest niedostępny." : "");
    };
    const recheck = () => {
      if (document.visibilityState === "hidden" || stored.current !== prepared) return;
      if (Date.now() >= prepared.expiresAt) expire();
      else void readPreview(prepared.id, prepared.version).then(blob => { if (!blob) expire(); }, expire);
    };
    const timer = window.setTimeout(expire, Math.max(0, prepared.expiresAt - Date.now()));
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [clear, prepared, visible]);

  async function store(version: Version, blob: Blob, operation: symbol) {
    if (!active.current || pending.current !== operation) return undefined;
    await clear();
    if (!active.current || pending.current !== operation) return undefined;
    const preview = { ...await savePreview(blob, version.sha256), version };
    if (!active.current || pending.current !== operation) {
      await deletePreview(preview.id);
      return undefined;
    }
    stored.current = preview;
    setPrepared(preview);
    return preview;
  }

  function prepare(version: Version, blob: Blob) {
    const operation = Symbol();
    pending.current = operation;
    return store(version, blob, operation);
  }

  async function show(version: Version, download: () => Promise<Blob>, trigger: HTMLButtonElement) {
    if (!ready || !controllingProofWorker()) return;
    const operation = Symbol();
    pending.current = operation;
    const previous = stored.current;
    if (previous?.version.id === version.id && await readPreview(previous.id, version)) {
      if (stored.current === previous && active.current && pending.current === operation) {
        previewTrigger.current = trigger;
        setVisible(previous);
      }
      return;
    }
    const next = await store(version, await download(), operation);
    if (next && pending.current === operation) {
      previewTrigger.current = trigger;
      setVisible(next);
    }
  }

  const read = useCallback(() => visible ? readPreview(visible.id, visible.version) : Promise.resolve(undefined), [visible]);
  const eligible = useCallback(() => Boolean(visible && stored.current === visible && Date.now() < visible.expiresAt), [visible]);
  const unavailable = useCallback(() => {
    void close("Nie udało się bezpiecznie otworzyć podglądu.");
  }, [close]);

  return {
    prepare, show,
    panel: <>
      {error && <p role="alert">{error}</p>}
      {visible && <section ref={previewPanel} className="panel" aria-label="Podgląd lekcji">
        <h3>Podgląd lekcji</h3>
        <p>Widok w przeglądarce może różnić się od widoku na urządzeniu dziecka.</p>
        <button ref={closeButton} type="button" onClick={() => void close()}>Zamknij podgląd</button>
        {ready && <ProofFrame title="Podgląd lekcji" read={read} onUnavailable={unavailable} isEligible={eligible} />}
      </section>}
    </>,
  };
}
