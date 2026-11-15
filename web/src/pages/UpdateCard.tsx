import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Badge, Button, LoadState, fmtDateTime, useLoad, useToast } from '../ui.tsx';

export interface UpdateStatus {
  supported: boolean; current: string; latest: string | null; available: boolean;
  checkedAt: string | null; error: string | null; notes: string; installing: boolean;
  progress?: { step: 'download' | 'verify' | 'unpack' | 'backup' | 'restart'; received: number; total: number | null; attempt: number } | null;
  installError?: string | null;
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

const mb = (n: number) => `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
function stepText(p: UpdateStatus['progress']): string {
  switch (p?.step) {
    case 'verify': return 'Download fertig – Prüfsumme wird kontrolliert …';
    case 'unpack': return 'Update wird entpackt und geprüft …';
    case 'backup': return 'Datensicherung wird geschrieben …';
    case 'restart': return 'Das Programm wird neu gestartet …';
    default: return p && p.attempt > 1 ? 'Verbindung war unterbrochen – Download wird fortgesetzt …' : 'Update wird heruntergeladen …';
  }
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

  /** Fortschritt verfolgen, bis die neue Version antwortet oder ein Fehler gemeldet wird. */
  const follow = async (target: string) => {
    setBusy('install'); setFail(null);
    let gone = 0;
    for (let i = 0; i < 3600; i++) {
      await wait(1000);
      try {
        const r = await api<UpdateStatus>('GET', '/update/status');
        gone = 0;
        if (r.current === target) { window.location.reload(); return; }
        setFresh(r);
        if (!r.installing) { setFail(r.installError ?? 'Das Update wurde abgebrochen.'); setBusy(''); setPhase(''); return; }
        setPhase(stepText(r.progress));
      } catch {
        // während des Neustarts nicht erreichbar – höchstens 5 Minuten warten
        setPhase('Das Programm wird neu gestartet …');
        if (++gone > 300) break;
      }
    }
    setBusy(''); setPhase('');
    setFail('Das Programm hat sich nach dem Update nicht wieder gemeldet. Bitte am PMS-Rechner „PMS starten“ ausführen; das Protokoll liegt im Ordner update (update.log).');
  };
  // läuft schon ein Update (z. B. Seite neu geladen): Fortschritt weiter anzeigen
  useEffect(() => { if (data?.installing && data.latest && busy === '') void follow(data.latest); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data]);

  const install = async () => {
    if (!window.confirm(`Version ${s.latest} jetzt einspielen?\n\nVorher wird automatisch eine Datensicherung geschrieben. Das Programm ist danach für etwa eine Minute nicht erreichbar – bitte vorher alle offenen Eingaben an anderen Geräten speichern.`)) return;
    setBusy('install'); setFail(null); setPhase('Update wird gestartet …');
    let target: string;
    try {
      target = (await api<{ version: string }>('POST', '/update/install', {})).version;
    } catch (e) {
      setFail(e instanceof Error ? e.message : 'Fehler'); setBusy(''); setPhase('');
      return;
    }
    await follow(target);
  };
  const pr = fresh?.installing ? fresh.progress : null;
  const pct = pr?.step === 'download' && pr.total ? Math.min(100, Math.round((pr.received / pr.total) * 100)) : null;

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
        {phase && <div className="notice">
          <p style={{ margin: 0 }}>{phase}</p>
          {pr?.step === 'download' && <div className="uploadbar" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct ?? 5}%` }} />
            <span>{mb(pr.received)}{pr.total ? ` von ${mb(pr.total)}` : ''}{pct !== null ? ` · ${pct} %` : ''}{pr.attempt > 1 ? ` · Versuch ${pr.attempt}` : ''}</span></div>}
          <p className="muted small" style={{ margin: '6px 0 0' }}>Das Update läuft im Hintergrund weiter, auch wenn diese Seite geschlossen wird. Bei langsamem Internet kann der Download einige Minuten dauern.</p>
        </div>}
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
