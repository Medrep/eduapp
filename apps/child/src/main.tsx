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
import { probeOfflineShell } from "./offline-shell.ts";
import { Icon } from "./child-icons.tsx";
import {
  Brand, DownloadProgress, InstallationHelp, Notice, Recovery, Settings, ShellHeader,
  StatusBadge, SubjectTile, lessonsLabel, subjectsLabel,
} from "./child-ui.tsx";

declare const __SUPABASE_ORIGIN__: string | null;

const messages: Record<Failure, string> = {
  network: "Nie udało się sprawdzić aktualizacji.",
  auth: "Nie można teraz synchronizować. Poproś opiekuna o pomoc.",
  schema: "Zaktualizuj aplikację, aby pobierać nowe lekcje.",
  quota: "Brak miejsca na nowe lekcje. Zwolnij miejsce i spróbuj ponownie.",
  pair: "Nieprawidłowy lub wygasły kod. Poproś o nowy.",
  storage: "Pamięć urządzenia jest niedostępna. Zamknij inne karty Moja Nauka i spróbuj ponownie.",
  integrity: "Pobrany plik lekcji jest niekompletny lub uszkodzony. Spróbuj ponownie.",
  stale: "Stan połączenia zmienił się w innej karcie. Spróbuj ponownie.",
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
      <button id="reader-back" className="button reader-back" type="button" aria-label="Wróć do biblioteki" onClick={close}>
        <Icon name="back" /><span>Biblioteka</span>
      </button>
      <span className="viewer-divider" aria-hidden="true" />
      <h1>{lesson.title}</h1>
    </header>
    <ProofFrame title={lesson.title} read={read} onUnavailable={unavailable} isEligible={eligible} confirmEligibility={confirm} />
  </section>;
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
  const [panelSelection, setPanelSelection] = useState<{ name: "settings" | "sync"; generation: string | undefined }>();
  const [viewer, setViewer] = useState<ViewerSelection>();
  const [viewerError, setViewerError] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const active = useRef<ViewerSelection | undefined>(undefined);
  const scroll = useRef(0);
  const readerOpener = useRef("");
  const panelOpener = useRef("");
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
  const panel = panelSelection?.generation === generation ? panelSelection?.name : undefined;
  function openPanel(name: "settings" | "sync", opener: string) {
    panelOpener.current = opener;
    setPanelSelection({ name, generation });
  }
  const closePanel = () => setPanelSelection(undefined);
  const previousView = useRef({ showViewer, subjectId, generation, panel });
  useLayoutEffect(() => {
    const previous = previousView.current;
    previousView.current = { showViewer, subjectId, generation, panel };
    if (showViewer === previous.showViewer && subjectId === previous.subjectId && generation === previous.generation && panel === previous.panel) return;
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
    } else if (panel) {
      document.getElementById("panel-heading")?.focus();
    } else if (previous.panel) {
      (document.getElementById(panelOpener.current) ??
        document.getElementById(subjectId ? "subject-heading" : "library-heading"))?.focus();
    } else if (subjectId) {
      document.getElementById("subject-heading")?.focus();
    } else if (previous.subjectId) {
      (document.getElementById(`subject-${previous.subjectId}`) ?? document.getElementById("library-heading"))?.focus();
    }
  }, [showViewer, subjectId, generation, panel]);

  if (showViewer && viewer) return <main className="viewer-shell">
    <Viewer selection={viewer} eligible={eligible} close={close} unavailable={unavailable} />
  </main>;

  const failure = error ?? itemError;
  const complete = offlineShell && total > 0 && count === total;
  const hasDownloads = Boolean(library?.installed.size);
  const retry = () => void sync(true);
  const syncDisabled = working || !online;
  const syncAction = (label = tryAgain ? "Spróbuj ponownie" : "Synchronizuj teraz") =>
    <button className="button secondary" type="button" disabled={syncDisabled} onClick={retry}>{label}</button>;
  const preparation = import.meta.env.DEV
    ? "Tryb offline wymaga kompilacji aplikacji."
    : worker === "failed"
      ? "Nie udało się uruchomić trybu offline. Otwórz aplikację ponownie."
      : "Przygotowywanie trybu offline. Otwórz aplikację ponownie po zakończeniu.";
  const preparationNotice = !offlineShell && <Notice icon="clock">{preparation}</Notice>;
  const failureNotice = failure && <Notice alert>
    <strong>{messages[failure]}</strong>
    {hasDownloads && offlineShell && (failure === "auth" || failure === "network") && <p>Pobrane lekcje pozostają dostępne offline.</p>}
    {offlineShell && catalog && <p><span>Dostępne offline: {count} z {total}</span> (ostatnia zapisana biblioteka).</p>}
  </Notice>;
  const openSettings = () => openPanel("settings", "child-settings");

  if (panel === "settings") return <>
    <ShellHeader back={{ label: "Ustawienia", accessibleName: "Ustawienia — wróć", action: closePanel }} />
    <main className="child-content settings-content">
      <h1 id="panel-heading" className="visually-hidden" tabIndex={-1}>Ustawienia</h1>
      {failureNotice}
      {generation && preparationNotice}
      <Settings library={library} storage={storage} online={online} offlineShell={offlineShell}
        count={count} total={total} syncAction={generation && <>{syncAction()}
          {working && <p role="status">Synchronizacja · Pobieranie lekcji</p>}</>}
        showProgress={generation ? () => openPanel("sync", "child-settings") : undefined}
        storageError={error === "storage" ? messages.storage : undefined} reset={async () => {
          setViewerError(false);
          setSelectedSubject("");
          const cleared = await reset();
          if (cleared) closePanel();
          return cleared;
        }} />
    </main>
  </>;

  if (generation && panel === "sync") return <>
    <ShellHeader settings={openSettings} />
    <main className="child-content sync-content">
      <h2 id="panel-heading" tabIndex={-1}>{!online && !complete ? "Pobieranie wstrzymane" : working
        ? "Pobieranie lekcji" : failures.length ? "Nie udało się pobrać wszystkich lekcji"
          : complete ? "Lekcje są gotowe" : "Synchronizacja lekcji"}</h2>
      <p className="page-description">{hasDownloads && offlineShell ? "Możesz otwierać pobrane lekcje." : "Tu sprawdzisz postęp pobierania."}</p>
      {failureNotice}
      <section className={complete ? "child-card progress-card complete" : "child-card progress-card"} aria-label="Synchronizacja">
        {catalog && <div role="status">
          <strong className="progress-count">{count} z {total}</strong>
          <p>{offlineShell ? "Dostępne offline" : "Pobrane pliki. Tryb offline jest niedostępny."}</p>
        </div>}
        {total > 0 && <DownloadProgress count={count} total={total} complete={complete} />}
        {complete ? <p>Wszystkie lekcje są dostępne offline</p> : <>
          {working && <p>{lessonsLabel(Math.max(0, total - count - failures.length))} w kolejce lub w trakcie pobierania.</p>}
          {failures.length > 0 && <p>Błąd pobierania: {failures.length}</p>}
          {!online && <p>Połącz się z internetem, aby pobrać pozostałe lekcje.</p>}
          {!catalog && <p>Oczekiwanie na bibliotekę lekcji.</p>}
          {syncAction("Spróbuj ponownie")}
        </>}
      </section>
      <button className="button primary" type="button" onClick={closePanel}>
        {catalog ? "Przejdź do biblioteki" : "Wróć"}
      </button>
    </main>
  </>;

  if (!generation) {
    if (!library && !error) return <>
      <ShellHeader />
      <main className="child-content recovery-content">
        <Recovery icon="clock" title="Odczytywanie biblioteki">
          <p role="status">Sprawdzamy zapisane lekcje.</p>
        </Recovery>
      </main>
    </>;
    if (library?.invalidIdentity || error === "storage" || error === "schema") return <>
      <ShellHeader settings={openSettings} />
      <main className="child-content recovery-content">
        <Recovery icon={library?.invalidIdentity ? "device" : "alert"} title={library?.invalidIdentity
          ? "Zapisane lekcje nie są już dostępne" : error === "schema" ? "Zaktualizuj aplikację" : "Pamięć urządzenia jest niedostępna"}>
          {failureNotice}
          {library?.invalidIdentity && <p>Poproś opiekuna o nowy kod. Odłącz urządzenie w ustawieniach, aby połączyć je ponownie.</p>}
          <button className="button primary" type="button" onClick={openSettings}>Otwórz ustawienia</button>
        </Recovery>
      </main>
    </>;
    const pairingHelpId = error === "pair" || !online ? "pairing-message" : "pairing-help";
    return <main className="child-content pairing-content">
      <Brand heading />
      <h2>{everPaired ? "Zapisane lekcje nie są już dostępne" : "Twoje lekcje zawsze pod ręką."}</h2>
      <p className="page-description">{everPaired ? "Połącz urządzenie ponownie i pobierz lekcje."
        : "Poproś opiekuna o kod, aby połączyć urządzenie z biblioteką."}</p>
      {error !== "pair" && failureNotice}
      <form className="child-card pairing-card" onSubmit={submit}>
        <label htmlFor="code">Kod połączenia</label>
        <input id="code" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXXX-XXXXX"
          autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} required
          aria-invalid={error === "pair" || undefined} aria-describedby={pairingHelpId} />
        {error === "pair" && <p id="pairing-message" className="field-error" role="alert">{messages.pair}</p>}
        {!online && error !== "pair" && <p id="pairing-message" className="field-warning">Do pierwszego połączenia potrzebny jest internet.</p>}
        <label htmlFor="device-label">Nazwa urządzenia (opcjonalnie)</label>
        <input id="device-label" value={label} onChange={event => setLabel(event.target.value)} placeholder="Mój tablet" maxLength={80} />
        <button className="button primary" type="submit" disabled={pairing || !online}>
          {pairing ? "Łączenie…" : "Połącz urządzenie"}
        </button>
        {pairing && <p className="visually-hidden" role="status">Łączenie urządzenia</p>}
        <p id="pairing-help" className="field-help">Pierwsze połączenie wymaga internetu.</p>
      </form>
      <InstallationHelp />
    </main>;
  }

  const syncSummary = <>
    {failureNotice}
    {preparationNotice}
    {offlineShell && !failure && catalog && !subject && total > 0 && <>
      {!online && !hasDownloads
        ? <Notice icon="offline"><strong>Brak pobranych lekcji</strong><p>Połącz się z internetem, aby je pobrać.</p></Notice>
        : <Notice tone={complete ? "success" : online ? "info" : "warning"}
          icon={complete ? "check" : online ? "download" : "offline"} status={!working}>
          <strong>Dostępne offline: {count} z {total}</strong>
          {complete && <span className="visually-hidden">Wszystkie lekcje są dostępne offline</span>}
          {!online && <p>{complete ? "Brak internetu. Możesz się uczyć." : "Brak internetu. Pozostałe lekcje pobiorą się po połączeniu."}</p>}
          {online && working && <p>Pobieranie pozostałych lekcji.</p>}
          {failures.length > 0 && <p>Błąd pobierania: {failures.length}</p>}
          {online && working && <DownloadProgress count={count} total={total} complete={complete} />}
        </Notice>}
    </>}
    {subject && !online && <Notice icon="offline"><strong>Brak internetu</strong>
      <p>Połącz się z internetem, aby pobrać lekcje.</p></Notice>}
    {working && <p role="status" className={catalog ? "visually-hidden" : "notice-label"}>Synchronizacja · Pobieranie lekcji</p>}
    {!catalog && !working && !failure && <Notice icon={online ? "clock" : "offline"}>
      {online ? "Oczekiwanie na bibliotekę lekcji." : "Brak pobranych lekcji. Połącz się z internetem, aby je pobrać."}
    </Notice>}
  </>;

  return <>
    <ShellHeader {...(subject ? { back: { label: "Przedmioty", accessibleName: "Wróć do przedmiotów",
      action: () => setSelectedSubject("") } } : {})} settings={openSettings} />
    <main className="child-content library-content">
      {subject ? <>
        <h1 id="subject-heading" className="page-title subject-title" tabIndex={-1}>{subject.namePl}</h1>
        <p className="subject-meta">{lessonsLabel(lessons.length)} · od najnowszych</p>
      </> : <div className="library-greeting">
        <h2 className="page-title">Czego dziś się uczymy?</h2>
        <p className="page-description">Wybierz przedmiot.</p>
      </div>}
      {viewerError && <Notice tone="danger" alert>
        <strong>Nie udało się bezpiecznie otworzyć lekcji.</strong><p>Sprawdź zapisany plik i spróbuj ponownie.</p>
      </Notice>}
      {syncSummary}
      {subject ? <ul className="lesson-list" aria-label={subject.namePl}>
        {lessons.map(lesson => {
          const versionId = library?.installed.get(lesson.id)?.versionId;
          const item = items.get(lesson.id);
          const status = statusFor(versionId, lesson, item, Boolean(library?.missing.has(lesson.id)));
          const canRetry = status === "failed" || status === "storage_missing";
          return <li key={lesson.id} className="lesson-card">
            <div className="lesson-card-inner child-card">
              <div>
                <h2>{lesson.title}</h2>
                {lesson.description && <p className="lesson-description">{lesson.description}</p>}
                {lesson.grade !== null && <p className="lesson-meta">Klasa {lesson.grade}</p>}
                <StatusBadge status={!offlineShell && versionId ? "shell" : status} />
                {versionId && !offlineShell && <p className="lesson-meta">Tryb offline jest niedostępny.</p>}
                {offlineShell && status === "ready_old_version" && <p className="lesson-meta">Starsza wersja dostępna offline.</p>}
                {versionId && item === "downloading" && <p className="lesson-meta">Pobieranie aktualizacji</p>}
                {versionId && item && item !== "downloading" && <p className="lesson-meta">Błąd pobierania aktualizacji</p>}
                {status === "not_downloaded" && <p className="lesson-meta">{!online ? "Połącz się z internetem, aby pobrać."
                  : library?.serverAccess.denied ? "Poproś opiekuna o pomoc."
                    : failure ? "Pobieranie oczekuje na udaną synchronizację." : "Lekcja pobierze się automatycznie."}</p>}
                {status === "storage_missing" && <p className="lesson-meta">Zapisana lekcja jest niedostępna. Pobierz ponownie.</p>}
                {canRetry && !online && <p className="lesson-meta">Połącz się z internetem.</p>}
              </div>
              {canRetry
                ? <button className="button secondary lesson-action" type="button" disabled={syncDisabled || library?.serverAccess.denied} onClick={retry}
                  aria-label={`Spróbuj ponownie pobrać lekcję: ${lesson.title}`}>Spróbuj ponownie</button>
                : <button id={`open-lesson-${lesson.id}`} className="button primary lesson-action" type="button"
                  disabled={!versionId || !viewerReady} onClick={event => {
                    if (!versionId || !controllingProofWorker()) return;
                    scroll.current = window.scrollY;
                    readerOpener.current = event.currentTarget.id;
                    setViewerError(false);
                    setViewer({ lesson, versionId, generation });
                  }}>{status === "downloading" ? "Pobieranie…" : "Otwórz lekcję"}</button>}
            </div>
          </li>;
        })}
      </ul> : catalog && <section className="subjects" aria-labelledby="subjects-heading">
        <div className="section-heading">
          <h2 id="subjects-heading">Przedmioty</h2>
          {subjects.length > 0 && <span>{subjectsLabel(subjects.length)}</span>}
        </div>
        {total === 0 ? <div className="child-card empty-library">
          <span className="icon-tile"><Icon name="book" /></span>
          <p className="empty-title">Nie ma jeszcze lekcji.</p>
          <p>Poproś opiekuna o dodanie pierwszej.</p>
          {syncAction("Sprawdź aktualizacje")}
        </div> : <ul className="subject-list">
          {subjects.map(entry => <li key={entry.id}>
            <SubjectTile id={entry.id} slug={entry.slug} name={entry.namePl} count={subjectCounts.get(entry.id) ?? 0}
              select={() => setSelectedSubject(entry.id)} />
          </li>)}
        </ul>}
      </section>}
    </main>
  </>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Brak elementu głównego aplikacji.");
const loopbackProof = !__SUPABASE_ORIGIN__ && location.hostname === "127.0.0.1" && location.hash === "#s1-proof";
createRoot(root).render(loopbackProof ? <ChildProof /> : <LessonLibrary />);
