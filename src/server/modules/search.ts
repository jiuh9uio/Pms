import { and, asc, gte, ilike } from 'drizzle-orm';
import { addDays, todayBerlin } from '../../shared/hotel.js';
import { hasModule, type Role, type SearchHit, type SearchResult } from '../../shared/schemas.js';
import type { Db } from '../db/client.js';
import { tableReservations } from '../db/schema.js';
import { listInvoices } from './billing.js';
import { listBookings } from './bookings.js';
import { listCompanies } from './companies.js';
import { listGuests } from './guests.js';

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Suche nach Gästen, Reservierungen, Rechnungen, Firmen und Tischreservierungen – nur in den Bereichen, die der Benutzer sehen darf. */
export async function search(db: Db, user: { role: Role; modules: string[] }, q: string): Promise<SearchResult> {
  const hits: SearchHit[] = [];
  if (hasModule(user, 'hotel')) {
    const [guests, bookings, invoices, companies] = await Promise.all([listGuests(db, q), listBookings(db, { q }), listInvoices(db, { q }), listCompanies(db, q)]);
    for (const g of guests.slice(0, 6)) hits.push({ kind: 'guest', id: g.id, title: [g.firstName, g.lastName].filter(Boolean).join(' '), sub: [g.company, g.city, g.email, g.phone].filter(Boolean).join(' · ') });
    const seen = new Set<string>();
    for (const b of bookings) {
      if (seen.has(b.bookingId) || seen.size >= 6) continue;
      seen.add(b.bookingId);
      hits.push({ kind: 'booking', id: b.bookingId, title: `Reservierung ${b.number} · ${b.guestName}`, sub: `${de(b.from)} – ${de(b.to)} · Zimmer ${b.roomNumber}${b.roomCount > 1 ? ` und ${b.roomCount - 1} weitere` : ''}` });
    }
    for (const i of invoices.slice(0, 6)) hits.push({ kind: 'invoice', id: i.id, title: `${i.kind === 'cancellation' ? 'Stornobeleg' : 'Rechnung'} ${i.number ?? '(Entwurf)'}`, sub: [i.recipientCompany || i.recipientName, i.issueDate ? de(i.issueDate) : ''].filter(Boolean).join(' · ') });
    for (const c of companies.slice(0, 5)) hits.push({ kind: 'company', id: c.id, title: c.name, sub: [c.city, c.email].filter(Boolean).join(' · ') });
  }
  if (hasModule(user, 'restaurant')) {
    const rows = await db.select().from(tableReservations)
      .where(and(ilike(tableReservations.name, `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`), gte(tableReservations.date, addDays(todayBerlin(), -1))))
      .orderBy(asc(tableReservations.date), asc(tableReservations.time)).limit(6);
    for (const r of rows) hits.push({ kind: 'table', id: r.date, title: `Tisch: ${r.name}`, sub: `${de(r.date)}, ${r.time} Uhr · ${r.persons} Personen` });
  }
  return { hits };
}
