import { useState } from 'react';
import { api } from '../api.ts';
import { Badge, Button, LoadState, fmtDateTime, useLoad, useToast } from '../ui.tsx';

export interface BackupStatus {
  supported: boolean; auto: boolean; last: { file: string; at: string; sizeKb: number } | null;
  count: number; dir: string; copyDir: string; copyError: string | null; error: string | null; running: boolean;
}

/** Warntext, wenn die Sicherung fehlt, veraltet ist oder die Kopie auf den zweiten Datenträger scheitert. */
export function backupWarning(s: BackupStatus): string | null {
  if (!s.supported) return null;
  if (s.error) return `Die letzte Datensicherung ist fehlgeschlagen: ${s.error}`;
  if (s.copyError) return s.copyError;
  if (!s.last) return null; // frisch eingerichtet – die erste Sicherung folgt wenige Minuten nach dem Start
  const days = Math.floor((Date.now() - new Date(s.last.at).getTime()) / 86_400_000);
  return days >= 3 ? `Die letzte Datensicherung ist ${days} Tage alt.` : null;
}

export function BackupCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<BackupStatus>('GET', '/backup/status'));
  const [fresh, setFresh] = useState<BackupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const s = fresh ?? data;
  if (!s) return <section className="card"><h2>Datensicherung</h2><LoadState error={error} loading /></section>;
  const run = async () => {
    setBusy(true);
    try { setFresh(await api<BackupStatus>('POST', '/backup/run', {})); toast('Datensicherung geschrieben'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const warn = backupWarning(s);
  return (
    <section className="card">
      <h2>Datensicherung</h2>
      {!s.supported ? <p className="muted small">Die eingebaute Sicherung gibt es nur in der Windows-Version (pms.exe). Diese Installation wird über die Skripte unter <code>scripts/</code> gesichert – siehe README.</p> : <>
        <p>
          Letzte Sicherung: {s.last ? <><b>{fmtDateTime(s.last.at)}</b> ({s.last.sizeKb} kB) <Badge tone={warn ? 'danger' : 'ok'}>{warn ? 'prüfen' : 'in Ordnung'}</Badge></> : <b>noch keine</b>}
          {' '}· {s.count} {s.count === 1 ? 'Sicherung' : 'Sicherungen'} im Ordner <code>{s.dir}</code>
        </p>
        {warn && <p className="notice danger">{warn}</p>}
        <p className="muted small">
          {s.auto ? 'Solange das Programm läuft, wird einmal täglich automatisch gesichert; ' : 'Die automatische tägliche Sicherung ist abgeschaltet (BACKUP_AUTO=off in pms.env); '}
          die letzten 30 Sicherungen bleiben erhalten.{' '}
          {s.copyDir
            ? <>Jede Sicherung wird zusätzlich nach <code>{s.copyDir}</code> kopiert.</>
            : <><b>Die Sicherungen liegen nur auf diesem Rechner</b> und schützen nicht vor einem Festplattenschaden oder Diebstahl. Für eine Kopie auf einen zweiten Datenträger (USB-Festplatte, Netzlaufwerk) in der Datei <code>pms.env</code> die Zeile <code>BACKUP_COPY_DIR=E:\PMS-Sicherung</code> eintragen und das Programm neu starten.</>}
          {' '}Die Sicherungen sind nicht verschlüsselt und enthalten Gästedaten.
        </p>
        <div className="formactions"><Button busy={busy} onClick={() => void run()}>Jetzt sichern</Button></div>
      </>}
    </section>
  );
}
