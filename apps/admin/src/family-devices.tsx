import { useEffect, useState, type FormEvent } from "react";
import { type Device, type Family, type PairingCode } from "../../../packages/contracts/src/admin.ts";
import { type AdminApi } from "./admin-api.ts";
import { dateLabel, formText } from "./owner-forms.tsx";

export type RunAdminAction = (action: () => Promise<void>, success?: string) => Promise<boolean>;

export function FamilyDevices({ api, families, devices, busy, run, onFamily, onDevice }: {
  api: AdminApi; families: Family[]; devices: Device[]; busy: boolean; run: RunAdminAction;
  onFamily: (family: Family) => void; onDevice: (device: Device) => void;
}) {
  const [code, setCode] = useState<(PairingCode & { familyId: string })>();
  useEffect(() => {
    if (!code) return;
    const expiry = Date.parse(code.expiresAt);
    const recheck = () => { if (Date.now() >= expiry) setCode(current => current === code ? undefined : current); };
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
      onFamily(await api.createFamily(label));
      form.reset();
    }, "Dodano rodzinę.");
  }

  function issue(family: Family) {
    setCode(undefined);
    void run(async () => {
      const reply = await api.issueCode(family.id);
      if (Date.parse(reply.expiresAt) > Date.now()) setCode({ ...reply, familyId: family.id });
    });
  }

  function revoke(device: Device) {
    if (!window.confirm(`Unieważnić dostęp urządzenia „${device.label}”?\n\n` +
      "Lekcji pobranych na urządzenie, które pozostaje offline, nie można zdalnie usunąć. " +
      "Wcześniej wydany podpisany adres pobierania może działać do wygaśnięcia.")) return;
    void run(async () => onDevice(await api.revoke(device.id)), "Cofnięto dostęp urządzenia.");
  }

  return <section aria-label="Rodziny i urządzenia">
    <h2 id="admin-view-heading" tabIndex={-1}>Rodziny i urządzenia</h2>
    <form className="panel stack-form" onSubmit={add}>
      <label>Nazwa rodziny<input name="label" required maxLength={80} /></label>
      <button type="submit" className="primary" disabled={busy}>Dodaj rodzinę</button>
    </form>
    <div className="card-list">
      {families.map(family => <article key={family.id} className="panel" aria-label={family.label}>
        <h3>{family.label}</h3>
        {!family.enabled && <p>Rodzina nieaktywna</p>}
        {family.enabled && <button type="button" disabled={busy} onClick={() => issue(family)}>Wygeneruj kod</button>}
        {code?.familyId === family.id && <div className="pairing-code">
          <p>Kod jest jednorazowy. Ważny do {dateLabel(code.expiresAt)}.</p>
          <output aria-label="Kod parowania">{code.code}</output>
          <button type="button" onClick={() => setCode(undefined)}>Ukryj kod</button>
        </div>}
        <ul className="device-list">
          {devices.filter(device => device.familyId === family.id).map(device => <li key={device.id} aria-label={device.label}>
            <strong>{device.label}</strong>
            <div>Ostatnie połączenie: {dateLabel(device.lastSeenAt)}</div>
            {device.revokedAt ? <p>Dostęp cofnięty: {dateLabel(device.revokedAt)}</p>
              : <button type="button" disabled={busy} onClick={() => revoke(device)}>Unieważnij dostęp</button>}
          </li>)}
        </ul>
        {devices.every(device => device.familyId !== family.id) && <p>Brak urządzeń w tej rodzinie.</p>}
      </article>)}
    </div>
  </section>;
}
