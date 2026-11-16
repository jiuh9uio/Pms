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
const GUEST = { salutation: '', firstName: 'Paul', lastName: 'Anrufer', company: '', email: '', phone: '0111 222', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' };
const today = todayBerlin();
let rooms: string[];

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
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 3, firstNumber: 101, floor: '1' });
  rooms = (await ok('GET', '/rooms', admin)).map((r: { id: string }) => r.id);
});
afterAll(async () => {
  await app.close();
  await close();
});

const book = (roomId: string, status: 'tentative' | 'confirmed', from: string, extra: object = {}) => ok('POST', '/bookings', user, {
  guest: GUEST, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false, ...extra,
  rooms: [{ roomId, from, to: addDays(from, 2), adults: 2, children: 0, status, pricePerNightCents: null }],
});

describe('Anfragen am Telefon (vorläufige Reservierungen)', () => {
  it('Einstellung „Zimmer freihalten (Tage)“: Vorgabe 3, änderbar, nur gültige Werte', async () => {
    const h = await ok('GET', '/settings/hotel', user);
    expect(h.requestOptionDays).toBe(3);
    expect((await call('PUT', '/settings/hotel', admin, { ...h, requestOptionDays: 99 })).statusCode).toBe(400);
    expect((await ok('PUT', '/settings/hotel', admin, { ...h, requestOptionDays: 5 })).requestOptionDays).toBe(5);
    expect((await call('PUT', '/settings/hotel', user, { ...h, requestOptionDays: 2 })).statusCode).toBe(403);
  });

  it('Übersicht zählt offene Anfragen unabhängig vom Anreisedatum; Liste zeigt Option und Notiz', async () => {
    expect((await ok('GET', '/dashboard', user)).openRequests).toBe(0);
    const far = addDays(today, 200);
    const a = await book(rooms[0]!, 'tentative', far, { optionUntil: addDays(today, 3), notes: 'ruft Freitag zurück' });
    await book(rooms[1]!, 'confirmed', far);
    const d = await ok('GET', '/dashboard', user);
    expect(d.openRequests).toBe(1);
    // weit in der Zukunft und Option noch nicht erreicht: (noch) keine Aufgabe, aber gezählt
    expect(d.tasks.some((t: { bookingId: string }) => t.bookingId === a.id)).toBe(false);
    const list = await ok('GET', '/bookings?status=tentative', user);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ bookingId: a.id, notes: 'ruft Freitag zurück', optionUntil: addDays(today, 3) });
    // Zimmer ist trotz Anfrage belegt: kein zweites Mal buchbar
    const free = await ok('GET', `/availability?from=${far}&to=${addDays(far, 2)}`, user);
    expect(free.map((r: { id: string }) => r.id)).toEqual([rooms[2]]);
  });

  it('nach dem Bestätigen ist die Anfrage nicht mehr offen', async () => {
    const [row] = await ok('GET', '/bookings?status=tentative', user);
    await ok('POST', `/booking-rooms/${row.id}/status`, user, { status: 'confirmed', version: row.version });
    expect((await ok('GET', '/dashboard', user)).openRequests).toBe(0);
  });
});
