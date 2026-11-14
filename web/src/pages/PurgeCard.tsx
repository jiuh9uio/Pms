import { useState } from 'react';
import type { PurgeResult } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Field, useToast } from '../ui.tsx';

type Sel = { billing: boolean; bookings: 'none' | 'past' | 'all'; guests: boolean; resetNumbers: boolean };

/** Hotel-Daten löschen: Auswahl → Vorschau (zählt nur) → Passwort und Bestätigung → löschen. */
export function PurgeCard() {
  const toast = useToast();
  const { bump } = useData();
  const [sel, setSel] = useState<Sel>({ billing: false, bookings: 'none', guests: false, resetNumbers: false });
  const [preview, setPreview] = useState<PurgeResult | null>(null);
  const [done, setDone] = useState<PurgeResult | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const change = (p: Partial<Sel>) => { setSel({ ...sel, ...p }); setPreview(null); setDone(null); setFail(null); };
  const nothing = !sel.billing && sel.bookings === 'none' && !sel.guests;
  const run = async (dryRun: boolean) => {
    setBusy(true); setFail(null);
    try {
      const r = await api<PurgeResult>('POST', '/settings/purge', { ...sel, dryRun, password: dryRun ? '' : password, confirm: dryRun ? '' : confirm.trim().toUpperCase() });
      if (dryRun) setPreview(r);
      else { setDone(r); setPreview(null); setPassword(''); setConfirm(''); toast('Daten gelöscht'); bump(); }
    } catch (e) {
      const err = e as { message?: string; fields?: Record<string, string> };
      setFail(Object.values(err.fields ?? {}).join(' · ') || err.message || 'Fehler');
    }
    setBusy(false);
  };
  const counts = (r: PurgeResult) => (
    <ul>
      {sel.billing && <li><b>{r.invoices}</b> Rechnungen und Stornobelege mit ihren gespeicherten PDF-Dateien, <b>{r.payments}</b> Zahlungen{r.einvoices > 0 && <>, <b>{r.einvoices}</b> daraus erzeugte E-Rechnungen</>} und das Protokoll des EC-Geräts</li>}
      {sel.bookings !== 'none' && <li><b>{r.bookings}</b> {sel.bookings === 'past' ? 'vergangene ' : ''}Buchungen und <b>{r.blocks}</b> {sel.bookings === 'past' ? 'abgelaufene oder aufgehobene ' : ''}Zimmersperren</li>}
      {r.keptBookings > 0 && <li><b>{r.keptBookings}</b> Buchungen bleiben stehen, weil Rechnungen oder Zahlungen daran hängen. Sollen sie auch weg, zusätzlich „Rechnungen und Zahlungen“ ankreuzen.</li>}
      {sel.guests && <li><b>{r.guests}</b> Gäste ohne Buchung</li>}
    </ul>
  );
  return (
    <section className="card">
      <h2>Hotel-Daten löschen</h2>
      <p className="notice danger"><b>Gelöschtes ist endgültig weg.</b> Gedacht ist das zum Aufräumen von Probedaten, bevor der echte Betrieb beginnt. Echte Rechnungen und Zahlungen müssen nach Steuerrecht mehrere Jahre aufbewahrt werden – bitte nicht löschen, ohne das mit der Steuerberatung geklärt zu haben.</p>
      <p className="muted">Zimmer, Preise, Firmen, Benutzer, Einstellungen, Restaurant und Kontrollen bleiben unberührt. Das Protokoll bleibt ebenfalls erhalten.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={sel.billing} onChange={(e) => change({ billing: e.target.checked, resetNumbers: e.target.checked && sel.resetNumbers })} /><span>Rechnungen und Zahlungen<small>alle Rechnungen, Stornobelege, Zahlungen und das Rechnungsarchiv</small></span></label>
        {sel.billing && <label className="check wide"><input type="checkbox" checked={sel.resetNumbers} onChange={(e) => change({ resetNumbers: e.target.checked })} /><span>Rechnungsnummern wieder bei 1 beginnen<small>nur sinnvoll, wenn bisher keine echte Rechnung an einen Gast ging – sonst gäbe es Nummern doppelt</small></span></label>}
        <Field label="Buchungen" wide>
          <select value={sel.bookings} onChange={(e) => change({ bookings: e.target.value as Sel['bookings'] })}>
            <option value="none">nicht löschen</option>
            <option value="past">nur vergangene (Abreise vor heute)</option>
            <option value="all">alle – auch laufende und künftige</option>
          </select>
        </Field>
        <label className="check wide"><input type="checkbox" checked={sel.guests} onChange={(e) => change({ guests: e.target.checked })} /><span>Gäste ohne Buchung<small>Gäste, zu denen danach keine Buchung mehr gehört</small></span></label>
      </div>
      <div className="formactions"><Button busy={busy && !preview} disabled={nothing || busy} onClick={() => void run(true)}>Prüfen, was gelöscht würde</Button></div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      {preview && (
        <>
          <h3>Das würde gelöscht</h3>
          {counts(preview)}
          <p className="muted small">Vor dem Löschen schreibt das Programm automatisch eine Datensicherung (in der Windows-Version). Bitte beachten: Alte Sicherungen werden mit der Zeit durch neue ersetzt – wer die Daten aufheben will, kopiert die Sicherungsdatei an einen eigenen Ort.</p>
          <div className="formgrid cols3">
            <Field label="Ihr Passwort"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
            <Field label="Zur Bestätigung LÖSCHEN eintippen"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          </div>
          <div className="formactions"><Button variant="danger" busy={busy} disabled={!password || confirm.trim().toUpperCase() !== 'LÖSCHEN'} onClick={() => void run(false)}>Jetzt endgültig löschen</Button></div>
        </>
      )}
      {done && (
        <div className="notice">
          <b>Gelöscht:</b>
          {counts(done)}
          {done.backupFile ? <>Sicherung davor: <code>{done.backupFile}</code></> : 'Es wurde keine Sicherung geschrieben (die eingebaute Sicherung gibt es nur in der Windows-Version).'}
        </div>
      )}
    </section>
  );
}
