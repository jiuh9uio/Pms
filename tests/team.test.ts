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
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
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

describe('Team, Reinigungsliste und Tagesabschluss', () => {
  it('führt Übergaben, Aufgaben und Reparaturen mit Lesebestätigung', async () => {
    expect((await call('GET', '/team/notes', {})).statusCode).toBe(401);
    expect((await call('POST', '/team/notes', user, { kind: 'note', text: '' })).statusCode).toBe(400);
    const note = (await ok('POST', '/team/notes', user, { kind: 'note', text: 'Schlüssel 12 liegt an der Rezeption', place: '', dueDate: '' })).id;
    const repair = (await ok('POST', '/team/notes', user, { kind: 'repair', text: 'Dusche tropft', place: 'Zimmer 101', dueDate: addDays(today, -1) })).id;
    // der Verfasser hat seine Einträge „gelesen“, die Chefin noch nicht
    expect(await ok('GET', '/team/state', user)).toEqual({ unread: 0, openTasks: 1 });
    expect(await ok('GET', '/team/state', admin)).toEqual({ unread: 2, openTasks: 1 });
    await ok('POST', `/team/notes/${note}/read`, admin, {});
    await ok('POST', `/team/notes/${note}/read`, admin, {}); // doppelt schadet nicht
    expect((await ok('GET', '/team/state', admin)).unread).toBe(1);
    const mine = await ok('GET', '/team/notes', user);
    expect(mine.find((n: { id: string }) => n.id === note)).toMatchObject({ readBy: ['Chefin'], mine: true, readByMe: true, createdBy: 'Rezeption' });
    expect(mine.find((n: { id: string }) => n.id === repair)).toMatchObject({ overdue: true, place: 'Zimmer 101', kind: 'repair' });
    expect(await ok('GET', '/team/notes?view=repair', admin)).toHaveLength(1);
    await ok('POST', `/team/notes/${repair}/done`, admin, { done: true, note: 'Dichtung getauscht' });
    expect(await ok('GET', '/team/notes?view=repair', admin)).toHaveLength(0);
    expect((await ok('GET', '/team/notes?view=done', user))[0]).toMatchObject({ doneBy: 'Chefin', doneNote: 'Dichtung getauscht', status: 'done' });
    await ok('POST', `/team/notes/${repair}/done`, user, { done: false });
    expect(await ok('GET', '/team/state', user)).toEqual({ unread: 0, openTasks: 1 });
  });

  it('zeigt in der Reinigungsliste Abreise, Bleiber und Anreise je Zimmer', async () => {
    const stay = await bookingAt(addDays(today, -1), addDays(today, 2));
    expect(stay).toBeTruthy();
    let list = await ok('GET', `/housekeeping?date=${today}`, user);
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ room: '101', staying: true, departing: false, arriving: false, persons: 2 });
    expect(list.total).toMatchObject({ stays: 1, departures: 0, arrivals: 0 });
    list = await ok('GET', `/housekeeping?date=${addDays(today, 2)}`, user);
    expect(list.rows[0]).toMatchObject({ departing: true, staying: false });
    await bookingAt(addDays(today, 2), addDays(today, 3));
    list = await ok('GET', `/housekeeping?date=${addDays(today, 2)}`, user);
    expect(list.rows[0]).toMatchObject({ departing: true, arriving: true, nextPersons: 2 }); // Wechsel am selben Tag
    await ok('POST', `/rooms/${roomIds[0]}/housekeeping`, user, { status: 'dirty' });
    expect((await ok('GET', `/housekeeping?date=${today}`, user)).total.dirty).toBe(1);
  });

  it('fasst im Tagesabschluss Zahlungen, Rechnungen sowie offene An- und Abreisen zusammen', async () => {
    const empty = await ok('GET', `/reports/day?date=${addDays(today, 40)}`, user);
    expect(empty).toMatchObject({ totalCents: 0, payments: [], invoices: { count: 0 }, arrivals: { expected: 0 } });
    // Buchung von gestern bis übermorgen: abrechnen, bar und mit Karte zahlen
    const list = await ok('GET', `/housekeeping?date=${today}`, user);
    expect(list.rows[0].staying).toBe(true);
    const id = (await db.execute(sql`select b.id from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id where lower(a.period) = ${addDays(today, -1)}::date`))[0]!.id as string;
    await issue(id);
    expect((await pay({ bookingId: id, amountCents: 10000, method: 'Bar', givenCents: 10000 })).statusCode).toBe(200);
    expect((await pay({ bookingId: id, amountCents: 5000, method: 'Karte' })).statusCode).toBe(200);
    const r = await ok('GET', `/reports/day?date=${today}`, user);
    expect(r.payments).toEqual([{ method: 'Bar', count: 1, cents: 10000 }, { method: 'Karte', count: 1, cents: 5000 }]);
    expect(r).toMatchObject({ totalCents: 15000, cashCents: 10000, invoices: { count: 1, cancelled: 0 }, occupied: 1, rooms: 1 });
    expect(r.paymentList).toHaveLength(2);
    expect(r.paymentList[0]).toMatchObject({ method: 'Bar', cents: 10000, by: 'Rezeption', reversal: false });
    // Anreise in zwei Tagen ist an dem Tag noch offen, die Abreise der laufenden Buchung ebenfalls (noch nicht ausgecheckt gilt nur für Eingecheckte)
    const d2 = await ok('GET', `/reports/day?date=${addDays(today, 2)}`, user);
    expect(d2.arrivals).toMatchObject({ expected: 1, checkedIn: 0 });
    expect(d2.arrivals.open[0]).toMatchObject({ room: '101' });
    expect(d2.departures.expected).toBe(1);
  });

  it('legt wiederkehrende Aufgaben am fälligen Tag einmal an', async () => {
    const { recurringTick } = await import('../src/server/modules/team.js');
    expect((await call('POST', '/team/recurring', user, { text: 'x', place: '', repeat: 'daily', day: 0 })).statusCode).toBe(403);
    expect((await call('POST', '/team/recurring', admin, { text: 'x', place: '', repeat: 'monthly', day: 0 })).statusCode).toBe(400);
    const open = async () => (await ok('GET', '/team/notes?view=task', user)).filter((n: { createdBy: string }) => n.createdBy === 'Automatisch');
    const daily = (await ok('POST', '/team/recurring', admin, { text: 'Kühlhaus-Temperatur prüfen', place: 'Küche', repeat: 'daily', day: 0 })).id;
    expect(await open()).toHaveLength(1); // gleich beim Anlegen für heute
    expect((await open())[0]).toMatchObject({ text: 'Kühlhaus-Temperatur prüfen', place: 'Küche', dueDate: today, kind: 'task' });
    expect(await recurringTick(db)).toBe(0); // nicht doppelt
    expect(await recurringTick(db, addDays(today, 1))).toBe(1);
    const monday = addDays('2035-01-01', 0); // 1. Januar 2035 ist ein Montag
    await ok('POST', '/team/recurring', admin, { text: 'Getränke bestellen', place: '', repeat: 'weekly', day: 1 });
    await ok('POST', '/team/recurring', admin, { text: 'Feuerlöscher sichten', place: '', repeat: 'monthly', day: 15 });
    expect(await recurringTick(db, monday)).toBe(2); // täglich + montags
    expect(await recurringTick(db, addDays(monday, 1))).toBe(1); // nur täglich
    expect(await recurringTick(db, '2035-01-15')).toBe(3); // Montag, der 15.: alle drei
    expect(await ok('GET', '/team/recurring', user)).toHaveLength(3);
    await ok('DELETE', `/team/recurring/${daily}`, admin);
    expect(await recurringTick(db, '2035-01-17')).toBe(0);
  });
});
