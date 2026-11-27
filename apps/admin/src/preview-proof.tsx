import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ProofFrame } from "../../../scripts/proof-frame.tsx";
import { referenceLesson, verifyReferenceLesson } from "../../../scripts/reference-lesson.ts";
import { controllingProofWorker, observeWorker } from "../../../scripts/register-proof-worker.ts";
import { deletePreview, latestPreview, readPreview, savePreview, sweepExpiredPreviews } from "./preview-store.ts";

export function AdminPreviewProof() {
  const [worker, setWorker] = useState<"waiting" | "ready" | "failed">("waiting");
  const [preview, setPreview] = useState<{ id: string; expiresAt: number }>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => observeWorker(setWorker), []);
  useEffect(() => {
    let active = true;
    void sweepExpiredPreviews().then(() => latestPreview(referenceLesson)).then((record) => {
      if (active) setPreview(record);
    }, () => {
      if (active) setError("Nie udało się odczytać zapisanych podglądów.");
    }).finally(() => {
      if (active) setBusy(false);
    });
    return () => { active = false; };
  }, []);

  const closePreview = useCallback(async (message = "") => {
    if (!preview) return;
    setPreview(undefined);
    setBusy(true);
    setError(message);
    try {
      await deletePreview(preview.id);
    } catch {
      setError("Nie udało się usunąć podglądu.");
    } finally {
      setBusy(false);
    }
  }, [preview]);

  const read = useCallback(() => preview ? readPreview(preview.id, referenceLesson) : Promise.resolve(undefined), [preview]);
  const isEligible = useCallback(() => Boolean(preview && Date.now() < preview.expiresAt), [preview]);
  const viewerUnavailable = useCallback(() => {
    void closePreview("Nie udało się bezpiecznie otworzyć podglądu.");
  }, [closePreview]);

  useEffect(() => {
    if (!preview) return;
    let active = true;
    const expire = () => {
      if (!active) return;
      active = false;
      void closePreview("Podgląd wygasł lub jest niedostępny.");
    };
    const timer = window.setTimeout(expire, Math.max(0, preview.expiresAt - Date.now()));
    const recheck = () => {
      if (!active || document.visibilityState === "hidden") return;
      if (!isEligible()) {
        expire();
        return;
      }
      void read().then((blob) => { if (!blob) expire(); }, expire);
    };
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [closePreview, isEligible, preview, read]);

  async function openPreview(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (!controllingProofWorker()) {
      setError("Podgląd nie jest jeszcze gotowy.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setPreview(await savePreview(await verifyReferenceLesson(file), referenceLesson.sha256));
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("Niezgodny")
        ? cause.message : "Nie udało się przygotować podglądu.");
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  return <main>
    <h1>Panel administratora</h1>
    <p>Próba techniczna podglądu lekcji wzorcowej</p>
    <p role="status">
      {worker === "ready" ? "Podgląd gotowy." : worker === "waiting" ? "Trwa przygotowanie podglądu." : "Nie udało się uruchomić podglądu."}
    </p>
    {error && <p role="alert">{error}</p>}
    {preview ? <section aria-label="Podgląd lekcji">
      <button type="button" onClick={() => void closePreview()}>Zamknij podgląd</button>
      {worker === "ready" && <ProofFrame title="Podgląd lekcji" read={read} onUnavailable={viewerUnavailable} isEligible={isEligible} />}
    </section> : <>
      <label htmlFor="fixture">Wybierz plik podglądu wzorcowego</label>
      <input id="fixture" type="file" accept=".html,text/html" onChange={(event) => void openPreview(event)} disabled={busy || worker !== "ready"} />
    </>}
  </main>;
}
