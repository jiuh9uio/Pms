import { useState } from 'react';
import { addDays, todayBerlin } from '../../../src/shared/hotel.js';
import type { HygieneAreaDto } from '../../../src/shared/controls.js';
import { api } from '../api.ts';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Button, Dialog, Field, useLoad, useToast } from '../ui.tsx';

/** Temperaturprotokoll ausgeben: PDF ansehen/drucken (großer Drucker), per E-Mail (z. B. ans Hygieneamt) oder kompakt auf dem Bondrucker. */
export function HygieneExport({ areas, currentAreaId, onClose }: { areas: HygieneAreaDto[]; currentAreaId: string | null; onClose: () => void }) {
  const toast = useToast();
  const today = todayBerlin();
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const lastMonthEnd = addDays(firstOfMonth, -1);
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [area, setArea] = useState<string>('');
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const bon = useLoad(() => api<{ ready: boolean; name: string }>('GET', '/hygiene/export/bon')).data;
  const ok = !!from && !!to && from <= to;
  const qs = new URLSearchParams({ from, to, ...(area ? { area } : {}) }).toString();
  const presets: [string, string, string][] = [
    ['Dieser Monat', firstOfMonth, today], ['Letzter Monat', `${lastMonthEnd.slice(0, 8)}01`, lastMonthEnd],
    ['Letzte 7 Tage', addDays(today, -6), today], ['Letzte 30 Tage', addDays(today, -29), today], ['Letzte 90 Tage', addDays(today, -89), today],
  ];
  const printBon = async () => {
    setBusy(true);
    try { await api('POST', `/hygiene/export/bon?${qs}`); toast(`Auf ${bon?.name ?? 'dem Bondrucker'} gedruckt`); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title="Temperaturprotokoll ausgeben" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Schließen</Button>}>
      <div className="btnrow presets">{presets.map(([label, f, t]) => (
        <button key={label} type="button" className={`kindchip${from === f && to === t ? ' on' : ''}`} onClick={() => { setFrom(f); setTo(t); }}>{label}</button>
      ))}</div>
      <div className="formgrid cols3">
        <Field label="Von"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Bis"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Bereich"><select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">alle Bereiche</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === currentAreaId ? ' (gerade offen)' : ''}</option>)}</select></Field>
      </div>
      <div className="exportchoices">
        <section>
          <h3 className="first">Großer Drucker / PDF</h3>
          <p className="muted small">Übersichtliche Tabelle im Querformat mit Sollbereichen, Abweichungen in Rot und allen Maßnahmen – zum Drucken, Speichern oder Abheften.</p>
          <a className={`btn primary${ok ? '' : ' disabled'}`} href={ok ? `/api/v1/hygiene/export/pdf?${qs}` : undefined} target="_blank" rel="noopener">PDF ansehen und drucken</a>
        </section>
        <section>
          <h3 className="first">Per E-Mail</h3>
          <p className="muted small">Dasselbe PDF als Anhang, z. B. an das Hygieneamt. Text und Empfänger prüfen Sie vor dem Senden.</p>
          <Button disabled={!ok} onClick={() => setMail(true)}>Per E-Mail senden …</Button>
        </section>
        <section>
          <h3 className="first">Bondrucker</h3>
          <p className="muted small">Sehr kompakt: je Tag eine Zeile mit allen Werten – so passt auch ein langer Zeitraum auf den Bon. „!“ = außerhalb des Sollbereichs, „ok“ = im Soll bestätigt, „-“ = fehlt.</p>
          {bon?.ready ? <Button busy={busy} disabled={!ok} onClick={() => void printBon()}>Auf {bon.name} drucken</Button>
            : <p className="muted small">Kein Bondrucker eingerichtet (Verwaltung → Einstellungen → Geräte).</p>}
        </section>
      </div>
      {mail && <MailDialog path={`/hygiene/export/mail?${qs}`} title="Temperaturprotokoll per E-Mail" sendLabel="Senden" onClose={() => setMail(false)} onSent={() => setMail(false)}
        intro={<p className="muted small">Angehängt wird das Temperaturprotokoll als PDF.</p>} />}
    </Dialog>
  );
}
