import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { type AdminLesson, type AdminSubject, type Device, type Family } from "../../../packages/contracts/src/admin.ts";
import { observeWorker } from "../../../scripts/register-proof-worker.ts";
import { AdminError, adminApi, signIn, signOut, type Session } from "./admin-api.ts";
import { FamilyDevices } from "./family-devices.tsx";
import { LessonEditor } from "./lesson-editor.tsx";
import { formText, LessonForm, SubjectForm } from "./owner-forms.tsx";
import { Brand, Icon, useConfirmation } from "./admin-ui.tsx";
import { LessonLibrary } from "./lesson-library.tsx";
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
    <Brand heading={loginHeading} />
    <form className="panel stack-form" onSubmit={event => void login(event)}>
      <div className="login-intro"><h2>Zaloguj się</h2><p>Zarządzaj lekcjami i dostępem do biblioteki.</p></div>
      <label>E-mail<input name="email" type="email" autoComplete="username" required /></label>
      <label>Hasło<input name="password" type="password" autoComplete="current-password" required /></label>
      <button type="submit" className="primary" disabled={busy}>Zaloguj</button>
      {busy && <p role="status">Trwa przetwarzanie…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <p className="login-note">Panel jest dostępny wyłącznie dla uprawnionego administratora.</p>
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
  const [dirty, setDirty] = useState(false);
  const confirmation = useConfirmation();
  const actionRunning = useRef(false);
  const loadedRef = useRef(false);
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
    const refreshed = await run(async () => {
      const [newSubjects, newLessons, newFamilies, newDevices] = await Promise.all([
        api.subjects(), api.lessons(), api.families(), api.devices(),
      ]);
      setSubjects(newSubjects);
      setLessons(newLessons);
      setFamilies(newFamilies);
      setDevices(newDevices);
      setLoaded(true);
    }, loadedRef.current ? "Dane zostały odświeżone." : "");
    if (refreshed) loadedRef.current = true;
  }, [api, run]);
  useEffect(() => { void refresh(); }, [refresh]);

  function leave(action: () => void) {
    if (!dirty) { action(); return; }
    confirmation.confirm({ title: "Odrzucić niezapisane zmiany?", detail: "Zmiany w formularzu nie zostały zapisane.",
      label: "Odrzuć zmiany", action: () => { setDirty(false); action(); } });
  }

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
  const tabs = [
    { name: "lessons", icon: "book", label: "Lekcje" },
    { name: "subjects", icon: "grid", label: "Przedmioty" },
    { name: "families", icon: "users", label: "Rodziny i urządzenia", short: "Rodziny" },
  ] as const;

  return <main className="admin admin-workspace">
    <header className="admin-navigation">
      <aside className="admin-sidebar">
        <Brand heading={dashboardHeading} />
        <nav aria-label="Panel administratora" className="admin-tabs">
          {tabs.map(tab => <button key={tab.name} type="button" aria-label={tab.label}
            aria-current={view === tab.name ? "page" : undefined} disabled={!loaded || busy}
            onClick={() => leave(() => navigate(tab.name))}>
            <Icon name={tab.icon} /><span className={"short" in tab ? "only-wide" : undefined}>{tab.label}</span>
            {"short" in tab && <span className="only-narrow">{tab.short}</span>}
          </button>)}
        </nav>
        <button className="admin-logout" type="button" onClick={onLogout}><Icon name="logout" />Wyloguj</button>
      </aside>
      <div className="admin-topbar">
        <span>Panel administratora</span>
        <button type="button" className="admin-refresh" aria-label="Odśwież dane" onClick={() => void refresh()} disabled={busy}>
          <Icon name="refresh" /><span>Odśwież dane</span>
        </button>
      </div>
    </header>

    <div className="admin-content">
      {busy && <p className="notice" role="status">{loaded ? "Trwa przetwarzanie…" : "Pobieranie danych…"}</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {status && <p className="notice success" role="status">{status}</p>}

      {loaded && view === "lessons" && <>
        <div hidden={selection !== undefined}>
          <LessonLibrary lessons={lessons} subjects={subjects} families={families} busy={busy} visible={!selection}
            create={() => setSelection("new")} edit={id => setSelection(`id:${id}`)} />
        </div>
        {lesson && <LessonEditor key={lesson.id} api={api} lesson={lesson}
          subjects={subjects} families={families} busy={busy} previewReady={previewReady} run={run} reportError={reportError}
          onLesson={onLesson} onDirty={setDirty} onBack={() => leave(() => setSelection(undefined))} />}
        {selection === "new" && <section className="create-lesson">
          <div className="page-heading"><div><h2 id="admin-view-heading" tabIndex={-1}>Nowa lekcja</h2>
            <p>Zapisz szkic, aby dodać plik HTML.</p></div>
            <button type="button" disabled={busy} onClick={() => leave(() => setSelection(undefined))}>Anuluj</button>
          </div>
          <div className="panel">
            <LessonForm subjects={subjects} families={families} busy={busy} onDirty={() => setDirty(true)}
              save={input => void run(async () => {
                const created = await api.createLesson(input);
                onLesson(created);
                setDirty(false);
                setSelection(`id:${created.id}`);
              }, "Zapisano szkic.")} />
          </div>
        </section>}
      </>}

      {loaded && view === "subjects" && <section>
        <div className="page-heading">
          <div><h2 id={selection ? undefined : "admin-view-heading"} tabIndex={-1}>Przedmioty</h2>
            <p>Organizuj lekcje według przedmiotów.</p></div>
          {!selection && <button className="primary" type="button" disabled={busy} onClick={() => setSelection("new")}>
            <Icon name="plus" />Nowy przedmiot</button>}
        </div>
        {selection && <div className="panel subject-form-panel">
          <h3 id="admin-view-heading" tabIndex={-1}>{subject ? `Edytuj: ${subject.namePl}` : "Nowy przedmiot"}</h3>
          <SubjectForm key={subject?.id ?? "new"} busy={busy} {...(subject ? { subject } : {})}
            save={input => void run(async () => {
              const { namePl, sortOrder } = input;
              onSubject(await (subject ? api.saveSubject(subject.id, { namePl, sortOrder }) : api.createSubject(input)));
              setSelection(undefined);
            }, "Zapisano przedmiot.")} />
          <button type="button" disabled={busy} onClick={() => setSelection(undefined)}>Anuluj</button>
        </div>}
        {subjects.length ? <ul className="entity-list panel">
          {subjects.map(item => <li key={item.id}>
            <div><h3>{item.namePl}</h3><p>{item.slug} · Kolejność: {item.sortOrder}</p>
              <span className={`badge ${item.archivedAt ? "draft" : "published"}`}>{item.archivedAt ? "W archiwum" : "Aktywny"}</span></div>
            <div className="toolbar">
              <button type="button" disabled={busy} onClick={() => setSelection(`id:${item.id}`)}>Edytuj przedmiot</button>
              <button type="button" disabled={busy} onClick={() => {
                const archive = () => void run(async () =>
                  onSubject(await api.saveSubject(item.id, { archived: !item.archivedAt })), "Zapisano przedmiot.");
                if (item.archivedAt) archive();
                else confirmation.confirm({ title: `Archiwizować przedmiot „${item.namePl}”?`,
                  detail: "Archiwalny przedmiot nie pojawi się przy tworzeniu nowych lekcji.",
                  label: "Archiwizuj przedmiot", action: archive });
              }}>{item.archivedAt ? "Przywróć przedmiot" : "Archiwizuj przedmiot"}</button>
            </div>
          </li>)}
        </ul> : <p className="panel">Nie ma jeszcze przedmiotów.</p>}
      </section>}

      {loaded && view === "families" && <FamilyDevices api={api} families={families} devices={devices} busy={busy} run={run}
        onFamily={family => setFamilies(current => upsert(current, family))}
        onDevice={device => setDevices(current => upsert(current, device))} />}
    </div>
    {confirmation.dialog}
  </main>;
}
