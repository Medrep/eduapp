import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { type AdminLesson, type AdminSubject, type Device, type Family } from "../../../packages/contracts/src/admin.ts";
import { observeWorker } from "../../../scripts/register-proof-worker.ts";
import { AdminError, adminApi, signIn, signOut, type Session } from "./admin-api.ts";
import { FamilyDevices } from "./family-devices.tsx";
import { LessonEditor } from "./lesson-editor.tsx";
import { dateLabel, formText, LessonForm, lessonStatus, SubjectForm } from "./owner-forms.tsx";
import { maintainPreviewExpiry } from "./preview-store.ts";

type View = "lessons" | "subjects" | "families";
type Selection = "new" | `id:${string}`;

function upsert<T extends { id: string }>(rows: T[], row: T) {
  return rows.some(entry => entry.id === row.id) ? rows.map(entry => entry.id === row.id ? row : entry) : [row, ...rows];
}

function message(error: unknown) {
  return error instanceof AdminError ? error.message : "Nie udało się wykonać operacji. Spróbuj ponownie.";
}

export function OwnerAdmin() {
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [worker, setWorker] = useState<"waiting" | "ready" | "failed">("waiting");
  const returnToLogin = useRef(false);
  const loginHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => observeWorker(setWorker), []);
  useEffect(maintainPreviewExpiry, []);
  useLayoutEffect(() => {
    if (!session && returnToLogin.current) {
      returnToLogin.current = false;
      loginHeading.current?.focus();
    }
  }, [session]);

  const endSession = useCallback((current: Session, detail: string) => {
    current.controller.abort();
    returnToLogin.current = true;
    setError(detail);
    setSession(undefined);
  }, []);

  useEffect(() => {
    if (!session) return;
    const check = () => {
      if (Date.now() >= session.expiresAt) endSession(session, "Sesja wygasła. Zaloguj się ponownie.");
    };
    const timer = window.setTimeout(check, Math.min(2_147_483_647, Math.max(0, session.expiresAt - Date.now())));
    window.addEventListener("pageshow", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [endSession, session]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = data.get("password");
    if (typeof password !== "string" || !password) return;
    setBusy(true);
    setError("");
    try {
      const current = await signIn(formText(data, "email"), password);
      try {
        // Successful Auth login alone does not grant access to the owner UI.
        await adminApi(current).subjects();
      } catch (cause) {
        void signOut(current).catch(() => undefined);
        throw cause;
      }
      setSession(current);
    } catch (cause) {
      setError(message(cause));
    } finally {
      const passwordInput = form.elements.namedItem("password");
      if (passwordInput instanceof HTMLInputElement) passwordInput.value = "";
      setBusy(false);
    }
  }

  async function logout(current: Session) {
    setBusy(true);
    endSession(current, "");
    try {
      await signOut(current);
    } catch {
      setError("Sesja w tym panelu została zamknięta. Serwer nie potwierdził wylogowania.");
    } finally {
      setBusy(false);
    }
  }

  if (session) return <Dashboard session={session} previewReady={worker === "ready"}
    onLogout={() => void logout(session)} onDenied={detail => endSession(session, detail)} />;

  return <main className="admin admin-login">
    <h1 ref={loginHeading} tabIndex={-1}>Panel administratora</h1>
    <form className="panel stack-form" onSubmit={event => void login(event)}>
      <h2>Zaloguj się</h2>
      <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
      <label>Hasło<input name="password" type="password" autoComplete="current-password" required /></label>
      <button type="submit" className="primary" disabled={busy}>Zaloguj</button>
      {busy && <p role="status">Trwa przetwarzanie…</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  </main>;
}

function Dashboard({ session, previewReady, onLogout, onDenied }: {
  session: Session; previewReady: boolean; onLogout: () => void; onDenied: (detail: string) => void;
}) {
  const api = useMemo(() => adminApi(session), [session]);
  const [view, setView] = useState<View>("lessons");
  const [selection, setSelection] = useState<Selection>();
  const [subjects, setSubjects] = useState<AdminSubject[]>([]);
  const [lessons, setLessons] = useState<AdminLesson[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const actionRunning = useRef(false);
  const dashboardHeading = useRef<HTMLHeadingElement>(null);
  const previousRoute = useRef({ view, selection });
  const denied = useRef(onDenied);
  denied.current = onDenied;

  useLayoutEffect(() => { dashboardHeading.current?.focus(); }, []);
  useLayoutEffect(() => {
    const previous = previousRoute.current;
    previousRoute.current = { view, selection };
    if (loaded && (view !== previous.view || selection !== previous.selection)) {
      document.getElementById("admin-view-heading")?.focus();
    }
  }, [view, selection, loaded]);

  const reportError = useCallback((cause: unknown) => {
    if (session.controller.signal.aborted) return;
    if (cause instanceof AdminError && (cause.status === 401 || cause.status === 403)) {
      denied.current(cause.message);
      return;
    }
    setError(message(cause));
  }, [session]);

  const run = useCallback(async (action: () => Promise<void>, success = "") => {
    if (actionRunning.current || session.controller.signal.aborted) return false;
    actionRunning.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
      if (!session.controller.signal.aborted) setStatus(success);
      return true;
    } catch (cause) {
      reportError(cause);
      return false;
    } finally {
      actionRunning.current = false;
      if (!session.controller.signal.aborted) setBusy(false);
    }
  }, [reportError, session]);

  const refresh = useCallback(async () => {
    await run(async () => {
      const [newSubjects, newLessons, newFamilies, newDevices] = await Promise.all([
        api.subjects(), api.lessons(), api.families(), api.devices(),
      ]);
      setSubjects(newSubjects);
      setLessons(newLessons);
      setFamilies(newFamilies);
      setDevices(newDevices);
      setLoaded(true);
    });
  }, [api, run]);
  useEffect(() => { void refresh(); }, [refresh]);

  function navigate(next: View) {
    setView(next);
    setSelection(undefined);
    setError("");
    setStatus("");
    if (next === "families") void run(async () => setDevices(await api.devices()));
  }

  const onLesson = (lesson: AdminLesson) => setLessons(current => upsert(current, lesson));
  const onSubject = (subject: AdminSubject) => setSubjects(current => upsert(current, subject));
  const subject = subjects.find(item => selection === `id:${item.id}`);
  const lesson = lessons.find(item => selection === `id:${item.id}`);
  const filter = query.trim().toLocaleLowerCase("pl");
  const lessonRows = filter ? lessons.filter(item => item.title.toLocaleLowerCase("pl").includes(filter)) : lessons;

  return <main className="admin">
    <header className="admin-header">
      <h1 ref={dashboardHeading} tabIndex={-1}>Panel administratora</h1>
      <nav aria-label="Panel administratora" className="toolbar">
        <button type="button" aria-current={view === "lessons" ? "page" : undefined} disabled={!loaded || busy}
          onClick={() => navigate("lessons")}>Lekcje</button>
        <button type="button" aria-current={view === "subjects" ? "page" : undefined} disabled={!loaded || busy}
          onClick={() => navigate("subjects")}>Przedmioty</button>
        <button type="button" aria-current={view === "families" ? "page" : undefined} disabled={!loaded || busy}
          onClick={() => navigate("families")}>Rodziny i urządzenia</button>
        <button type="button" onClick={onLogout}>Wyloguj</button>
      </nav>
    </header>
    <div className="toolbar">
      <button type="button" onClick={() => void refresh()} disabled={busy}>Odśwież dane</button>
      {busy && <span role="status">Trwa przetwarzanie…</span>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {status && <p className="notice" role="status">{status}</p>}

    {loaded && view === "lessons" && (lesson ? <LessonEditor key={lesson.id} api={api} lesson={lesson}
      subjects={subjects} families={families} busy={busy} previewReady={previewReady} run={run} reportError={reportError}
      onLesson={onLesson} onBack={() => setSelection(undefined)} /> : <section>
      <h2 id={selection === "new" ? undefined : "admin-view-heading"} tabIndex={-1}>Lekcje</h2>
      {selection === "new" ? <div className="panel">
        <h3 id="admin-view-heading" tabIndex={-1}>Nowa lekcja</h3>
        <LessonForm subjects={subjects} families={families} busy={busy} save={input => void run(async () => {
          const created = await api.createLesson(input);
          onLesson(created);
          setSelection(`id:${created.id}`);
        }, "Zapisano szkic.")} />
        <button type="button" disabled={busy} onClick={() => setSelection(undefined)}>Anuluj</button>
      </div> : <div className="toolbar">
        <button type="button" className="primary" disabled={busy} onClick={() => setSelection("new")}>Nowa lekcja</button>
        <label>Szukaj lekcji<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      </div>}
      <div className="card-list">
        {lessonRows.map(item => <article className="panel" key={item.id} aria-label={item.title}>
          <h3>{item.title}</h3>
          <p>{subjects.find(entry => entry.id === item.subjectId)?.namePl ?? "Przedmiot niedostępny"}
            {item.grade === null ? "" : ` · Klasa ${item.grade}`}</p>
          <p>{lessonStatus[item.status]}{item.status === "published" ? ` · ${dateLabel(item.publishedAt)}` : ""}</p>
          {item.status === "published" && item.activeVersionId && <p>Identyfikator aktywnej wersji <code>{item.activeVersionId}</code></p>}
          <p>{item.visibility === "all" ? "Wszystkie rodziny" : families.filter(family => item.familyIds.includes(family.id))
            .map(family => family.label).join(", ") || "Brak przypisanych rodzin"}</p>
          <button type="button" disabled={busy} onClick={() => setSelection(`id:${item.id}`)}>Edytuj lekcję</button>
        </article>)}
      </div>
      {!lessonRows.length && <p>{filter ? "Nie ma lekcji pasujących do wyszukiwania." : "Nie ma jeszcze lekcji."}</p>}
    </section>)}

    {loaded && view === "subjects" && <section>
      <h2 id={subject ? undefined : "admin-view-heading"} tabIndex={-1}>Przedmioty</h2>
      <div className="panel">
        <h3 id={subject ? "admin-view-heading" : undefined} tabIndex={-1}>
          {subject ? `Edytuj: ${subject.namePl}` : "Nowy przedmiot"}
        </h3>
        <SubjectForm key={subject ? `${subject.id}:${subject.namePl}:${subject.slug}:${subject.sortOrder}` : "new"} busy={busy}
          {...(subject ? { subject } : {})} save={input => void run(async () => {
            const { namePl, sortOrder } = input;
            onSubject(await (subject ? api.saveSubject(subject.id, { namePl, sortOrder }) : api.createSubject(input)));
            setSelection(undefined);
          }, "Zapisano przedmiot.")} />
        {subject && <button type="button" disabled={busy} onClick={() => setSelection(undefined)}>Anuluj</button>}
      </div>
      <div className="card-list">
        {subjects.map(item => <article className="panel" aria-label={item.namePl} key={item.id}>
          <h3>{item.namePl}</h3>
          <p>{item.slug} · Kolejność: {item.sortOrder}{item.archivedAt ? " · W archiwum" : ""}</p>
          <div className="toolbar">
            <button type="button" disabled={busy} onClick={() => setSelection(`id:${item.id}`)}>Edytuj przedmiot</button>
            <button type="button" disabled={busy} onClick={() => void run(async () =>
              onSubject(await api.saveSubject(item.id, { archived: !item.archivedAt })), "Zapisano przedmiot.")}>
              {item.archivedAt ? "Przywróć przedmiot" : "Archiwizuj przedmiot"}
            </button>
          </div>
        </article>)}
      </div>
    </section>}

    {loaded && view === "families" && <FamilyDevices api={api} families={families} devices={devices} busy={busy} run={run}
      onFamily={family => setFamilies(current => upsert(current, family))}
      onDevice={device => setDevices(current => upsert(current, device))} />}
  </main>;
}
