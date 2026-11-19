import { useState } from 'react';
import { addDays, formatMoney, todayBerlin, type BookingDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, useToast } from '../ui.tsx';
import { MailDialog } from './MailDialog.tsx';
import { StatusFlow, type FlowKind } from './BookingDialog.tsx';
import { deDate, persons } from './common.tsx';

const FOLLOW_UP = ['nicht erreicht', 'Nachricht hinterlassen', 'überlegt noch', 'ruft zurück'];

/**
 * Vereinfachtes Fenster für eine offene Anfrage: wer, wann, welches Zimmer – Anrufen oder E-Mail –
 * dann Zusagen, Absagen oder kurz vermerken, was beim Rückruf herauskam. „Alle Details“ öffnet die volle Reservierung.
 */
export function RequestView({ booking: b, onClose, onFull }: { booking: BookingDto; onClose: () => void; onFull: () => void }) {
  const { bump } = useData();
  const { user } = useAuth();
  const toast = useToast();
  const today = todayBerlin();
  const open = b.rooms.filter((r) => r.status === 'tentative');
  const from = open.map((r) => r.from).sort()[0] ?? today;
  const to = open.map((r) => r.to).sort().at(-1) ?? today;
  const nights = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
  const total = open.reduce((s, r) => s + (r.nightly ?? []).reduce((x, n) => x + n.priceCents, 0), 0);
  const name = [b.guest.firstName, b.guest.lastName].filter(Boolean).join(' ');
  const phone = b.guest.phone.trim();
  const email = b.guest.email.trim();
  const expired = !!b.optionUntil && b.optionUntil < today;
  const [flow, setFlow] = useState<FlowKind | null>(null);
  const [mail, setMail] = useState(false);
  const [note, setNote] = useState(false);
  const [text, setText] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async (extendDays: number) => {
    const what = text.trim();
    if (!what && !extendDays) return;
    setBusy(true);
    const now = new Date();
    const stamp = `${now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} ${user.name}`;
    const base = b.optionUntil && b.optionUntil > today ? b.optionUntil : today;
    const opt = extendDays ? (addDays(base, extendDays) > from ? from : addDays(base, extendDays)) : undefined;
    const line = `${stamp}: ${what || 'nachgefragt'}${opt ? ` – Option bis ${deDate(opt).slice(0, 6)}` : ''}`;
    const notes = (b.notes.trim() ? `${b.notes.trim()}\n${line}` : line).slice(-2000);
    try {
      await api('PATCH', `/bookings/${b.id}`, { notes, ...(opt ? { optionUntil: opt } : {}), version: b.version });
      toast('Vermerkt'); setNote(false); setText(''); bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };

  return (
    <Dialog title={`Anfrage von ${name || 'Gast'}`} onClose={onClose}
      footer={<><button type="button" className="linkbtn left" onClick={onFull}>Alle Details der Reservierung</button><Button onClick={onClose}>Schließen</Button></>}>
      <div className="rq">
        <div className="rq-facts">
          <div><span>Wann</span><b>{deDate(from)} – {deDate(to)}</b><small>{nights} {nights === 1 ? 'Nacht' : 'Nächte'}</small></div>
          <div><span>Zimmer</span><b>{open.map((r) => r.roomNumber).join(', ')}</b><small>{open.map((r) => persons(r.adults, r.children)).join(' · ')}</small></div>
          <div><span>Preis</span><b>{formatMoney(total)}</b><small>Übernachtung</small></div>
          <div className={expired ? 'late' : ''}><span>Vorgemerkt bis</span><b>{b.optionUntil ? deDate(b.optionUntil) : '–'}</b><small>{expired ? 'abgelaufen' : b.optionUntil === today ? 'läuft heute ab' : ' '}</small></div>
        </div>

        <h3>1. Gast erreichen</h3>
        <div className="rq-contact">
          {phone ? <a className="btn primary big" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>Anrufen · {phone}</a> : <span className="muted">Keine Telefonnummer gespeichert.</span>}
          {email && <Button onClick={() => setMail(true)}>E-Mail „Zimmer ist vorgemerkt“</Button>}
        </div>
        {b.notes.trim() && <pre className="rq-notes">{b.notes.trim()}</pre>}
        {note ? (
          <div className="rq-note">
            <div className="chips">{FOLLOW_UP.map((t) => <button type="button" key={t} className={`chip${text === t ? ' on' : ''}`} onClick={() => setText(t)}>{t}</button>)}</div>
            <Field label="Was kam beim Rückruf heraus?" wide><input value={text} maxLength={300} autoFocus onChange={(e) => setText(e.target.value)} placeholder="z. B. ruft Freitag zurück" /></Field>
            <div className="formactions">
              <Button onClick={() => { setNote(false); setText(''); }}>Abbrechen</Button>
              <Button busy={busy} disabled={!text.trim()} onClick={() => void save(3)}>Vermerken + 3 Tage länger vormerken</Button>
              <Button variant="primary" busy={busy} disabled={!text.trim()} onClick={() => void save(0)}>Vermerken</Button>
            </div>
          </div>
        ) : <button type="button" className="linkbtn" onClick={() => setNote(true)}>+ Notiz zum Rückruf</button>}

        <h3>2. Entscheiden</h3>
        <div className="rq-decide">
          <button type="button" className="rq-yes" onClick={() => setFlow('confirm')}><b>Zusagen</b><span>Der Gast kommt – fest buchen</span></button>
          <button type="button" className="rq-no" onClick={() => setFlow('decline')}><b>Absagen</b><span>Der Gast kommt nicht – Zimmer wieder frei</span></button>
        </div>
        <p className="muted small">{email ? 'Bei Zusagen und Absagen erscheint zuerst die E-Mail an den Gast – Sie können sie senden oder ohne E-Mail fortfahren.' : 'Ohne E-Mail-Adresse wird nach einer kurzen Rückfrage direkt zugesagt bzw. abgesagt.'}</p>
        {email && (more
          ? <Button onClick={() => setFlow('question')}>Rückfrage per E-Mail (z. B. fehlende Angaben)</Button>
          : <button type="button" className="linkbtn" onClick={() => setMore(true)}>Weitere Möglichkeiten …</button>)}
      </div>
      {flow && <StatusFlow booking={b} kind={flow} roomIds={open.map((r) => r.id)} onClose={(changed) => { setFlow(null); if (changed && flow !== 'question') onClose(); }} />}
      {mail && <MailDialog path={`/bookings/${b.id}/mail`} title={`Anfrage ${b.number}: Zimmer vorgemerkt`} onClose={() => setMail(false)} onSent={() => { setMail(false); bump(); }} />}
    </Dialog>
  );
}
