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
  const [parts, setParts] = useState<Record<'temp' | 'clean' | 'goods', boolean>>({ temp: true, clean: false, goods: false });
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const bon = useLoad(() => api<{ ready: boolean; name: string }>('GET', '/hygiene/export/bon')).data;
  const chosen = (['temp', 'clean', 'goods'] as const).filter((k) => parts[k] && !(k === 'goods' && area));
  const ok = !!from && !!to && from <= to && chosen.length > 0;
  const qs = new URLSearchParams({ from, to, ...(area ? { area } : {}), parts: chosen.join(',') }).toString();
  const what = chosen.length === 1 ? { temp: 'Temperaturprotokoll', clean: 'Reinigungsprotokoll', goods: 'Wareneingang' }[chosen[0]!] : 'Eigenkontrolle';
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
    <Dialog title="Protokolle ausgeben" onClose={onClose} size="lg" footer={<Button onClick={onClose}>Schließen</Button>}>
      <div className="btnrow presets">{presets.map(([label, f, t]) => (
        <button key={label} type="button" className={`kindchip${from === f && to === t ? ' on' : ''}`} onClick={() => { setFrom(f); setTo(t); }}>{label}</button>
      ))}</div>
      <div className="formgrid cols3">
        <Field label="Von"><input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Bis"><input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Bereich"><select value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">alle Bereiche</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}{a.id === currentAreaId ? ' (gerade offen)' : ''}</option>)}</select></Field>
      </div>
      <fieldset className="exp-parts">
        <legend>Was soll ins PDF?</legend>
        <label className="check"><input type="checkbox" checked={parts.temp} onChange={(e) => setParts({ ...parts, temp: e.target.checked })} /><span>Temperaturen</span></label>
        <label className="check"><input type="checkbox" checked={parts.clean} onChange={(e) => setParts({ ...parts, clean: e.target.checked })} /><span>Reinigung</span></label>
        <label className="check"><input type="checkbox" checked={parts.goods && !area} disabled={!!area} onChange={(e) => setParts({ ...parts, goods: e.target.checked })} /><span>Wareneingang{area ? ' (nur bei „alle Bereiche“)' : ''}</span></label>
        <button type="button" className="linkbtn" onClick={() => setParts({ temp: true, clean: true, goods: true })}>alles auswählen</button>
        {chosen.length === 0 && <span className="muted small">Bitte mindestens einen Teil auswählen.</span>}
      </fieldset>
      <div className="exportchoices">
        <section>
          <h3 className="first">Großer Drucker / PDF</h3>
          <p className="muted small">Ein PDF im Querformat mit allem, was oben ausgewählt ist: Temperaturen mit Sollbereichen, Abweichungen in Rot und Maßnahmen; Reinigung mit Tag, Aufgabe, Name und Uhrzeit; Wareneingang mit Lieferant, Ware, Temperatur und Ergebnis.</p>
          <a className={`btn primary${ok ? '' : ' disabled'}`} href={ok ? `/api/v1/hygiene/export/pdf?${qs}` : undefined} target="_blank" rel="noopener">PDF ansehen und drucken</a>
        </section>
        <section>
          <h3 className="first">Per E-Mail</h3>
          <p className="muted small">Dasselbe PDF als Anhang, z. B. an das Hygieneamt. Text und Empfänger prüfen Sie vor dem Senden.</p>
          <Button disabled={!ok} onClick={() => setMail(true)}>Per E-Mail senden …</Button>
        </section>
        <section>
          <h3 className="first">Bondrucker</h3>
          <p className="muted small">Nur die Temperaturen, sehr kompakt: je Tag eine Zeile mit allen Werten – so passt auch ein langer Zeitraum auf den Bon. „!“ = außerhalb des Sollbereichs, „ok“ = im Soll bestätigt, „-“ = fehlt.</p>
          {bon?.ready ? <Button busy={busy} disabled={!from || !to || from > to} onClick={() => void printBon()}>Auf {bon.name} drucken</Button>
            : <p className="muted small">Kein Bondrucker eingerichtet (Verwaltung → Einstellungen → Geräte).</p>}
        </section>
      </div>
      {mail && <MailDialog path={`/hygiene/export/mail?${qs}`} title={`${what} per E-Mail`} sendLabel="Senden" onClose={() => setMail(false)} onSent={() => setMail(false)}
        intro={<p className="muted small">Angehängt wird das PDF „{what}“ mit den ausgewählten Teilen.</p>} />}
    </Dialog>
  );
}
