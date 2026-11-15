import { and, eq, inArray } from 'drizzle-orm';
import { isActiveStatus } from '../../shared/hotel.js';
import type { AccountingSlipDto } from '../../shared/billing.js';
import type { Db, Exec } from '../db/client.js';
import { payments } from '../db/schema.js';
import { columns, wrap, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { bookingBilling, getInvoice } from './billing.js';
import { getBooking } from './bookings.js';
import { printLines } from './quickprint.js';
import { getHotel } from './settings.js';

/**
 * Zettel für die Buchhaltung: Zahlungen (Art, Betrag, ggf. gegeben/Rückgeld, TSE-Nr.), Rechnungen mit Steueraufteilung,
 * Summen und offener Betrag einer Reservierung. Ein interner Vermerk zum Abheften – kein Kassenbeleg und keine Rechnung.
 */
export async function accountingSlip(db: Exec, actor: Actor, bookingId: string, paymentId: string | null): Promise<AccountingSlipDto> {
  const [b, bill, h] = await Promise.all([getBooking(db, bookingId), bookingBilling(db, bookingId), getHotel(db)]);
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  const total = rooms.reduce((s, r) => s + r.lodgingCents, 0) + b.chargesCents;
  // eine Zahlung angegeben: alle Teilbuchungen desselben Vorgangs (in einem Schritt gebucht, also mit demselben Zeitpunkt)
  const anchor = paymentId ? bill.payments.find((p) => p.id === paymentId) : null;
  const chosen = anchor ? bill.payments.filter((p) => p.createdAt === anchor.createdAt) : bill.payments;
  const given = new Map<string, number | null>();
  if (chosen.length) for (const r of await db.select({ id: payments.id, given: payments.givenCents }).from(payments).where(and(eq(payments.bookingId, bookingId), inArray(payments.id, chosen.map((p) => p.id))))) given.set(r.id, r.given);
  const byMethod = new Map<string, number>();
  for (const p of chosen) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
  const invoices = await Promise.all(bill.invoices.filter((i) => i.status !== 'draft').map(async (i) => {
    const full = await getInvoice(db, i.id);
    return { number: i.number ?? '', kind: i.kind, issueDate: i.issueDate, grossCents: i.grossCents, status: i.status, taxes: full.taxes.map((t) => ({ rate: t.rate, netCents: t.netCents, taxCents: t.taxCents, grossCents: t.grossCents })) };
  }));
  return {
    hotelName: h.name, createdAt: new Date().toISOString(), createdBy: actor.userName,
    booking: {
      number: b.number, guest: [b.guest.firstName, b.guest.lastName].filter(Boolean).join(' '), company: b.companyName ?? '',
      from: rooms.map((r) => r.from).sort()[0] ?? null, to: rooms.map((r) => r.to).sort().at(-1) ?? null, rooms: rooms.map((r) => r.roomNumber).join(', '),
    },
    onlyRecent: !!anchor,
    payments: chosen.map((p) => ({
      date: p.date, method: p.method, amountCents: p.amountCents, givenCents: given.get(p.id) ?? null, invoiceNumber: p.invoiceNumber, recordedBy: p.recordedBy, createdAt: p.createdAt,
      tse: p.tse?.status === 'signed' && p.tse.transactionNumber != null ? `TSE-Vorgang ${p.tse.transactionNumber}` : p.tse?.status === 'failed' ? 'TSE: nicht signiert' : null,
      reversal: !!p.reversesId || p.amountCents < 0,
    })),
    byMethod: [...byMethod.entries()].map(([method, amountCents]) => ({ method, amountCents })),
    paymentsTotalCents: chosen.reduce((s, p) => s + p.amountCents, 0),
    invoices, totalCents: total, paidCents: bill.paidCents, openCents: Math.max(0, total - bill.paidCents),
  };
}

const euro = (c: number) => `${(c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`;
const deDay = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '–');
const deTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Derselbe Zettel auf dem Bondrucker. */
export async function printAccountingSlip(db: Db, actor: Actor, bookingId: string, paymentId: string | null) {
  const s = await accountingSlip(db, actor, bookingId, paymentId);
  const center = (t: string, w: number, o: { bold?: boolean; big?: boolean } = {}): Line[] => wrap(t, o.big ? Math.floor(w / 2) : w).map((x) => ({ text: x, align: 'center' as const, ...o }));
  await printLines(db, (w) => [
    ...center(s.hotelName, w, { bold: true }), { rule: true },
    ...center('ZAHLUNG – FÜR DIE BUCHHALTUNG', w, { bold: true }), ...center('interner Zettel, kein Kassenbeleg', w), { rule: true },
    { text: columns('Reservierung', s.booking.number, w) }, ...wrap(s.booking.guest + (s.booking.company ? ` (${s.booking.company})` : ''), w).map((t) => ({ text: t, bold: true })),
    { text: columns('Aufenthalt', `${deDay(s.booking.from)} – ${deDay(s.booking.to)}`, w) }, { text: columns('Zimmer', s.booking.rooms, w) }, { rule: true },
    { text: s.onlyRecent ? 'Zahlung(en) dieses Vorgangs' : 'Alle Zahlungen', bold: true },
    ...(s.payments.length ? s.payments.flatMap((p): Line[] => [
      { text: columns(`${deDay(p.date)} ${p.method}${p.reversal ? ' (Korrektur)' : ''}`, euro(p.amountCents), w) },
      ...(p.givenCents != null && p.givenCents > p.amountCents ? [{ text: columns('  gegeben / Rückgeld', `${euro(p.givenCents)} / ${euro(p.givenCents - p.amountCents)}`, w) }] : []),
      ...(p.invoiceNumber ? [{ text: `  auf Rechnung ${p.invoiceNumber}` }] : []), ...(p.tse ? [{ text: `  ${p.tse}` }] : []),
    ]) : [{ text: '  keine' } as Line]),
    ...s.byMethod.map((m) => ({ text: columns(`Summe ${m.method}`, euro(m.amountCents), w), bold: true })), { rule: true },
    ...(s.invoices.length ? [{ text: 'Rechnungen', bold: true } as Line, ...s.invoices.flatMap((i): Line[] => [
      { text: columns(`${i.kind === 'cancellation' ? 'Storno ' : ''}${i.number} vom ${deDay(i.issueDate)}${i.status === 'cancelled' ? ' (storniert)' : ''}`, euro(i.grossCents), w) },
      ...i.taxes.map((t) => ({ text: columns(`  ${t.rate.toLocaleString('de-DE')} % MwSt auf ${euro(t.netCents)}`, euro(t.taxCents), w) })),
    ]), { rule: true } as Line] : [{ text: 'Noch keine Rechnung ausgestellt.' } as Line, { rule: true } as Line]),
    { text: columns('Gesamt Reservierung', euro(s.totalCents), w) }, { text: columns('Bezahlt', euro(s.paidCents), w) }, { text: columns('Offen', euro(s.openCents), w), bold: true },
    { rule: true }, { text: `Erstellt ${deTime(s.createdAt)} von ${s.createdBy}` }, { feed: 2 }, { text: '_'.repeat(w) }, { text: 'Geprüft / abgelegt' },
  ]);
  await record(db, actor, { action: 'print', entity: 'booking', entityId: bookingId, after: { zettel: 'Buchhaltung', bondrucker: true } });
  return { ok: true };
}
