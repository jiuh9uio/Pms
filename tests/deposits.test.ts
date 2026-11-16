import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

/** Anzahlung anfordern – Hotel und Restaurant. */
const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
let user: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();
const GUEST = { salutation: 'Frau', firstName: 'Erika', lastName: 'Pruefung', company: '', email: '', phone: '', street: 'Weg 1', zip: '12345', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: 'X123', notes: '' };
let roomIds: string[] = [];

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 2, firstNumber: 101, floor: '1' });
  roomIds = (await ok('GET', '/rooms', admin)).map((r: { id: string }) => r.id);
});
afterAll(async () => { await app.close(); await close(); });

describe('Anzahlung anfordern', () => {
  it('Hotel: Entwurf, Vermerk ohne E-Mail, Zahlung durch Mitarbeiter, Stand und Aufgabe bei Überfälligkeit', async () => {
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, iban: 'DE00 1234 5678 9012 3456 78', bankName: 'Testbank' });
    const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, email: 'gast@example.org' }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[0], from: addDays(today, 30), to: addDays(today, 33), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const d = await ok('GET', `/bookings/${b.id}/deposits/draft?amountCents=9000&dueDate=${addDays(today, 7)}`, user);
    expect(d.to).toBe('gast@example.org');
    expect(d.text).toMatch(/Anzahlung von 90,00\s€/);
    expect(d.text).toMatch(/IBAN: DE00 1234/);
    // Versand ohne eingerichtetes Postfach: nichts vermerkt
    const fail = await call('POST', `/bookings/${b.id}/deposits`, user, { amountCents: 9000, dueDate: addDays(today, 7), send: true, to: d.to, subject: d.subject, text: d.text });
    expect(fail.statusCode).toBe(409);
    expect(await ok('GET', `/bookings/${b.id}/deposits`, user)).toHaveLength(0);
    expect((await call('POST', `/bookings/${b.id}/deposits`, user, { amountCents: 9000, dueDate: addDays(today, -1), send: false })).statusCode).toBe(400);
    await ok('POST', `/bookings/${b.id}/deposits`, user, { amountCents: 9000, dueDate: addDays(today, 7), send: false });
    let list = await ok('GET', `/bookings/${b.id}/deposits`, user);
    expect(list).toMatchObject([{ amountCents: 9000, state: 'open', mailed: false }]);
    // Mitarbeiter darf genau die angeforderte Anzahlung buchen, aber keinen anderen Teilbetrag
    const pay = (c: number) => call('POST', '/payments', user, { bookingId: b.id, amountCents: c, method: 'Überweisung', date: today, payer: '', note: '' });
    expect((await pay(5000)).json().error.code).toBe('partial');
    expect((await pay(9000)).statusCode).toBe(200);
    list = await ok('GET', `/bookings/${b.id}/deposits`, user);
    expect(list[0].state).toBe('paid');
    // Überfällig → Aufgabe in der Übersicht
    await ok('POST', `/bookings/${b.id}/deposits`, user, { amountCents: 5000, dueDate: addDays(today, 3), send: false });
    await db.execute(sql`update settings set value = (select jsonb_agg(case when x->>'amountCents' = '5000' then jsonb_set(x, '{dueDate}', to_jsonb(${addDays(today, -2)}::text)) else x end) from jsonb_array_elements(value) x) where key = 'deposit_requests'`);
    const dash = await ok('GET', '/dashboard', user);
    expect(dash.tasks.some((t: { kind: string; bookingId: string }) => t.kind === 'deposit' && t.bookingId === b.id)).toBe(true);
    list = await ok('GET', `/bookings/${b.id}/deposits`, user);
    expect(list.map((x: { state: string }) => x.state)).toEqual(['paid', 'overdue']);
    await ok('POST', `/deposits/${list[1].id}/cancel`, user);
    expect((await ok('GET', '/dashboard', user)).tasks.some((t: { kind: string }) => t.kind === 'deposit')).toBe(false);
  });

  it('Restaurant: anfordern, Eingang vermerken, zurückziehen', async () => {
    const r = await ok('POST', '/restaurant/reservations', user, { date: addDays(today, 14), time: '19:00', durationMin: 180, persons: 25, name: 'Geburtstag Muster', phone: '', note: '', tableId: null });
    const d = await ok('GET', `/restaurant/reservations/${r.id}/deposits/draft?amountCents=20000&dueDate=${addDays(today, 7)}`, user);
    expect(d.text).toMatch(/Tischreservierung am .* um 19:00 Uhr für 25 Personen/);
    await ok('POST', `/restaurant/reservations/${r.id}/deposits`, user, { amountCents: 20000, dueDate: addDays(today, 7), send: false });
    let list = await ok('GET', `/restaurant/reservations/${r.id}/deposits`, user);
    expect(list[0].state).toBe('open');
    expect((await ok('GET', `/restaurant/deposits?date=${addDays(today, 14)}`, user))).toHaveLength(1);
    await ok('POST', `/restaurant/deposits/${list[0].id}/paid`, user, { note: 'bar, Kassenbon 4711' });
    list = await ok('GET', `/restaurant/reservations/${r.id}/deposits`, user);
    expect(list[0]).toMatchObject({ state: 'paid', paidBy: 'Rezeption', paidNote: 'bar, Kassenbon 4711' });
    expect((await call('POST', `/restaurant/deposits/${list[0].id}/cancel`, user)).statusCode).toBe(409);
    expect((await call('POST', `/deposits/${list[0].id}/paid`, user)).statusCode).toBe(404);
  });
});
