import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DepositCreateInput, DepositDto, DepositKind } from '../../shared/deposits.js';
import { formatMoney, isActiveStatus, todayBerlin, type MailDraft } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { settings, tableReservations } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking } from './bookings.js';
import { greeting, ready, signature } from './hotelmail.js';
import { sendMail } from './mail.js';
import { getHotel } from './settings.js';

/**
 * Anzahlungs-Anforderungen (Hotel und Restaurant). Gespeichert als Liste in den Einstellungen (kein neues Datenbankschema).
 * Hotel: „eingegangen“, sobald die Zahlungen der Reservierung die angeforderten Beträge (zusammengezählt) erreichen.
 * Restaurant: Eingang wird von Hand vermerkt – das Programm kassiert dort nicht.
 */
const KEY = 'deposit_requests';
interface Raw {
  id: string; kind: DepositKind; refId: string; amountCents: number; dueDate: string; createdAt: string; createdBy: string;
  to: string; mailed: boolean; status: 'open' | 'paid' | 'cancelled'; paidAt: string | null; paidBy: string; paidNote: string; cancelledBy: string;
}
async function loadAll(db: Exec, lock = false): Promise<Raw[]> {
  if (lock) {
    await db.insert(settings).values({ key: KEY, value: [] }).onConflictDoNothing();
    const [row] = await db.select().from(settings).where(eq(settings.key, KEY)).for('update');
    return (row?.value as Raw[]) ?? [];
  }
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return (row?.value as Raw[]) ?? [];
}
const save = (db: Exec, list: Raw[]) => db.update(settings).set({ value: list, updatedAt: new Date() }).where(eq(settings.key, KEY));
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

async function bookingPaid(db: Exec, bookingId: string) {
  const [r] = await db.execute(sql`select coalesce(sum(amount_cents), 0)::int as n from payments where booking_id = ${bookingId}`) as unknown as { n: number }[];
  return r!.n;
}
/** Zustand je Anforderung; beim Hotel aus den Zahlungen der Reservierung (älteste Anforderung zuerst gedeckt). */
async function withState(db: Exec, list: Raw[]): Promise<DepositDto[]> {
  const today = todayBerlin();
  const paidBy = new Map<string, number>();
  const out: DepositDto[] = [];
  const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const cum = new Map<string, number>();
  for (const r of sorted) {
    let state: DepositDto['state'];
    if (r.status === 'cancelled') state = 'cancelled';
    else if (r.kind === 'booking') {
      if (!paidBy.has(r.refId)) paidBy.set(r.refId, await bookingPaid(db, r.refId));
      const need = (cum.get(r.refId) ?? 0) + r.amountCents;
      cum.set(r.refId, need);
      state = paidBy.get(r.refId)! >= need ? 'paid' : r.dueDate < today ? 'overdue' : 'open';
    } else state = r.status === 'paid' ? 'paid' : r.dueDate < today ? 'overdue' : 'open';
    out.push({ id: r.id, kind: r.kind, refId: r.refId, amountCents: r.amountCents, dueDate: r.dueDate, createdAt: r.createdAt, createdBy: r.createdBy, to: r.to, mailed: r.mailed,
      state, paidAt: r.paidAt, paidBy: r.paidBy, paidNote: r.paidNote, cancelledBy: r.cancelledBy });
  }
  return out;
}

export async function listFor(db: Exec, kind: DepositKind, refId: string) {
  return withState(db, (await loadAll(db)).filter((r) => r.kind === kind && r.refId === refId));
}
/** Hotel: noch offener Teil der angeforderten Anzahlungen (für die Zahlungsregel der Mitarbeiter). */
export async function openBookingDeposit(db: Exec, bookingId: string) {
  const req = (await loadAll(db)).filter((r) => r.kind === 'booking' && r.refId === bookingId && r.status !== 'cancelled').reduce((s, r) => s + r.amountCents, 0);
  return Math.max(0, req - (await bookingPaid(db, bookingId)));
}
/** Überfällige Anzahlungen (Hotel und Restaurant) – für die Aufgaben in den Übersichten. */
export async function overdue(db: Exec, kind: DepositKind) {
  return (await withState(db, (await loadAll(db)).filter((r) => r.kind === kind))).filter((d) => d.state === 'overdue');
}
export async function forTables(db: Exec, ids: string[]) {
  const set = new Set(ids);
  return withState(db, (await loadAll(db)).filter((r) => r.kind === 'table' && set.has(r.refId) && r.status !== 'cancelled'));
}

async function subjectOf(db: Exec, kind: DepositKind, refId: string) {
  if (kind === 'booking') {
    const b = await getBooking(db, refId).catch(() => { throw notFound('Reservierung'); });
    const live = b.rooms.filter((r) => isActiveStatus(r.status));
    if (!live.length) throw conflict('Die Reservierung ist storniert – keine Anzahlung anfordern');
    const from = live.map((r) => r.from).sort()[0]!, to = live.map((r) => r.to).sort().at(-1)!;
    return { number: b.number, email: b.guest.email, greet: greeting(b.guest), what: `Ihre Reservierung Nr. ${b.number} vom ${de(from)} bis ${de(to)}`, total: b.totalCents, start: from };
  }
  const [t] = await db.select().from(tableReservations).where(eq(tableReservations.id, refId));
  if (!t) throw notFound('Tischreservierung');
  if (t.status === 'cancelled' || t.status === 'no_show') throw conflict('Die Tischreservierung ist nicht mehr aktiv');
  return { number: '', email: '', greet: `Guten Tag ${t.name},`, what: `Ihre Tischreservierung am ${de(t.date)} um ${t.time} Uhr für ${t.persons} ${t.persons === 1 ? 'Person' : 'Personen'}`, total: 0, start: t.date };
}

/** E-Mail-Vorschlag (vor dem Senden änderbar). */
export async function draft(db: Exec, kind: DepositKind, refId: string, amountCents: number, dueDate: string): Promise<MailDraft & { totalCents: number; start: string }> {
  const [s, h] = [await subjectOf(db, kind, refId), await getHotel(db)];
  const bank = h.iban ? ['', 'Bankverbindung:', `Kontoinhaber: ${h.name}`, ...(h.bankName ? [`Bank: ${h.bankName}`] : []), `IBAN: ${h.iban}`, ...(h.bic ? [`BIC: ${h.bic}`] : []),
    `Verwendungszweck: Anzahlung ${s.number || `Tischreservierung ${de(s.start)}`}`] : ['', 'Die Bankverbindung teilen wir Ihnen gern mit.'];
  const text = [s.greet, '', `vielen Dank für ${s.what}.`, '', `Wir bitten Sie um eine Anzahlung von ${formatMoney(amountCents)} bis zum ${de(dueDate)}.`, ...bank,
    '', 'Bei Fragen erreichen Sie uns gern telefonisch oder per E-Mail.', '', signature(h)].join('\n');
  return { to: s.email, subject: `Anzahlung ${s.number ? `zu Ihrer Reservierung ${s.number}` : 'zu Ihrer Tischreservierung'} – ${h.name}`, text, attachment: null, ready: await ready(db), totalCents: s.total, start: s.start };
}

export async function create(db: Db, actor: Actor, kind: DepositKind, refId: string, v: DepositCreateInput) {
  await subjectOf(db, kind, refId); // gibt es die Reservierung noch und ist sie aktiv?
  if (v.dueDate < todayBerlin()) throw new AppError(400, 'validation', 'Eingaben prüfen', { dueDate: 'Die Frist liegt in der Vergangenheit' });
  // zuerst senden: klappt der Versand nicht, wird nichts vermerkt
  if (v.send) await sendMail(db, actor, { to: v.to, subject: v.subject, text: v.text });
  return db.transaction(async (tx) => {
    const list = await loadAll(tx, true);
    const r: Raw = { id: randomUUID(), kind, refId, amountCents: v.amountCents, dueDate: v.dueDate, createdAt: new Date().toISOString(), createdBy: actor.userName,
      to: v.send ? v.to : '', mailed: v.send, status: 'open', paidAt: null, paidBy: '', paidNote: '', cancelledBy: '' };
    await save(tx, [...list, r].slice(-5000));
    await record(tx, actor, { action: 'deposit_request', entity: kind === 'booking' ? 'booking' : 'table_reservation', entityId: refId, after: { amountCents: v.amountCents, dueDate: v.dueDate, mailed: v.send, to: r.to } });
    return { id: r.id };
  });
}

async function change(db: Db, actor: Actor, id: string, fn: (r: Raw) => void, action: string) {
  return db.transaction(async (tx) => {
    const list = await loadAll(tx, true);
    const r = list.find((x) => x.id === id);
    if (!r) throw notFound('Anzahlung');
    fn(r);
    await save(tx, list);
    await record(tx, actor, { action, entity: r.kind === 'booking' ? 'booking' : 'table_reservation', entityId: r.refId, after: { amountCents: r.amountCents, note: r.paidNote } });
    return { ok: true };
  });
}
/** Restaurant: Eingang von Hand vermerken (die Buchung in der Kasse erfolgt dort). */
export const markPaid = (db: Db, actor: Actor, id: string, note: string) => change(db, actor, id, (r) => {
  if (r.kind !== 'table') throw conflict('Bei Hotelreservierungen wird die Anzahlung als Zahlung in der Reservierung gebucht.');
  if (r.status !== 'open') throw conflict('Diese Anzahlung ist nicht mehr offen.');
  r.status = 'paid'; r.paidAt = new Date().toISOString(); r.paidBy = actor.userName; r.paidNote = note;
}, 'deposit_paid');
export async function cancel(db: Db, actor: Actor, id: string) {
  const all = await withState(db, await loadAll(db));
  if (all.find((d) => d.id === id)?.state === 'paid') throw conflict('Bereits eingegangen – nicht mehr zurückziehbar.');
  return cancelRaw(db, actor, id);
}
const cancelRaw = (db: Db, actor: Actor, id: string) => change(db, actor, id, (r) => {
  if (r.status === 'cancelled') throw conflict('Bereits zurückgezogen.');
  if (r.status === 'paid') throw conflict('Bereits eingegangen – nicht mehr zurückziehbar.');
  r.status = 'cancelled'; r.cancelledBy = actor.userName;
}, 'deposit_cancel');
