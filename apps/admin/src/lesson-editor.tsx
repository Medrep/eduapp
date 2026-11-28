import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { type AdminLesson, type AdminSubject, type AdminVersion, type Family } from "../../../packages/contracts/src/admin.ts";
import { AdminError, type AdminApi, type Upload } from "./admin-api.ts";
import { type RunAdminAction } from "./family-devices.tsx";
import { useLessonPreview } from "./lesson-preview.tsx";
import { dateLabel, LessonForm, lessonStatus } from "./owner-forms.tsx";
import { Icon, useConfirmation } from "./admin-ui.tsx";

const statusText = {
  hashing: "Obliczanie sumy SHA-256…",
  putting: "Przesyłanie pliku do prywatnego magazynu…",
  validating: "Sprawdzanie pliku na serwerze…",
};
const checkedLabels: Record<string, string> = {
  utf8: "kodowanie UTF-8", html5: "struktura HTML5", resources: "zasoby osadzone w pliku",
  "inline-scripts": "skrypty osadzone w pliku", navigation: "nawigacja",
};

export function LessonEditor({ api, lesson, subjects, families, previewReady, busy, run, reportError, onLesson, onBack, onDirty }: {
  api: AdminApi; lesson: AdminLesson; subjects: AdminSubject[]; families: Family[];
  previewReady: boolean; busy: boolean; run: RunAdminAction; reportError: (error: unknown) => void;
  onLesson: (lesson: AdminLesson) => void; onBack: () => void; onDirty: (dirty: boolean) => void;
}) {
  const confirmation = useConfirmation();
  const [history, setHistory] = useState(false);
  const [versionLoadFailed, setVersionLoadFailed] = useState(false);
  const [versionAttempt, retryVersionLoad] = useState(0);
  const [versions, setVersions] = useState<AdminVersion[]>();
  const [file, setFile] = useState<File>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [stage, setStage] = useState<keyof typeof statusText>();
  const [pending, setPending] = useState<Upload>();
  const [previewNotice, setPreviewNotice] = useState("");
  const preview = useLessonPreview(previewReady, lesson.title);

  useEffect(() => {
    let active = true;
    void api.versions(lesson.id).then(result => { if (active) setVersions(result); }, error => {
      if (active) { setVersionLoadFailed(true); reportError(error); }
    });
    return () => { active = false; };
  }, [api, lesson.id, reportError, versionAttempt]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setPreviewNotice("");
    await run(async () => {
      try {
        const next = pending ?? await api.stageUpload(lesson.id, file, setStage);
        setPending(next);
        setStage("validating");
        const version = await api.finalizeUpload(lesson.id, next);
        setVersions(current => [version, ...(current ?? []).filter(item => item.id !== version.id)]);
        setPending(undefined);
        setFile(undefined);
        setFileInputKey(current => current + 1);
        try {
          await preview.prepare(version, next.file);
        } catch {
          setPreviewNotice("Wersja została zapisana. Podgląd możesz pobrać z listy wersji.");
        }
      } catch (error) {
        if (error instanceof AdminError && error.status < 500 && error.status !== 429) setPending(undefined);
        throw error;
      } finally {
        setStage(undefined);
      }
    }, "Plik przeszedł walidację. Zapisano wersję.");
  }

  function publish(version: AdminVersion) {
    const action = () => void run(async () => onLesson(await api.publish(lesson, version.id)), "Opublikowano wersję lekcji.");
    if (version.id === versions?.[0]?.id) action();
    else confirmation.confirm({ title: `Opublikować ponownie wersję ${version.versionNumber}?`,
      detail: "Wybrana wersja zastąpi obecną po synchronizacji urządzeń.", label: "Opublikuj wersję", action });
  }

  function unpublish() {
    confirmation.confirm({ title: "Ukryć lekcję w katalogu dzieci?",
      detail: "Ukrycie zmieni katalog po synchronizacji. Pobrane kopie mogą być nadal dostępne na urządzeniach offline.",
      label: "Ukryj lekcję", danger: true,
      action: () => void run(async () => onLesson(await api.unpublish(lesson)), "Ukryto lekcję.") });
  }

  const viewHeading = useRef<HTMLHeadingElement>(null);
  const previousHistory = useRef(history);
  useLayoutEffect(() => {
    if (previousHistory.current !== history) viewHeading.current?.focus();
    previousHistory.current = history;
  }, [history]);

  const active = lesson.status === "published" ? versions?.find(version => version.id === lesson.activeVersionId) : undefined;

  return <section aria-label="Edycja lekcji">
    <div className="page-heading"><div><h2 id="admin-view-heading" ref={viewHeading} tabIndex={-1}>{lesson.title}</h2>
      <p>{history ? "Edycja lekcji · historia wersji" : ["Edycja lekcji",
        subjects.find(subject => subject.id === lesson.subjectId)?.namePl, lesson.grade === null ? undefined : `Klasa ${lesson.grade}`]
        .filter(Boolean).join(" · ")}</p></div></div>
    {history ? <>
      <button type="button" className="quiet" onClick={() => setHistory(false)} disabled={busy}><Icon name="back" />Wróć do danych lekcji</button>
      {active && <p className="notice success">Aktywna wersja: {active.versionNumber}</p>}
    </> : <div className="toolbar editor-actions">
      <button type="button" onClick={onBack} disabled={busy}>Wróć do listy lekcji</button>
      <span className={`badge ${lesson.status}`}>{lessonStatus[lesson.status]}</span>
      {lesson.status === "published" && <button type="button" onClick={unpublish} disabled={busy}>Ukryj lekcję</button>}
    </div>}
    <div className={history ? "editor-history" : "editor-grid"}>
    <div className="panel" hidden={history}>
      <h3>Dane lekcji</h3>
      <LessonForm key={lesson.updatedAt} lesson={lesson} subjects={subjects} families={families} busy={busy}
        onDirty={() => onDirty(true)} save={input => { void run(async () => {
          onLesson(await api.saveLesson(lesson, input));
          onDirty(false);
        }, "Zapisano zmiany."); }} />
    </div>
    <div>
    <form className="panel stack-form upload-panel" hidden={history} onSubmit={event => void upload(event)}>
      <div><h3>Nowa wersja</h3><p>Jeden samodzielny plik HTML, maks. 20 MiB.</p></div>
      <label>Plik HTML<input key={fileInputKey} type="file" accept=".html,text/html" disabled={busy} onChange={event => {
        setFile(event.currentTarget.files?.[0]);
        setPending(undefined);
        setPreviewNotice("");
      }} /></label>
      {file && <div className="file-summary"><Icon name="file" /><div><strong>{file.name}</strong>
        <p>{file.size.toLocaleString("pl-PL")} B</p></div></div>}
      <button type="submit" className="primary" disabled={busy || !file || !versions}>
        {pending ? "Ponów walidację" : "Prześlij i sprawdź"}
      </button>
      {stage && <div className="notice" role="status"><p>{statusText[stage]}</p>
        <progress aria-label={statusText[stage]} /></div>}
      {previewNotice && <p role="status">{previewNotice}</p>}
    </form>
    {preview.panel}
    <section className={history ? "panel versions-section" : "versions-section"} aria-label="Wersje lekcji">
      <h3>{history ? "Historia wersji" : "Wersje lekcji"}</h3>
      {versionLoadFailed ? <div className="panel">
        <p>Nie udało się pobrać listy wersji.</p>
        <button type="button" disabled={busy} onClick={() => {
          setVersionLoadFailed(false);
          retryVersionLoad(attempt => attempt + 1);
        }}>Wczytaj wersje ponownie</button>
      </div> : !versions && <p role="status">Pobieranie listy wersji…</p>}
      {versions?.length === 0 && <p>Nie ma jeszcze zweryfikowanych wersji.</p>}
      {(history ? versions : versions?.slice(0, 1))?.map(version => <article key={version.id} className="panel version-card" aria-label={`Wersja ${version.versionNumber}`}>
        <h4>Wersja {version.versionNumber}</h4>
        {lesson.status === "published" && lesson.activeVersionId === version.id && <p className="badge published">Aktywna wersja</p>}
        <p>Walidacja zakończona pomyślnie · {version.sizeBytes.toLocaleString("pl-PL")} B · {dateLabel(version.createdAt)}</p>
        <details><summary>Wynik walidacji i suma kontrolna</summary>
          <p>Identyfikator wersji <code>{version.id}</code></p>
          <p>Sprawdzono: {version.validationReport.checked.map(check => checkedLabels[check] ?? check).join(", ")}.</p>
          <p>SHA-256 <code>{version.sha256}</code></p>
        </details>
        <div className="toolbar">
          <button type="button" disabled={busy || !previewReady} onClick={event => {
            const trigger = event.currentTarget;
            void run(async () => {
              await preview.show(version, () => api.downloadVersion(lesson.id, version), trigger);
            });
          }}>Podgląd</button>
          <button className="primary" type="button" disabled={busy || (lesson.status === "published" && lesson.activeVersionId === version.id)}
            onClick={() => publish(version)}>{active?.id === version.id ? "Aktywna wersja" : "Opublikuj tę wersję"}</button>
        </div>
      </article>)}
      {versions?.length && !previewReady ? <p role="status">Podgląd będzie dostępny po przygotowaniu bezpiecznej ramki.</p> : null}
      {!history && Boolean(versions?.length) && <button className="history-link" type="button" disabled={busy}
        onClick={() => setHistory(true)}>Historia wersji</button>}
    </section>
    </div>
    </div>
    {confirmation.dialog}
  </section>;
}
