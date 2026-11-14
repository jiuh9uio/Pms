import { useEffect, useState } from 'react';
import { STATUS_LABEL, formatMoney, publicArrivalInput, type PublicBooking } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, useLoad, useSubmit } from '../ui.tsx';

/** Seite für den Gast (ohne Anmeldung, über seinen persönlichen Link): Reservierung ansehen, Ankunftszeit mitteilen, stornieren. */
export function BookingPage() {
  const token = window.location.pathname.split('/')[2] ?? '';
  const path = `/public/booking/${token}`;
  const first = useLoad(() => api<PublicBooking>('GET', path));
  const [fresh, setFresh] = useState<PublicBooking | null>(null);
  const b = fresh ?? first.data;
  const [v, setV] = useState({ time: '', message: '' });
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (first.data) setV({ time: first.data.arrivalTime, message: first.data.guestMessage }); }, [first.data]);
  const f = useSubmit(publicArrivalInput, async (d) => { setFresh(await api<PublicBooking>('POST', `${path}/arrival`, d)); setSaved(true); });
  const cancel = async () => {
    setBusy(true); setFail(null);
    try { setFresh(await api<PublicBooking>('POST', `${path}/cancel`, { confirm: true })); setAsk(false); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); }
    setBusy(false);
  };
  if (!b) return <div className="guestform"><LoadState error={first.error} loading /></div>;
  const persons = (r: PublicBooking['rooms'][number]) => `${r.adults} ${r.adults === 1 ? 'Erwachsener' : 'Erwachsene'}${r.children ? `, ${r.children} ${r.children === 1 ? 'Kind' : 'Kinder'}` : ''}`;
  return (
    <div className="guestform">
      <header><b>{b.hotelName}</b><h1>Ihre Reservierung</h1>
        <p className="muted">Nr. {b.number} · {b.guestName}</p></header>
      {b.state === 'cancelled' && <p className="notice warn"><b>Diese Reservierung ist storniert.</b> Wenn das ein Versehen war, rufen Sie uns bitte an{b.hotelPhone && ` (${b.hotelPhone})`}.</p>}
      <section className="card">
        <h2>{deDate(b.from)} bis {deDate(b.to)}</h2>
        <ul className="plain">{b.rooms.map((r, i) => (
          <li key={i}><b>{r.category}</b> · {r.nights} {r.nights === 1 ? 'Nacht' : 'Nächte'} · {persons(r)}{b.rooms.length > 1 && <> · {deDate(r.from)}–{deDate(r.to)}</>}{r.status === 'tentative' && <> <Badge tone="warn">{STATUS_LABEL[r.status]}</Badge></>}</li>
        ))}</ul>
        {b.state !== 'cancelled' && <p>Gesamtbetrag: <b>{formatMoney(b.totalCents)}</b> <span className="muted small">inklusive Umsatzsteuer</span></p>}
        <p className="muted small">Anreise ab {b.checkinTime} Uhr.{b.hotelPhone && ` Bei Fragen: ${b.hotelPhone}.`}</p>
      </section>
      {b.state === 'active' && (
        <form className="card" onSubmit={(e) => { setSaved(false); void f.submit(v, e); }} noValidate>
          <h2>Wann kommen Sie an?</h2>
          <div className="formgrid">
            <Field label="Voraussichtliche Ankunftszeit" error={f.errors.time} hint="freiwillig – hilft uns bei der Planung"><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
            <Field label="Nachricht an uns" error={f.errors.message} wide hint="z. B. späte Anreise, Kinderbett, Unverträglichkeiten"><textarea rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
          </div>
          <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
          {saved && <p className="notice">Danke – wir haben Ihre Angaben erhalten.</p>}
        </form>
      )}
      {b.state === 'active' && (
        <section className="card">
          <h2>Stornieren</h2>
          {b.terms.enabled && <p>{b.terms.text}</p>}
          {b.canCancel ? (
            ask ? (
              <>
                <p className={`notice ${b.terms.free ? '' : 'warn'}`}>{b.terms.free
                  ? 'Die Stornierung ist jetzt kostenfrei. Möchten Sie die Reservierung wirklich stornieren?'
                  : <>Die Frist für die kostenfreie Stornierung ist abgelaufen. Bei Stornierung berechnen wir <b>{formatMoney(b.terms.feeCents)}</b> ({b.terms.feePercent} % des Zimmerpreises). Möchten Sie trotzdem stornieren?</>}</p>
                {fail && <p className="notice danger" role="alert">{fail}</p>}
                <div className="formactions"><Button variant="danger" busy={busy} onClick={() => void cancel()}>Ja, verbindlich stornieren</Button><Button onClick={() => setAsk(false)}>Nein, behalten</Button></div>
              </>
            ) : <div className="formactions"><Button variant="danger" onClick={() => setAsk(true)}>Reservierung stornieren</Button></div>
          ) : <p className="muted">{b.cancelHint}</p>}
        </section>
      )}
      {(b.state === 'arrived' || b.state === 'past') && <p className="notice">{b.state === 'arrived' ? 'Sie sind bereits angereist – schön, dass Sie da sind.' : 'Dieser Aufenthalt liegt in der Vergangenheit. Vielen Dank für Ihren Besuch.'}</p>}
    </div>
  );
}
