import { useEffect, useState, type FormEvent } from "react";
import { type AdminLesson, type AdminSubject, type AdminVersion, type Family } from "../../../packages/contracts/src/admin.ts";
import { AdminError, type AdminApi, type Upload } from "./admin-api.ts";
import { type RunAdminAction } from "./family-devices.tsx";
import { useLessonPreview } from "./lesson-preview.tsx";
import { dateLabel, LessonForm, lessonStatus } from "./owner-forms.tsx";

const statusText = {
  hashing: "Obliczanie sumy SHA-256…",
  putting: "Przesyłanie pliku do prywatnego magazynu…",
  validating: "Sprawdzanie pliku na serwerze…",
};
const checkedLabels: Record<string, string> = {
  utf8: "kodowanie UTF-8", html5: "struktura HTML5", resources: "zasoby osadzone w pliku",
  "inline-scripts": "skrypty osadzone w pliku", navigation: "nawigacja",
};

export function LessonEditor({ api, lesson, subjects, families, previewReady, busy, run, reportError, onLesson, onBack }: {
  api: AdminApi; lesson: AdminLesson; subjects: AdminSubject[]; families: Family[];
  previewReady: boolean; busy: boolean; run: RunAdminAction; reportError: (error: unknown) => void;
  onLesson: (lesson: AdminLesson) => void; onBack: () => void;
}) {
  const [versions, setVersions] = useState<AdminVersion[]>();
  const [file, setFile] = useState<File>();
  const [fileInputKey, setFileInputKey] = useState(0);
  const [stage, setStage] = useState<keyof typeof statusText>();
  const [pending, setPending] = useState<Upload>();
  const [previewNotice, setPreviewNotice] = useState("");
  const preview = useLessonPreview(previewReady);

  useEffect(() => {
    let active = true;
    void api.versions(lesson.id).then(result => { if (active) setVersions(result); }, error => {
      if (active) { setVersions([]); reportError(error); }
    });
    return () => { active = false; };
  }, [api, lesson.id, reportError]);

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
    if (version.id !== versions?.[0]?.id && !window.confirm(`Opublikować ponownie wersję ${version.versionNumber}?`)) return;
    void run(async () => onLesson(await api.publish(lesson, version.id)), "Opublikowano wersję lekcji.");
  }

  function unpublish() {
    if (!window.confirm("Ukryć lekcję w katalogu dzieci?")) return;
    void run(async () => onLesson(await api.unpublish(lesson)), "Ukryto lekcję.");
  }

  return <section aria-label="Edycja lekcji">
    <div className="toolbar">
      <button type="button" onClick={onBack} disabled={busy}>Wróć do listy lekcji</button>
      {lesson.status === "published" && <button type="button" onClick={unpublish} disabled={busy}>Ukryj lekcję</button>}
    </div>
    <h2 id="admin-view-heading" tabIndex={-1}>{lesson.title}</h2>
    <p>{lessonStatus[lesson.status]}{lesson.status === "published" ? ` · ${dateLabel(lesson.publishedAt)}` : ""}</p>
    <div className="panel">
      <h3>Dane lekcji</h3>
      <LessonForm key={lesson.updatedAt} lesson={lesson} subjects={subjects} families={families} busy={busy}
        save={input => { void run(async () => onLesson(await api.saveLesson(lesson, input)), "Zapisano zmiany."); }} />
    </div>
    <form className="panel stack-form" onSubmit={event => void upload(event)}>
      <h3>Nowa wersja</h3>
      <label>Plik HTML<input key={fileInputKey} type="file" accept=".html,text/html" disabled={busy} onChange={event => {
        setFile(event.currentTarget.files?.[0]);
        setPending(undefined);
        setPreviewNotice("");
      }} /></label>
      {file && <p>{file.name} · {file.size.toLocaleString("pl-PL")} B</p>}
      <button type="submit" className="primary" disabled={busy || !file || !versions}>
        {pending ? "Ponów walidację" : "Prześlij i sprawdź"}
      </button>
      {stage && <p role="status">{statusText[stage]}</p>}
      {previewNotice && <p role="status">{previewNotice}</p>}
    </form>
    {preview.panel}
    <section aria-label="Wersje lekcji">
      <h3>Wersje lekcji</h3>
      {!versions && <p role="status">Pobieranie listy wersji…</p>}
      {versions?.length === 0 && <p>Nie ma jeszcze zweryfikowanych wersji.</p>}
      {versions?.map(version => <article key={version.id} className="panel" aria-label={`Wersja ${version.versionNumber}`}>
        <h4>Wersja {version.versionNumber}</h4>
        {lesson.status === "published" && lesson.activeVersionId === version.id && <p className="badge">Aktywna wersja</p>}
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
            onClick={() => publish(version)}>Opublikuj tę wersję</button>
        </div>
      </article>)}
      {versions?.length && !previewReady ? <p role="status">Podgląd będzie dostępny po przygotowaniu bezpiecznej ramki.</p> : null}
    </section>
  </section>;
}
