import { useRef, useState, type ReactNode } from "react";
import type { OfflineStatus } from "../../../packages/contracts/src/device.ts";
import appPackage from "../package.json";
import { Icon, type IconName } from "./child-icons.tsx";
import type { useLibrary } from "./use-library.ts";

export const lessonsLabel = (count: number) => `${count} ${plural(count, "lekcja", "lekcje", "lekcji")}`;
export const subjectsLabel = (count: number) => `${count} ${plural(count, "przedmiot", "przedmioty", "przedmiotów")}`;

function plural(count: number, one: string, few: string, many: string) {
  if (count === 1) return one;
  return count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;
}

export function Brand({ heading = false }: { heading?: boolean }) {
  const Label = heading ? "h1" : "span";
  return <div className="child-brand">
    <span className="brand-mark"><Icon name="book" /></span>
    <Label id={heading ? "library-heading" : undefined} tabIndex={heading ? -1 : undefined}>Moja Nauka</Label>
  </div>;
}

export function ShellHeader({ back, settings }: {
  back?: { label: string; accessibleName?: string; action: () => void };
  settings?: () => void;
}) {
  return <header className="child-header">
    <div className="child-header-inner">
      {back
        ? <button className="button header-back" type="button" aria-label={back.accessibleName} onClick={back.action}>
          <Icon name="back" /><span>{back.label}</span>
        </button>
        : <Brand heading />}
      {settings && <button id="child-settings" type="button" className="button secondary settings-button"
        aria-label="Ustawienia i pomoc" onClick={settings}><Icon name="settings" /></button>}
    </div>
  </header>;
}

const subjectIcons: Record<string, IconName> = {
  przyroda: "leaf", matematyka: "math", "jezyk-polski": "book", historia: "history",
};

export function SubjectTile({ id, slug, name, count, select }: {
  id: string; slug: string; name: string; count: number; select: () => void;
}) {
  const subject = Object.hasOwn(subjectIcons, slug) ? slug : "inne";
  return <button id={`subject-${id}`} className="subject-tile" type="button" data-subject={subject} onClick={select}>
    <span className="icon-tile"><Icon name={subjectIcons[subject] ?? "book"} /></span>
    <span className="subject-label"><strong>{name}</strong><span>{lessonsLabel(count)}</span></span>
    <span className="subject-chevron"><Icon name="chevron" /></span>
  </button>;
}

type Tone = "success" | "info" | "warning" | "danger";

export function Notice({ tone = "warning", icon = "alert", alert, status, children }: {
  tone?: Tone; icon?: IconName; alert?: boolean; status?: boolean; children: ReactNode;
}) {
  return <div className={`child-notice ${tone}`} role={alert ? "alert" : status ? "status" : undefined}>
    <Icon name={icon} /><div>{children}</div>
  </div>;
}

const badges: Record<OfflineStatus | "shell", { label: string; tone: Tone; icon: IconName }> = {
  ready_latest: { label: "Dostępna offline", tone: "success", icon: "check" },
  ready_old_version: { label: "Aktualizacja oczekuje", tone: "warning", icon: "clock" },
  downloading: { label: "Pobieranie", tone: "info", icon: "download" },
  not_downloaded: { label: "Wymaga pobrania", tone: "info", icon: "download" },
  failed: { label: "Błąd pobierania", tone: "danger", icon: "alert" },
  storage_missing: { label: "Brak zapisanej lekcji", tone: "warning", icon: "alert" },
  shell: { label: "Lekcja zapisana", tone: "warning", icon: "clock" },
};

export function StatusBadge({ status }: { status: keyof typeof badges }) {
  const { label, tone, icon } = badges[status];
  return <span className={`status-badge ${tone}`}><Icon name={icon} />{label}</span>;
}

export function DownloadProgress({ count, total, complete }: { count: number; total: number; complete: boolean }) {
  return <progress className={complete ? "download-progress complete" : "download-progress"}
    aria-label="Postęp pobierania lekcji" max={total} value={count} />;
}

export function InstallationHelp({ children }: { children?: ReactNode }) {
  return <details className="installation-help">
    <summary className="button">Instrukcja instalacji</summary>
    <p>Możesz korzystać z Mojej Nauki w przeglądarce. Instalacja jest opcjonalna.</p>
    <p>W Chrome na Androidzie otwórz menu i wybierz „Dodaj do ekranu głównego” lub „Zainstaluj aplikację”.</p>
    <p>W Safari użyj „Udostępnij” i „Do ekranu początkowego”. Po zainstalowaniu może być potrzebny nowy kod połączenia.</p>
    {children}
  </details>;
}

type LibraryView = ReturnType<typeof useLibrary>;

export function Settings({ reset, storage, library, online, offlineShell, count, total, syncAction, showProgress, storageError }: {
  reset: () => Promise<boolean>; storage: LibraryView["storage"]; library: LibraryView["library"];
  online: boolean; offlineShell: boolean; count: number; total: number; syncAction: ReactNode;
  showProgress?: (() => void) | undefined; storageError?: string | undefined;
}) {
  const [busy, setBusy] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const dismiss = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  const remove = async () => {
    setBusy(true);
    try {
      if (await reset()) dialog.current?.close();
      else setResetFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const usage = storage.estimate?.usage;
  const hasUsage = typeof usage === "number" && Number.isFinite(usage);
  return <div className="settings-grid">
    <section className="child-card settings-section">
      <div className="section-heading">
        <h2>{showProgress ? <button className="button settings-progress" type="button"
          aria-label="Lekcje dostępne offline — postęp pobierania" onClick={showProgress}>Lekcje dostępne offline</button>
          : "Lekcje dostępne offline"}</h2>
        {offlineShell && library?.catalog && <strong className="settings-count">{count} / {total}</strong>}
      </div>
      {library?.catalog && <p>Ostatnia udana synchronizacja: <strong className="sync-date">
        {new Date(library.catalog.lastSuccessfulSyncAt).toLocaleString("pl-PL")}
      </strong></p>}
      <p>{online ? "Połączenie z internetem dostępne" : "Brak internetu"}</p>
      {syncAction}
    </section>
    <section className="child-card settings-section">
      <h2>To urządzenie</h2>
      {library?.device && <>
        <p>Nazwa urządzenia: {library.device.label ?? "Mój tablet"}</p>
        <p>Identyfikator urządzenia: {library.device.deviceId.slice(0, 8)}</p>
        <p>Biblioteka: {library.device.familyLabel}</p>
      </>}
      <p>Wersja aplikacji: {appPackage.version}</p>
    </section>
    <section className="child-card settings-section">
      <h2>Pomoc i instalacja</h2>
      <p>Przeglądarka może usunąć zapisane dane. W razie potrzeby połącz urządzenie i pobierz lekcje ponownie.</p>
      <InstallationHelp>
        {storage.persisted !== undefined && <p>{storage.persisted ? "Przeglądarka przyznała trwałą pamięć." : "Przeglądarka nie przyznała trwałej pamięci."}</p>}
        {hasUsage && <p>Szacowane użycie pamięci: {(usage / (1024 * 1024)).toLocaleString("pl-PL", { maximumFractionDigits: 1 })} MB.</p>}
      </InstallationHelp>
    </section>
    <section className="child-card settings-section">
      <h2>Dla opiekuna</h2>
      <p>Usuwa połączenie i pobrane lekcje.</p>
      <button ref={trigger} className="button danger-button" type="button" onClick={() => {
        setResetFailed(false);
        dialog.current?.showModal();
        cancel.current?.focus();
      }}>Odłącz urządzenie</button>
      <dialog ref={dialog} className="reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-description"
        onCancel={event => { event.preventDefault(); if (!busy) dismiss(); }}>
        <h2 id="reset-title">Odłączyć urządzenie?</h2>
        <p id="reset-description">Pobrane lekcje i połączenie z biblioteką zostaną usunięte z tej aplikacji.
          Aby wrócić, potrzebujesz internetu i nowego kodu.</p>
        {resetFailed && <Notice tone="danger" alert>{storageError ?? "Nie udało się odłączyć urządzenia. Spróbuj ponownie."}</Notice>}
        <div className="reset-actions">
          <button ref={cancel} className="button secondary" type="button" disabled={busy} onClick={dismiss}>Anuluj</button>
          <button className="button danger-button" type="button" disabled={busy} onClick={() => void remove()}>
            {busy ? "Odłączanie…" : resetFailed ? "Spróbuj ponownie" : "Odłącz i usuń lekcje"}
          </button>
        </div>
      </dialog>
    </section>
  </div>;
}

export function Recovery({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <section className="recovery-card" aria-labelledby="recovery-heading">
    <span className="icon-tile"><Icon name={icon} /></span>
    <h2 id="recovery-heading">{title}</h2>
    {children}
  </section>;
}
