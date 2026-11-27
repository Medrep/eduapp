import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { ProofFrame } from "../../../scripts/proof-frame.tsx";
import { referenceLesson, verifyReferenceLesson } from "../../../scripts/reference-lesson.ts";
import { controllingProofWorker, observeWorker } from "../../../scripts/register-proof-worker.ts";
import { readInstalledLesson, storeReferenceLesson } from "./lesson-store.ts";

const title = "Skały i gleba";
const readReference = () => readInstalledLesson(referenceLesson.lessonId, referenceLesson.versionId);

export function ChildProof() {
  const [worker, setWorker] = useState<"waiting" | "ready" | "failed">("waiting");
  const [stored, setStored] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => observeWorker(setWorker), []);
  useEffect(() => {
    let active = true;
    void readReference().then(
      (blob) => { if (active) setStored(Boolean(blob)); },
      () => { if (active) setError("Pamięć lekcji jest niedostępna."); },
    );
    return () => { active = false; };
  }, []);

  async function importLesson(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await storeReferenceLesson(await verifyReferenceLesson(file));
      setStored(true);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith("Niezgodny") ?
        cause.message : "Nie udało się zapisać lekcji na tym urządzeniu.");
    } finally {
      input.value = "";
      setBusy(false);
    }
  }

  function openLesson() {
    setError("");
    if (!controllingProofWorker()) {
      setError("Aplikacja nie jest jeszcze gotowa do pracy offline.");
      return;
    }
    setViewing(true);
  }

  const viewerUnavailable = useCallback(() => {
    setViewing(false);
    setError("Nie udało się bezpiecznie otworzyć lekcji. Odśwież aplikację lub sprawdź zapisany plik.");
  }, []);

  const status = worker === "waiting" ? "Trwa przygotowanie aplikacji do pracy offline."
    : worker === "failed" ? "Nie udało się uruchomić trybu offline."
    : !stored ? "Aplikacja gotowa. Wybierz plik lekcji wzorcowej."
    : import.meta.env.DEV ? "Lekcja zapisana. Próba restartu offline wymaga kompilacji."
    : "Lekcja zapisana na urządzeniu.";
  return <main>
    <h1>Moja Nauka</h1>
    <p>Biblioteka lekcji</p>
    <p role="status">{status}</p>
    {error && <p role="alert">{error}</p>}
    {viewing
      ? <section aria-label={title}>
        <button type="button" onClick={() => setViewing(false)}>Zamknij lekcję</button>
        <ProofFrame title={title} read={readReference} onUnavailable={viewerUnavailable} />
      </section>
      : <>
        <label htmlFor="fixture">Wybierz plik lekcji wzorcowej</label>
        <input id="fixture" type="file" accept=".html,text/html" onChange={(event) => void importLesson(event)} disabled={busy} />
        <button type="button" onClick={openLesson} disabled={busy || !stored || worker !== "ready"}>
          Otwórz lekcję
        </button>
      </>}
  </main>;
}

