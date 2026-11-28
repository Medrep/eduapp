import { useEffect, useState, type FormEvent } from "react";
import { type Device, type Family, type PairingCode } from "../../../packages/contracts/src/admin.ts";
import { type AdminApi } from "./admin-api.ts";
import { dateLabel, formText } from "./owner-forms.tsx";
import { Icon, useConfirmation } from "./admin-ui.tsx";

export type RunAdminAction = (action: () => Promise<void>, success?: string) => Promise<boolean>;

export function FamilyDevices({ api, families, devices, busy, run, onFamily, onDevice }: {
  api: AdminApi; families: Family[]; devices: Device[]; busy: boolean; run: RunAdminAction;
  onFamily: (family: Family) => void; onDevice: (device: Device) => void;
}) {
  const confirmation = useConfirmation();
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = families.find(family => family.id === selectedId) ?? families.find(family => family.enabled) ?? families[0];
  const [expiredFamily, setExpiredFamily] = useState<string>();
  const [code, setCode] = useState<(PairingCode & { familyId: string })>();
  useEffect(() => {
    if (!code) return;
    const expiry = Date.parse(code.expiresAt);
    const recheck = () => {
      if (Date.now() < expiry) return;
      setExpiredFamily(code.familyId);
      setCode(current => current === code ? undefined : current);
    };
    const timer = window.setTimeout(recheck, Math.max(0, expiry - Date.now()));
    window.addEventListener("pageshow", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [code]);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const label = formText(new FormData(form), "label");
    void run(async () => {
      const family = await api.createFamily(label);
      onFamily(family);
      setCode(undefined);
      setSelectedId(family.id);
      setCreating(false);
      form.reset();
    }, "Dodano rodzinę.");
  }

  function issue(family: Family) {
    setExpiredFamily(undefined);
    setCode(undefined);
    void run(async () => {
      const reply = await api.issueCode(family.id);
      if (Date.parse(reply.expiresAt) > Date.now()) setCode({ ...reply, familyId: family.id });
    });
  }

  function revoke(device: Device) {
    confirmation.confirm({ title: `Unieważnić dostęp urządzenia „${device.label}”?`,
      detail: "Lekcji pobranych na urządzenie, które pozostaje offline, nie można zdalnie usunąć. " +
        "Wcześniej wydany podpisany adres pobierania może działać do wygaśnięcia.",
      label: "Unieważnij dostęp", danger: true,
      action: () => void run(async () => onDevice(await api.revoke(device.id)), "Cofnięto dostęp urządzenia.") });
  }

  function select(id: string) {
    setCode(undefined);
    setSelectedId(id);
  }

  const familyDevices = devices.filter(device => device.familyId === selected?.id);

  return <section aria-label="Rodziny i urządzenia">
    <div className="page-heading">
      <div><h2 id="admin-view-heading" tabIndex={-1}>Rodziny i urządzenia</h2>
        <p>Zarządzaj dostępem do lekcji i połączeniami urządzeń.</p></div>
      {!creating && <button type="button" className="primary" disabled={busy} onClick={() => setCreating(true)}>
        <Icon name="plus" />Dodaj rodzinę</button>}
    </div>
    {creating && <form className="panel stack-form subject-form-panel" onSubmit={add}>
      <label>Nazwa rodziny<input name="label" required maxLength={80} /></label>
      <div className="toolbar"><button type="button" disabled={busy} onClick={() => setCreating(false)}>Anuluj</button>
        <button type="submit" className="primary" disabled={busy}>Dodaj rodzinę</button></div>
    </form>}
    {selected ? <div className="family-grid">
      <div className="panel family-picker">
        <div className="only-wide">
          <h3>Rodziny</h3>
          {families.map(family => <button key={family.id} type="button" aria-pressed={family.id === selected.id}
            disabled={busy} onClick={() => select(family.id)}><strong>{family.label}</strong>
            <span>{family.enabled ? `Liczba urządzeń: ${devices.filter(device => device.familyId === family.id).length}`
              : "Nieaktywna"}</span></button>)}
        </div>
        <label className="only-narrow">Rodzina<select value={selected.id} disabled={busy} onChange={event => select(event.target.value)}>
          {families.map(family => <option key={family.id} value={family.id}>{family.label}{family.enabled ? "" : " · Nieaktywna"}</option>)}
        </select></label>
      </div>
      <article className="panel family-detail" aria-label={selected.label}>
        <div className="page-heading">
          <div><h3>{selected.label}</h3><p><span className={`badge ${selected.enabled ? "published" : "draft"}`}>
            {selected.enabled ? "Aktywna" : "Nieaktywna"}</span></p></div>
          {selected.enabled && <button className="primary" type="button" disabled={busy} onClick={() => issue(selected)}>Wygeneruj kod</button>}
        </div>
        {expiredFamily === selected.id && <p className="notice" role="status">Kod wygasł. Wygeneruj nowy kod, aby połączyć urządzenie.</p>}
        {code?.familyId === selected.id && <div className="pairing-code">
          <p>Kod jednorazowy</p>
          <output aria-label="Kod parowania">{code.code}</output>
          <p>Ważny do {dateLabel(code.expiresAt)}.</p>
          <button type="button" onClick={() => setCode(undefined)}>Ukryj kod</button>
        </div>}
        <h4>Urządzenia</h4>
        {familyDevices.length ? <>
          <p className="device-count">Liczba urządzeń: {familyDevices.length} (w tym urządzenia z cofniętym dostępem)</p>
          <ul className="device-list">{familyDevices.map(device => <li key={device.id} aria-label={device.label}>
            <div><strong>{device.label}</strong><p>Ostatnie połączenie: {dateLabel(device.lastSeenAt)}</p></div>
            {device.revokedAt ? <span className="badge draft">Dostęp cofnięty: {dateLabel(device.revokedAt)}</span>
              : <button type="button" disabled={busy} onClick={() => revoke(device)}>Unieważnij dostęp</button>}
          </li>)}</ul>
        </> : <p>Brak urządzeń w tej rodzinie.</p>}
      </article>
    </div> : <p className="panel">Nie ma jeszcze rodzin.</p>}
    {confirmation.dialog}
  </section>;
}
