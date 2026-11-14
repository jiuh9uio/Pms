import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
let user: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();
const GUEST = { salutation: 'Herr', firstName: 'Max', lastName: 'Mustermann', company: '', email: '', phone: '', street: 'Weg 1', zip: '11111', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
let roomIds: string[];
let breakfastId: string;
let n = 0;
/** Neue Reservierung über zwei Nächte (2 × 99 €), auf Wunsch mit Frühstück (2 Pers. × 2 Nächte × 12 € = 48 €). */
async function bookingAt(from: string, to: string) {
  const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: `Gast${n++}` }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: roomIds[0], from, to, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
  return b.id as string;
}
async function booking(breakfast = false) {
  const i = n++;
  const from = `2032-0${1 + Math.floor(i / 9)}-${String(1 + (i % 9) * 3).padStart(2, '0')}`;
  const to = `${from.slice(0, 8)}${String(Number(from.slice(8)) + 2).padStart(2, '0')}`;
  const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: `Mustermann${i}` }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast,
    rooms: [{ roomId: roomIds[0], from, to, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
  return b.id as string;
}
const issue = async (bookingId: string, include = 'all') => {
  const { id } = await ok('POST', '/invoices', user, { bookingId, include });
  const d = await ok('GET', `/invoices/${id}`, user);
  return ok('POST', `/invoices/${id}/issue`, user, { version: d.version });
};
const pay = (body: object) => call('POST', '/payments', user, { date: today, payer: '', note: '', ...body });
const billing = (bookingId: string) => ok('GET', `/bookings/${bookingId}/billing`, user);

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  const hotel = await ok('GET', '/settings/hotel', admin);
  await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890', iban: 'DE00 1234 5678 9012 3456 78' });
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 101, floor: '1' });
  roomIds = (await ok('GET', '/rooms', admin)).map((r: { id: string }) => r.id);
  const tax = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
  breakfastId = (await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax.id, isBreakfast: true, active: true })).id;
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Hotel-Daten löschen', () => {
  const base = { billing: false, bookings: 'none', guests: false, resetNumbers: false, dryRun: false, password: 'sehr-geheim-123', confirm: 'LÖSCHEN' };
  const purge = (body: object, who = admin) => call('POST', '/settings/purge', who, { ...base, ...body });
  const n = async (table: string) => Number((await db.execute(sql.raw(`select count(*)::int as n from ${table}`)))[0]!.n);
  let pastPaid: string, pastPlain: string, future: string;

  it('zählt in der Vorschau nur und verlangt für den echten Lauf Administrator, Passwort und Bestätigung', async () => {
    pastPaid = await bookingAt(addDays(today, -10), addDays(today, -8));
    pastPlain = await bookingAt(addDays(today, -6), addDays(today, -4));
    future = await bookingAt(addDays(today, 20), addDays(today, 22));
    await issue(pastPaid);
    expect((await pay({ bookingId: pastPaid, amountCents: 19800, method: 'Bar', givenCents: 20000 })).statusCode).toBe(200);
    await ok('POST', '/blocks', user, { roomId: roomIds[0], from: addDays(today, -3), to: addDays(today, -2), reason: 'alt' });
    await ok('POST', '/blocks', user, { roomId: roomIds[0], from: addDays(today, 30), to: addDays(today, 31), reason: 'neu' });

    expect((await purge({ billing: true }, user)).statusCode).toBe(403);
    expect((await purge({})).statusCode).toBe(400); // nichts gewählt
    expect((await purge({ billing: true, password: 'falsch' })).statusCode).toBe(400);
    expect((await purge({ billing: true, confirm: 'ja' })).statusCode).toBe(400);
    const preview = (await purge({ billing: true, bookings: 'past', dryRun: true, password: '', confirm: '' })).json();
    expect(preview).toMatchObject({ dryRun: true, invoices: 1, payments: 1, bookings: 2, keptBookings: 0, blocks: 1 });
    expect(await n('invoices')).toBe(1); // nichts gelöscht
    expect(await n('bookings')).toBe(3);
  });

  it('lässt vergangene Buchungen mit Rechnung stehen, solange Rechnungen nicht mit gelöscht werden', async () => {
    const r = (await purge({ bookings: 'past' })).json();
    expect(r).toMatchObject({ bookings: 1, keptBookings: 1, blocks: 1, invoices: 0 });
    await ok('GET', `/bookings/${pastPaid}`, user);
    expect((await call('GET', `/bookings/${pastPlain}`, user)).statusCode).toBe(404);
    await ok('GET', `/bookings/${future}`, user);
    expect(await n('room_allocations')).toBe(3); // bezahlte alte Buchung, künftige Buchung, künftige Sperre
  });

  it('löscht Rechnungen, Zahlungen und vergangene Buchungen – der Schutz gilt danach wieder', async () => {
    const r = (await purge({ billing: true, bookings: 'past', guests: true, resetNumbers: true })).json();
    expect(r).toMatchObject({ invoices: 1, payments: 1, bookings: 1, keptBookings: 0, guests: 2 });
    for (const t of ['invoices', 'invoice_lines', 'invoice_documents', 'payments']) expect(await n(t), t).toBe(0);
    await ok('GET', `/bookings/${future}`, user);
    expect(await n('guests')).toBe(1);
    // neue Rechnung: Nummer beginnt wieder bei 1 und ist wieder unveränderbar
    const inv = await issue(future);
    expect(inv.number).toMatch(/-0001$/);
    await expect(db.execute(sql`delete from invoices`)).rejects.toThrow();
    await expect(db.execute(sql`update payments set amount_cents = 1`)).resolves.toBeDefined();
    const log = await db.execute(sql`select count(*)::int as n from audit_log where action = 'purge'`);
    expect(Number(log[0]!.n)).toBe(2);
  });

  it('löscht auf Wunsch alle Buchungen und Sperren', async () => {
    const r = (await purge({ billing: true, bookings: 'all', guests: true })).json();
    expect(r).toMatchObject({ bookings: 1, blocks: 1, guests: 1 });
    for (const t of ['bookings', 'booking_rooms', 'room_allocations', 'guests', 'invoices']) expect(await n(t), t).toBe(0);
    expect(await n('rooms')).toBe(1); // Zimmer und Preise bleiben
  });
});
