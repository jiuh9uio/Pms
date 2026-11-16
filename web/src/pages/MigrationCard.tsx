import { useState } from 'react';
import { Button, Field, useToast } from '../ui.tsx';

interface Summary { version: string; createdAt: string; tables: number; rows: number; guests: number; bookings: number; invoices: number; users: number }

const errText = async (res: Response) => { const j = await res.json().catch(() => null); return j?.error?.message ?? `Fehler ${res.status}`; };

/**
 * Umzug auf einen anderen Rechner oder Server: ein verschlüsseltes Paket mit ALLEN Daten erstellen
 * bzw. auf der neuen Installation einspielen (ersetzt dort alles).
 */
export function MigrationCard() {
  const toast = useToast();
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busyExp, setBusyExp] = useState(false);
  const [expErr, setExpErr] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pw, setPw] = useState('');
  const [sum, setSum] = useState<Summary | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busyImp, setBusyImp] = useState(false);
  const [impErr, setImpErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const doExport = async () => {
    setExpErr(null);
    if (pw1.length < 10) return setExpErr('Bitte ein Passwort mit mindestens 10 Zeichen wählen.');
    if (pw1 !== pw2) return setExpErr('Die beiden Passwörter stimmen nicht überein.');
    setBusyExp(true);
    try {
      const res = await fetch('/api/v1/settings/migration/export', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw1 }) });
      if (!res.ok) throw new Error(await errText(res));
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'Umzug.pmsumzug';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('Umzugspaket erstellt');
      setPw1(''); setPw2('');
    } catch (e) { setExpErr(e instanceof Error ? e.message : 'Fehler'); }
    setBusyExp(false);
  };

  const send = (path: string, extra: Record<string, string> = {}) => fetch(`/api/v1/settings/migration/${path}`, {
    method: 'POST', credentials: 'same-origin', body: file!,
    headers: { 'Content-Type': 'application/octet-stream', 'x-package-password': encodeURIComponent(pw), ...extra },
  });
  const doCheck = async () => {
    if (!file) return;
    setImpErr(null); setSum(null); setBusyImp(true);
    try { const res = await send('check'); if (!res.ok) throw new Error(await errText(res)); setSum(await res.json() as Summary); }
    catch (e) { setImpErr(e instanceof Error ? e.message : 'Fehler'); }
    setBusyImp(false);
  };
  const doImport = async () => {
    setImpErr(null); setBusyImp(true);
    try { const res = await send('import', { 'x-confirm': confirm.trim() }); if (!res.ok) throw new Error(await errText(res)); setDone(true); }
    catch (e) { setImpErr(e instanceof Error ? e.message : 'Fehler'); }
    setBusyImp(false);
  };

  return (
    <section className="card">
      <h2>Umzug auf einen anderen Rechner oder Server</h2>
      <p className="muted small">Für den Wechsel auf einen neuen PC oder später auf den Online-Server: Das Umzugspaket enthält <b>alle Daten</b> (Gäste, Buchungen, Rechnungen, Benutzerkonten mit Passwörtern, Einstellungen, Protokoll) und den Schlüssel dieser Installation. Es ist mit einem Passwort verschlüsselt, das Sie hier selbst wählen – ohne dieses Passwort lässt sich die Datei nicht öffnen. Das Passwort bitte nicht vergessen und nicht zusammen mit der Datei aufbewahren.</p>

      <h3>1. Auf dem bisherigen Rechner: Paket erstellen</h3>
      <div className="formgrid">
        <Field label="Passwort für das Paket (mind. 10 Zeichen)"><input type="password" autoComplete="new-password" value={pw1} onChange={(e) => setPw1(e.target.value)} /></Field>
        <Field label="Passwort wiederholen"><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      </div>
      {expErr && <p className="notice danger" role="alert">{expErr}</p>}
      <div className="formactions"><Button busy={busyExp} onClick={() => void doExport()}>Umzugspaket erstellen</Button></div>

      <h3>2. Auf dem neuen Rechner/Server: Paket einspielen</h3>
      {done ? (
        <div className="notice">
          <b>Umzug abgeschlossen.</b> Alle Daten wurden übernommen. Bitte jetzt mit dem Benutzernamen und Passwort vom <b>bisherigen</b> Rechner neu anmelden.
          <div className="formactions"><Button variant="primary" onClick={() => { window.location.href = '/'; }}>Zur Anmeldung</Button></div>
        </div>
      ) : <>
        <p className="notice warn small"><b>Achtung:</b> Beim Einspielen werden <b>alle Daten auf diesem Rechner ersetzt</b> – auch die Benutzerkonten. Das ist nur für eine neue, noch leere Installation gedacht. Vorher wird empfohlen, oben „Jetzt sichern“ zu drücken. Dieses Programm muss mindestens dieselbe Version haben wie das, mit dem das Paket erstellt wurde.</p>
        <div className="formgrid">
          <Field label="Umzugspaket (.pmsumzug)">
            <label className="btn">Datei wählen …<input type="file" accept=".pmsumzug" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSum(null); setImpErr(null); e.target.value = ''; }} /></label>
            {file && <span className="muted small"> {file.name} · {file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} kB` : `${(file.size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`}</span>}
          </Field>
          <Field label="Passwort des Pakets"><input type="password" autoComplete="off" value={pw} onChange={(e) => { setPw(e.target.value); setSum(null); }} /></Field>
        </div>
        {impErr && <p className="notice danger" role="alert">{impErr}</p>}
        {!sum && <div className="formactions"><Button busy={busyImp} disabled={!file || !pw} onClick={() => void doCheck()}>Paket prüfen</Button></div>}
        {sum && (
          <div className="notice warn">
            <b>Inhalt des Pakets</b> (erstellt am {new Date(sum.createdAt).toLocaleString('de-DE')} mit Version {sum.version}):
            <ul>
              <li>{sum.guests} Gäste · {sum.bookings} Buchungen · {sum.invoices} Rechnungen · {sum.users} Benutzerkonten</li>
              <li>insgesamt {sum.rows} Einträge in {sum.tables} Tabellen</li>
            </ul>
            <Field label="Zum Bestätigen das Wort UMZUG eintippen"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <div className="formactions"><Button variant="danger" busy={busyImp} disabled={confirm.trim() !== 'UMZUG'} onClick={() => void doImport()}>Alle Daten ersetzen und Paket einspielen</Button></div>
          </div>
        )}
      </>}
    </section>
  );
}
