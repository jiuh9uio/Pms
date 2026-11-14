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

describe('Hotel: Optionsfrist, Vorschau, Statistik, doppelte Gäste', () => {
  const mk = async (g: object, from: string, to: string, extra: object = {}, status = 'confirmed') => (await ok('POST', '/bookings', user, {
    guest: { ...GUEST, ...g }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: roomIds[0], from, to, adults: 2, children: 0, status, pricePerNightCents: null }], ...extra })).id as string;

  it('zeigt abgelaufene Optionen als Aufgabe, bis bestätigt oder storniert wird', async () => {
    const id = await mk({ lastName: 'Option' }, addDays(today, 20), addDays(today, 22), { optionUntil: addDays(today, -1) }, 'tentative');
    const fixed = await mk({ lastName: 'Fest' }, addDays(today, 30), addDays(today, 31), { optionUntil: addDays(today, -1) }); // bestätigt: Frist wird nicht gespeichert
    expect((await ok('GET', `/bookings/${id}`, user)).optionUntil).toBe(addDays(today, -1));
    expect((await ok('GET', `/bookings/${fixed}`, user)).optionUntil).toBeNull();
    let tasks = (await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toContain('abgelaufen seit');
    expect(tasks[0].text).toContain('Option');
    // Frist verlängern: Aufgabe verschwindet
    const b = await ok('GET', `/bookings/${id}`, user);
    await ok('PATCH', `/bookings/${id}`, user, { optionUntil: addDays(today, 5), version: b.version });
    tasks = (await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option');
    expect(tasks).toHaveLength(0);
    await ok('PATCH', `/bookings/${id}`, user, { optionUntil: today, version: b.version + 1 });
    expect((await ok('GET', '/dashboard', user)).tasks.find((t: { kind: string }) => t.kind === 'option').text).toContain('läuft heute ab');
    // bestätigt: keine Aufgabe mehr
    const r = (await ok('GET', `/bookings/${id}`, user)).rooms[0];
    await ok('POST', `/booking-rooms/${r.id}/status`, user, { status: 'confirmed', version: r.version });
    expect((await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option')).toHaveLength(0);
  });

  it('rechnet die Belegungsvorschau je Tag und Kategorie', async () => {
    const f = await ok('GET', `/reports/forecast?from=${addDays(today, 19)}&days=5`, user);
    expect(f.rooms).toBe(1);
    expect(f.categories).toEqual([expect.objectContaining({ name: 'Doppelzimmer', rooms: 1 })]);
    expect(f.days.map((d: { occupied: number; free: number; arrivals: number; departures: number }) => [d.occupied, d.free, d.arrivals, d.departures]))
      .toEqual([[0, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 1], [0, 1, 0, 0]]);
    expect(f.days[1]).toMatchObject({ occupancyPercent: 100, freeByCategory: [0] });
    await ok('POST', '/blocks', user, { roomId: roomIds[0], from: addDays(today, 23), to: addDays(today, 24), reason: 'Maler' });
    const g = await ok('GET', `/reports/forecast?from=${addDays(today, 23)}&days=1`, user);
    expect(g.days[0]).toMatchObject({ blocked: 1, free: 0, occupied: 0 });
    expect((await call('GET', `/reports/forecast?from=${today}&days=500`, user)).statusCode).toBe(400);
  });

  it('zählt Ankünfte und Übernachtungen nach Herkunftsland und Umsatz nach Buchungsquelle', async () => {
    await mk({ lastName: 'Jansen', country: 'Niederlande' }, '2036-03-30', '2036-04-02', { source: 'Booking.com' }); // 2 Nächte im März, 1 im April, 2 Personen
    await mk({ lastName: 'Meier', country: '' }, '2036-03-10', '2036-03-11');
    const mar = await ok('GET', '/reports/origin?year=2036&month=3', user);
    expect(mar.rows).toEqual([{ country: 'Niederlande', arrivals: 2, nights: 4 }, { country: 'ohne Angabe', arrivals: 2, nights: 2 }]);
    expect(mar.total).toEqual({ arrivals: 4, nights: 6 });
    expect(mar).toMatchObject({ beds: 2, openDays: 31 });
    const apr = await ok('GET', '/reports/origin?year=2036&month=4', user);
    expect(apr.rows).toEqual([{ country: 'Niederlande', arrivals: 0, nights: 2 }]); // Ankunft zählt im März
    const src = await ok('GET', '/reports/sources?year=2036', user);
    expect(src.rows).toEqual([{ source: 'Booking.com', bookings: 1, nights: 3, lodgingCents: 29700 }, { source: 'Telefon', bookings: 1, nights: 1, lodgingCents: 9900 }]);
  });

  it('findet doppelte Gäste und führt sie zusammen – nur der Administrator', async () => {
    const a = await mk({ firstName: 'Doris', lastName: 'Doppelt', email: 'doris@example.com', phone: '' }, '2037-01-10', '2037-01-11');
    const b = await mk({ firstName: 'Doris', lastName: 'doppelt ', email: '', phone: '0171 999' }, '2037-02-10', '2037-02-11');
    await mk({ firstName: 'Doris', lastName: 'Doppelt', email: '', phone: '' }, '2037-03-10', '2037-03-11');
    expect((await call('GET', '/guests/duplicates', user)).statusCode).toBe(403);
    const dups = (await ok('GET', '/guests/duplicates', admin)).filter((d: { keep: { firstName: string } }) => d.keep.firstName === 'Doris');
    expect(dups.length).toBeGreaterThanOrEqual(2);
    expect(dups[0].reason).toBe('gleicher Name');
    const ga = (await ok('GET', `/bookings/${a}`, user)).guest, gb = (await ok('GET', `/bookings/${b}`, user)).guest;
    expect((await call('POST', `/guests/${ga.id}/merge`, user, { otherId: gb.id })).statusCode).toBe(403);
    expect((await call('POST', `/guests/${ga.id}/merge`, admin, { otherId: ga.id })).statusCode).toBe(409);
    expect(await ok('POST', `/guests/${ga.id}/merge`, admin, { otherId: gb.id })).toEqual({ ok: true, bookingsMoved: 1 });
    const merged = (await ok('GET', `/bookings/${b}`, user)).guest;
    expect(merged).toMatchObject({ id: ga.id, email: 'doris@example.com', phone: '0171 999' }); // leere Felder ergänzt
    expect((await call('GET', `/guests/${gb.id}`, user)).statusCode).toBe(404);
    expect((await ok('GET', `/guests/${ga.id}`, user)).bookings.length).toBe(2);
  });
});
