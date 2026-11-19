import { useState } from 'react';
import { formatMoney, todayBerlin, type BookingListRow } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate, persons } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

type Req = { bookingId: string; number: string; guestName: string; phone: string; email: string; from: string; to: string; nights: number; optionUntil: string | null; notes: string; rooms: BookingListRow[]; lodgingCents: number };

/** Anfragen-Ordner: alle vorläufigen Reservierungen mit Telefon und E-Mail – zum Rückruf, für die Bestätigungs-E-Mail oder zum Zusagen. */
export function Requests() {
  const { rev, bump, newBooking, openBooking } = useData();
  const { data, error } = useLoad(() => api<BookingListRow[]>('GET', '/bookings?status=tentative'), [rev]);
  const [mail, setMail] = useState<Req | null>(null);
  const today = todayBerlin();
  const reqs: Req[] = [];
  for (const r of data ?? []) {
    let q = reqs.find((x) => x.bookingId === r.bookingId);
    if (!q) reqs.push(q = { bookingId: r.bookingId, number: r.number, guestName: r.guestName, phone: r.guestPhone, email: r.guestEmail, from: r.from, to: r.to, nights: r.nights, optionUntil: r.optionUntil, notes: r.notes, rooms: [], lodgingCents: 0 });
    q.rooms.push(r); q.lodgingCents += r.lodgingCents;
    if (r.from < q.from) q.from = r.from;
    if (r.to > q.to) q.to = r.to;
  }
  // zuerst die, deren Option abläuft
  reqs.sort((a, b) => (a.optionUntil ?? '9999').localeCompare(b.optionUntil ?? '9999') || a.from.localeCompare(b.from));
  return (
    <>
      <PageHeader title="Anfragen" sub="Vorgemerkte Zimmer – Anfrage öffnen, Gast anrufen, dann zusagen oder absagen"
        actions={<Button variant="primary" onClick={() => newBooking()}>Neue Anfrage oder Reservierung</Button>} />
      <LoadState error={error} loading={!data} />
      {data && reqs.length === 0 && <p className="muted">Zurzeit keine offenen Anfragen.</p>}
      <div className="reqlist">
        {reqs.map((q) => {
          const late = q.optionUntil != null && q.optionUntil < today;
          const due = q.optionUntil != null && q.optionUntil === today;
          return (
            <section key={q.bookingId} className={`card reqcard${late ? ' late' : due ? ' due' : ''}`}>
              <div className="reqhead">
                <div><b className="reqname">{q.guestName}</b> <small className="muted">{q.number}</small></div>
                {q.optionUntil && <span className={`reqopt${late ? ' late' : due ? ' due' : ''}`}>{late ? 'Option abgelaufen' : due ? 'Option endet heute' : 'Option bis'} {deDate(q.optionUntil)}</span>}
              </div>
              <p className="reqdates">{deDate(q.from)} – {deDate(q.to)} · {q.nights} {q.nights === 1 ? 'Nacht' : 'Nächte'} · Zimmer {q.rooms.map((r) => `${r.roomNumber} (${persons(r.adults, r.children)})`).join(', ')} · {formatMoney(q.lodgingCents)}</p>
              {q.notes && <p className="reqnotes">{q.notes}</p>}
              <div className="reqcontact">
                <Button variant="primary" onClick={() => openBooking(q.bookingId)}>Anfrage öffnen</Button>
                {q.phone && <a className="btn" href={`tel:${q.phone.replace(/[^\d+]/g, '')}`}>Anrufen: {q.phone}</a>}
                {q.email && <Button onClick={() => setMail(q)}>E-Mail „vorgemerkt“</Button>}
              </div>
            </section>
          );
        })}
      </div>
      {mail && <MailDialog path={`/bookings/${mail.bookingId}/mail`} title={`Bestätigung der Anfrage ${mail.number}`} onClose={() => setMail(null)} onSent={() => { setMail(null); bump(); }} />}
    </>
  );
}
