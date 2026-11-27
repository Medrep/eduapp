import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { ProofFrame } from "../../../scripts/proof-frame.tsx";
import { controllingProofWorker, observeWorker } from "../../../scripts/register-proof-worker.ts";
import { holdViewerLease, openLesson, releaseLesson, viewerStillAuthorized } from "./catalog-store.ts";
import { type Failure } from "./device-api.ts";
import { useLibrary } from "./use-library.ts";
import { type Lesson, type OfflineStatus } from "../../../packages/contracts/src/device.ts";
import { type Download } from "./catalog-sync.ts";
import { ChildProof } from "./s1-proof.tsx";
import appPackage from "../package.json";
import { probeOfflineShell } from "./offline-shell.ts";

declare const __SUPABASE_ORIGIN__: string | null;

const messages: Record<Failure, string> = {
  network: "Nie udało się sprawdzić aktualizacji. Korzystasz z pobranych lekcji.",
  auth: "Nie można teraz synchronizować. Pobrane lekcje pozostają dostępne offline. Poproś opiekuna o pomoc.",
  schema: "Zaktualizuj aplikację, aby pobierać nowe lekcje.",
  quota: "Brak miejsca na nowe lekcje. Zwolnij miejsce i spróbuj ponownie.",
  pair: "Nieprawidłowy lub wygasły kod. Poproś o nowy.",
  storage: "Pamięć urządzenia jest niedostępna. Zamknij inne karty Moja Nauka i spróbuj ponownie.",
  integrity: "Pobrany plik lekcji jest niekompletny lub uszkodzony. Spróbuj ponownie.",
  stale: "Stan połączenia zmienił się w innej karcie. Spróbuj ponownie.",
};

const statuses: Record<OfflineStatus, string> = {
  ready_latest: "Dostępna offline",
  ready_old_version: "Dostępna offline — starsza wersja. Aktualizacja oczekuje.",
  downloading: "Pobieranie",
  not_downloaded: "Wymaga pobrania",
  failed: "Błąd pobierania",
  storage_missing: "Zapisana lekcja jest niedostępna. Pobierz ponownie.",
};

type ViewerSelection = { lesson: Lesson; versionId: string; generation: string };

function Viewer({
  selection, eligible, close, unavailable,
}: {
  selection: ViewerSelection; eligible: () => boolean; close: () => void; unavailable: () => void;
}) {
  const { lesson, versionId } = selection;
  const [lease] = useState(() => crypto.randomUUID());
  const active = useRef<ReturnType<typeof holdViewerLease> | undefined>(undefined);
  useEffect(() => {
    const lifetime = holdViewerLease(lease);
    active.current = lifetime;
    return () => {
      active.current = undefined;
      lifetime.release();
      void releaseLesson(lease).catch(() => undefined);
    };
  }, [lease]);

  const read = useCallback(async () => {
    const lifetime = active.current;
    if (!lifetime || !eligible()) return undefined;
    const blob = await openLesson(lesson.id, versionId, lease, await lifetime.ready);
    if (active.current === lifetime && eligible()) return blob;
    await releaseLesson(lease);
    return undefined;
  }, [eligible, lease, lesson.id, versionId]);

  const confirm = useCallback(() => viewerStillAuthorized(lease), [lease]);

  return <section className="viewer" aria-label={lesson.title}>
    <header>
      <button id="reader-back" type="button" onClick={close}>Wróć do biblioteki</button>
      <h1>{lesson.title}</h1>
    </header>
    <ProofFrame title={lesson.title} read={read} onUnavailable={unavailable} isEligible={eligible} confirmEligibility={confirm} />
  </section>;
}

function InstallationHelp() {
  return <details>
    <summary>Instalacja aplikacji</summary>
    <p>Możesz korzystać z Mojej Nauki w przeglądarce. Instalacja jest opcjonalna.</p>
    <p>W Chrome na Androidzie otwórz menu i wybierz „Dodaj do ekranu głównego” lub „Zainstaluj aplikację”.</p>
    <p>W Safari użyj „Udostępnij” i „Do ekranu początkowego”. Po zainstalowaniu może być potrzebny nowy kod połączenia.</p>
  </details>;
}

function Settings({ reset, storage, library }: {
  reset: () => Promise<boolean>; storage: ReturnType<typeof useLibrary>["storage"];
  library?: NonNullable<ReturnType<typeof useLibrary>["library"]>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const remove = async () => {
    setBusy(true);
    try {
      if (await reset()) setConfirm(false);
    } finally {
      setBusy(false);
    }
  };
  const usage = storage.estimate?.usage;
  return <details>
    <summary>Ustawienia i pomoc</summary>
    {library?.device && <>
      <p>Nazwa urządzenia: {library.device.label ?? "Mój tablet"}</p>
      <p>Identyfikator urządzenia: {library.device.deviceId.slice(0, 8)}</p>
    </>}
    {library?.catalog && <p>Ostatnia udana synchronizacja: {new Date(library.catalog.lastSuccessfulSyncAt).toLocaleString("pl-PL")}</p>}
    <p>Wersja aplikacji: {appPackage.version}</p>
    <InstallationHelp />
    <p>Przeglądarka może usunąć zapisane dane. W razie potrzeby połącz urządzenie i pobierz lekcje ponownie.</p>
    {storage.persisted !== undefined && <p>{storage.persisted ? "Przeglądarka przyznała trwałą pamięć." : "Przeglądarka nie przyznała trwałej pamięci."}</p>}
    {typeof usage === "number" && Number.isFinite(usage) && <p>Szacowane użycie pamięci: {(usage / (1024 * 1024)).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} MB.</p>}
    <button ref={trigger} type="button" onClick={() => {
      setConfirm(true);
      requestAnimationFrame(() => cancel.current?.focus());
    }} hidden={confirm}>Odłącz urządzenie i usuń pobrane lekcje</button>
    {confirm && <section aria-label="Potwierdzenie odłączenia" onKeyDown={event => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setConfirm(false);
        requestAnimationFrame(() => trigger.current?.focus());
      }
    }}>
      <p>Odłączenie usuwa połączenie i wszystkie zapisane lekcje z tej przeglądarki.</p>
      <button type="button" disabled={busy} onClick={() => void remove()}>Usuń połączenie i lekcje</button>
      <button ref={cancel} type="button" disabled={busy} onClick={() => {
        setConfirm(false);
        requestAnimationFrame(() => trigger.current?.focus());
      }}>Anuluj</button>
    </section>}
  </details>;
}

function statusFor(versionId: string | undefined, lesson: Lesson, item: Download | undefined, missing: boolean): OfflineStatus {
  if (versionId) return versionId === lesson.version.id ? "ready_latest" : "ready_old_version";
  if (item === "downloading") return "downloading";
  if (item) return "failed";
  return missing ? "storage_missing" : "not_downloaded";
}

function LessonLibrary() {
  const { library, error, items, working, pairing, online, storage, everPaired, pair, reset, sync, refresh } = useLibrary();
  const [worker, setWorker] = useState<"waiting" | "ready" | "failed">("waiting");
  const [offlineShell, setOfflineShell] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState("");
  const [viewer, setViewer] = useState<ViewerSelection>();
  const [viewerError, setViewerError] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const active = useRef<ViewerSelection | undefined>(undefined);
  const scroll = useRef(0);
  const readerOpener = useRef("");
  const catalog = library?.catalog;
  const generation = library?.device?.generation;
  const viewerReady = offlineShell || (import.meta.env.DEV && worker === "ready");

  useEffect(() => observeWorker(setWorker), []);
  useEffect(() => {
    if (worker !== "ready") { setOfflineShell(false); return; }
    let disposed = false;
    const check = (repair = false) => {
      void probeOfflineShell(repair).then(ready => { if (!disposed) setOfflineShell(ready); });
    };
    const show = () => { if (document.visibilityState === "visible") check(navigator.onLine); };
    show();
    const timer = setInterval(() => check(), 5000);
    document.addEventListener("visibilitychange", show);
    window.addEventListener("online", show);
    window.addEventListener("offline", show);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", show);
      window.removeEventListener("online", show);
      window.removeEventListener("offline", show);
    };
  }, [worker]);

  const showViewer = Boolean(viewer && generation === viewer.generation && worker === "ready" &&
    catalog?.lessons.some(lesson => lesson.id === viewer.lesson.id));
  active.current = showViewer ? viewer : undefined;
  const eligible = useCallback(() => Boolean(active.current && controllingProofWorker()), []);
  const close = useCallback(() => {
    active.current = undefined;
    setViewer(undefined);
  }, []);
  const unavailable = useCallback(() => {
    close();
    setViewerError(true);
    void refresh();
  }, [close, refresh]);

  useEffect(() => {
    if (viewer && !showViewer) unavailable();
  }, [viewer, showViewer, unavailable]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void pair(code, label);
    setCode("");
  }

  const count = catalog?.lessons.filter(lesson =>
    library?.installed.get(lesson.id)?.versionId === lesson.version.id).length ?? 0;
  const total = catalog?.lessons.length ?? 0;
  const failures = [...items.values()].filter(value => value !== "downloading");
  const itemError = failures.includes("quota") ? "quota" : failures.includes("integrity") ? "integrity" : undefined;
  const { subjects, subjectCounts } = useMemo(() => {
    const subjectCounts = new Map<string, number>();
    for (const lesson of catalog?.lessons ?? []) {
      subjectCounts.set(lesson.subjectId, (subjectCounts.get(lesson.subjectId) ?? 0) + 1);
    }
    const subjects = (catalog?.subjects ?? []).filter(subject => subjectCounts.has(subject.id))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.namePl.localeCompare(b.namePl, "pl"));
    return { subjects, subjectCounts };
  }, [catalog]);
  const subject = subjects.find(entry => entry.id === selectedSubject);
  const subjectId = subject?.id;
  const lessons = useMemo(() => subjectId ? (catalog?.lessons ?? []).filter(lesson => lesson.subjectId === subjectId)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.title.localeCompare(b.title, "pl")) : [], [catalog, subjectId]);
  const tryAgain = Boolean(error || failures.length || library?.missing.size);
  const previousView = useRef({ showViewer, subjectId, generation });
  useLayoutEffect(() => {
    const previous = previousView.current;
    previousView.current = { showViewer, subjectId, generation };
    if (showViewer === previous.showViewer && subjectId === previous.subjectId && generation === previous.generation) return;
    if (showViewer) {
      window.scrollTo(0, 0);
      document.getElementById("reader-back")?.focus({ preventScroll: true });
    } else if (previous.showViewer) {
      const opener = document.getElementById(readerOpener.current);
      const target = opener instanceof HTMLButtonElement && !opener.disabled ? opener :
        document.getElementById(subjectId ? "subject-heading" : "library-heading");
      window.scrollTo(0, scroll.current);
      target?.focus({ preventScroll: true });
    } else if (generation !== previous.generation) {
      document.getElementById(generation ? "library-heading" : "code")?.focus();
    } else if (subjectId) {
      document.getElementById("subject-heading")?.focus();
    } else if (previous.subjectId) {
      (document.getElementById(`subject-${previous.subjectId}`) ?? document.getElementById("library-heading"))?.focus();
    }
  }, [showViewer, subjectId, generation]);

  return <main className={showViewer ? "viewer-shell" : undefined}>
    {showViewer && viewer ? <Viewer selection={viewer} eligible={eligible} close={close} unavailable={unavailable} /> : <>
      <h1 id="library-heading" tabIndex={-1}>Moja Nauka</h1>
      <p>{generation ? "Czego dziś się uczymy?" : "Twoje lekcje w jednym miejscu — także bez internetu."}</p>
      {!offlineShell && <p className="notice">{import.meta.env.DEV
        ? "Tryb offline wymaga kompilacji aplikacji."
        : worker === "failed"
          ? "Nie udało się uruchomić trybu offline. Otwórz aplikację ponownie."
          : "Przygotowywanie trybu offline. Otwórz aplikację ponownie po zakończeniu."}</p>}
      {viewerError && <p role="alert">Nie udało się bezpiecznie otworzyć lekcji. Wróć do biblioteki i sprawdź zapisany plik.</p>}
      {(error ?? itemError) && <p role="alert">{messages[(error ?? itemError)!]}</p>}
      {library || error ? (generation ? <>
        <section aria-label="Synchronizacja" className="sync-panel">
          <p role="status">{working ? "Synchronizacja · Pobieranie lekcji" : !online ? "Offline" :
            error || failures.length ? "Synchronizacja wymaga uwagi" : offlineShell && total > 0 && count === total ? "Aktualne" : "Biblioteka lekcji"}</p>
          {catalog && <>
            {working && <p>Pobrano {count} z {total}</p>}
            {offlineShell && <p>Dostępne offline: {count} z {total}</p>}
            {offlineShell && total > 0 && count === total && <p>Wszystkie lekcje są dostępne offline</p>}
          </>}
          {failures.length > 0 && <p>Błąd pobierania: {failures.length}</p>}
          {!online && !library?.installed.size && <p>Brak pobranych lekcji. Połącz się z internetem, aby je pobrać.</p>}
          <button type="button" disabled={working} onClick={() => void sync(true)}>
            {tryAgain ? "Spróbuj ponownie" : "Synchronizuj teraz"}
          </button>
        </section>
        {catalog && total === 0 && <p>Nie ma jeszcze lekcji. Poproś opiekuna o dodanie pierwszej.</p>}
        {subject ? <section aria-label={subject.namePl}>
          <button type="button" onClick={() => setSelectedSubject("")}>Wróć do przedmiotów</button>
          <h2 id="subject-heading" tabIndex={-1}>{subject.namePl}</h2>
          <ul className="lesson-list">
            {lessons.map(lesson => {
              const versionId = library?.installed.get(lesson.id)?.versionId;
              const item = items.get(lesson.id);
              const status = statusFor(versionId, lesson, item, Boolean(library?.missing.has(lesson.id)));
              return <li key={lesson.id}>
                <h3>{lesson.title}</h3>
                {lesson.grade !== null && <p>Klasa {lesson.grade}</p>}
                {lesson.description && <p>{lesson.description}</p>}
                <p>{offlineShell || !versionId ? statuses[status] : "Lekcja zapisana. Tryb offline jest niedostępny."}</p>
                {versionId && item === "downloading" && <p>Pobieranie aktualizacji</p>}
                {versionId && item && item !== "downloading" && <p>Błąd pobierania aktualizacji</p>}
                <button id={`open-lesson-${lesson.id}`} type="button" disabled={!versionId || !viewerReady} onClick={event => {
                  if (!versionId || !controllingProofWorker()) return;
                  scroll.current = window.scrollY;
                  readerOpener.current = event.currentTarget.id;
                  setViewerError(false);
                  setViewer({ lesson, versionId, generation });
                }}>Otwórz lekcję</button>
              </li>;
            })}
          </ul>
        </section> : <section aria-label="Przedmioty">
          <ul className="subject-list">
            {subjects.map(entry => <li key={entry.id}>
              <button id={`subject-${entry.id}`} type="button" onClick={() => setSelectedSubject(entry.id)}>
                {entry.namePl} <span>Liczba lekcji: {subjectCounts.get(entry.id)}</span>
              </button>
            </li>)}
          </ul>
        </section>}
        <Settings storage={storage} {...(library ? { library } : {})} reset={async () => {
          setViewerError(false);
          setSelectedSubject("");
          return reset();
        }} />
      </> : <>
        {(everPaired || library?.invalidIdentity) && <p>Zapisane lekcje nie są już dostępne. Połącz urządzenie ponownie i pobierz je.</p>}
        {!online && <p>Do pierwszego połączenia potrzebny jest internet.</p>}
        {library?.invalidIdentity || error === "storage" || error === "schema"
          ? <Settings storage={storage} reset={reset} />
          : <><form onSubmit={submit}>
            <label htmlFor="code">Kod połączenia</label>
            <input id="code" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXXX-XXXXX"
              autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} required />
            <label htmlFor="device-label">Nazwa urządzenia</label>
            <input id="device-label" value={label} onChange={event => setLabel(event.target.value)} placeholder="Mój tablet" maxLength={80} />
            <button type="submit" disabled={pairing || !online}>Połącz urządzenie</button>
            {pairing && <p role="status">Łączenie urządzenia</p>}
          </form><InstallationHelp /></>}
      </>) : <p role="status">Odczytywanie zapisanej biblioteki.</p>}
    </>}
  </main>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Brak elementu głównego aplikacji.");
const loopbackProof = !__SUPABASE_ORIGIN__ && location.hostname === "127.0.0.1" && location.hash === "#s1-proof";
createRoot(root).render(loopbackProof ? <ChildProof /> : <LessonLibrary />);
