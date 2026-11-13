import { useState } from 'react';
import { api } from '../api.ts';
import { Badge, Button, LoadState, fmtDateTime, useLoad, useToast } from '../ui.tsx';

export interface UpdateStatus {
  supported: boolean; current: string; latest: string | null; available: boolean;
  checkedAt: string | null; error: string | null; notes: string; installing: boolean;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** „Was ist neu“: Änderungen je Version, die aktuelle aufgeklappt. */
export function Changelog({ current }: { current?: string }) {
  const { data } = useLoad(() => api<{ version: string; text: string }[]>('GET', '/update/changelog'));
  if (!data || data.length === 0) return null;
  return (
    <section className="card">
      <h2>Was ist neu</h2>
      {data.map((e, i) => (
        <details key={e.version} className="changelog" open={current ? e.version === current : i === 0}>
          <summary>Version {e.version}{e.version === current && ' – installiert'}</summary>
          <ul>{e.text.split('\n').map((l) => l.trim()).filter(Boolean).map((l, n) => (l.startsWith('- ') ? <li key={n}>{l.slice(2)}</li> : <li key={n} className="plain">{l}</li>))}</ul>
        </details>
      ))}
    </section>
  );
}

/** Programm-Update: Version anzeigen, nach Updates suchen, mit einem Klick einspielen. */
export function UpdateCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<UpdateStatus>('GET', '/update/status'));
  const [fresh, setFresh] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<'' | 'check' | 'install'>('');
  const [phase, setPhase] = useState('');
  const [fail, setFail] = useState<string | null>(null);
  const s = fresh ?? data;
  if (!s) return <section className="card"><h2>Programm-Update</h2><LoadState error={error} loading /></section>;

  const check = async () => {
    setBusy('check'); setFail(null);
    try {
      const r = await api<UpdateStatus>('GET', '/update/status?refresh=1');
      setFresh(r);
      if (!r.error) toast(r.available ? `Version ${r.latest} ist verfügbar` : 'Das Programm ist aktuell');
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy('');
  };

  const install = async () => {
    if (!window.confirm(`Version ${s.latest} jetzt einspielen?\n\nVorher wird automatisch eine Datensicherung geschrieben. Das Programm ist danach für etwa eine Minute nicht erreichbar – bitte vorher alle offenen Eingaben an anderen Geräten speichern.`)) return;
    setBusy('install'); setFail(null); setPhase('Update wird heruntergeladen und geprüft …');
    let target: string;
    try {
      target = (await api<{ version: string }>('POST', '/update/install', {})).version;
    } catch (e) {
      setFail(e instanceof Error ? e.message : 'Fehler'); setBusy(''); setPhase('');
      return;
    }
    setPhase('Das Programm wird neu gestartet …');
    // warten, bis die neue Version antwortet (höchstens 5 Minuten)
    for (let i = 0; i < 150; i++) {
      await wait(2000);
      try {
        const r = await api<UpdateStatus>('GET', '/update/status');
        if (r.current === target) { window.location.reload(); return; }
      } catch { /* während des Neustarts nicht erreichbar */ }
    }
    setBusy(''); setPhase('');
    setFail('Das Programm hat sich nach dem Update nicht wieder gemeldet. Bitte am PMS-Rechner „PMS starten“ ausführen; das Protokoll liegt im Ordner update (update.log).');
  };

  return (
    <section className="card">
      <h2>Programm-Update</h2>
      <p>
        Installierte Version: <b>{s.current}</b>{' '}
        {s.supported && (s.available ? <Badge tone="warn">Version {s.latest} verfügbar</Badge> : s.latest ? <Badge tone="ok">aktuell</Badge> : null)}
      </p>
      {!s.supported && <p className="muted small">Das automatische Update gibt es nur in der Windows-Version (pms.exe). Diese Installation wird über den Quelltext aktualisiert.</p>}
      {s.supported && <>
        {s.available && s.notes && <><h3>Neu in Version {s.latest}</h3><p className="pre">{s.notes}</p></>}
        {s.error && <p className="notice danger">Update-Prüfung fehlgeschlagen: {s.error}</p>}
        {fail && <p className="notice danger">{fail}</p>}
        {phase && <p className="notice">{phase} Diese Seite bitte geöffnet lassen.</p>}
        <p className="muted small">
          {s.checkedAt ? `Zuletzt geprüft: ${fmtDateTime(s.checkedAt)}. ` : ''}
          Das Programm sieht beim Start und zweimal täglich selbst nach. Eingespielt wird nur auf Knopfdruck: vorher Datensicherung, danach Neustart. Reservierungen, Rechnungen und Einstellungen bleiben erhalten.
        </p>
        <div className="formactions">
          <Button type="button" busy={busy === 'check'} disabled={busy !== ''} onClick={() => void check()}>Nach Updates suchen</Button>
          {s.available && <Button type="button" variant="primary" busy={busy === 'install'} disabled={busy !== ''} onClick={() => void install()}>Jetzt aktualisieren</Button>}
        </div>
      </>}
    </section>
  );
}
