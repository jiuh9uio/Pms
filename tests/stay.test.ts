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
const CRED = { lastName: 'Aufenthalt', zip: '12345' };
let token = '', bookingId = '', roomId = '';

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
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 111, floor: '1' });
  roomId = (await ok('GET', '/rooms', admin))[0].id;
  const b = await ok('POST', '/bookings', user, { guest: { salutation: 'Frau', firstName: 'Erika', lastName: 'Aufenthalt', company: '', email: '', phone: '', street: 'Weg 1', zip: '12345', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' },
    groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId, from: today, to: addDays(today, 2), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
  bookingId = b.id;
  token = new URL((await ok('GET', `/bookings/${bookingId}/guest-link`, user)).url).pathname.split('/')[2]!;
});
afterAll(async () => { await app.close(); await close(); });

const req = (kind: string, message = '', cred: object = CRED) => call('POST', `/public/booking/${token}/request`, {}, { ...cred, kind, message });
const tasks = async () => (await db.execute(sql`select kind, text, place, status from team_notes order by created_at`)) as unknown as { kind: string; text: string; place: string }[];

describe('Gäste-Link während des Aufenthalts', () => {
  it('vor dem Check-in: nicht möglich; Seite bietet es nicht an', async () => {
    const b = await ok('POST', `/public/booking/${token}/open`, {}, CRED);
    expect(b.canRequest).toBe(false);
    expect((await req('cleaning')).statusCode).toBe(409);
  });

  it('eingecheckt: Reinigung wünschen → Aufgabe im Übergabebuch und Zimmer „zu reinigen“; doppelt gesendet wird abgefangen', async () => {
    await db.execute(sql`update booking_rooms set status = 'checked_in', checked_in_at = now() where booking_id = ${bookingId}`);
    await db.execute(sql`update rooms set housekeeping = 'clean'`);
    expect((await ok('POST', `/public/booking/${token}/open`, {}, CRED)).canRequest).toBe(true);
    expect((await req('cleaning', '', { lastName: 'Falsch', zip: '12345' })).statusCode).toBe(403);
    const r = await req('cleaning', 'bitte ab 14 Uhr');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().text).toMatch(/reinigen/);
    const t = (await tasks()).at(-1)!;
    expect(t).toMatchObject({ kind: 'task', place: 'Zimmer 111' });
    expect(t.text).toMatch(/Zimmerreinigung gewünscht.*bitte ab 14 Uhr/);
    expect((await db.execute(sql`select housekeeping from rooms`))[0]!.housekeeping).toBe('dirty');
    expect((await req('cleaning')).statusCode).toBe(429);
    const hist = await ok('GET', `/bookings/${bookingId}/history`, user);
    expect(hist.some((h: { action: string }) => h.action === 'guest_request')).toBe(true);
  });

  it('Wunsch braucht einen Text; keine Reinigung ist eine Notiz', async () => {
    expect((await req('need', '')).statusCode).toBe(400);
    expect((await req('need', 'Zwei Handtücher')).statusCode).toBe(200);
    expect((await tasks()).at(-1)!.text).toMatch(/Wunsch des Gastes.*Zwei Handtücher/);
    expect((await req('no_cleaning')).statusCode).toBe(200);
    expect((await tasks()).at(-1)!.kind).toBe('note');
    expect((await req('other')).statusCode).toBe(400);
  });

  it('Abreise melden checkt NICHT aus – nur Aufgabe für das Personal', async () => {
    expect((await req('checkout', 'Schlüssel liegt im Zimmer')).statusCode).toBe(200);
    expect((await db.execute(sql`select status from booking_rooms where booking_id = ${bookingId}`))[0]!.status).toBe('checked_in');
    expect((await tasks()).at(-1)!.text).toMatch(/Gast meldet Abreise.*Schlüssel liegt im Zimmer.*Bezahlung und Check-out prüfen/);
  });

  it('Meldeschein-Einstellung: Gäste-Link standardmäßig aus, einschaltbar', async () => {
    const s = await ok('GET', '/settings/checkin-sheet', admin);
    expect(s.showGuestLink).toBe(false);
    const saved = await ok('PUT', '/settings/checkin-sheet', admin, { ...s, showGuestLink: true, guestLinkText: 'Scannen und loslegen' });
    expect(saved).toMatchObject({ showGuestLink: true, guestLinkText: 'Scannen und loslegen' });
    expect((await ok('GET', '/checkin-sheet', user)).showGuestLink).toBe(true);
  });
});

describe('Stammgast-Hinweis in der Reservierung', () => {
  it('zählt nur frühere, abgereiste Aufenthalte anderer Reservierungen', async () => {
    const first = await ok('GET', `/bookings/${bookingId}`, user);
    expect(first.earlierStays).toEqual({ count: 0, last: null });
    await db.execute(sql`update booking_rooms set status = 'checked_out', checked_out_at = '2025-03-10T09:00:00Z' where booking_id = ${bookingId}`);
    const again = await ok('POST', '/bookings', user, { guestId: first.guest.id, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId, from: addDays(today, 30), to: addDays(today, 31), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const second = await ok('GET', `/bookings/${again.id}`, user);
    expect(second.earlierStays).toEqual({ count: 1, last: '2025-03-10' });
    // die erste Reservierung zählt sich selbst nicht
    expect((await ok('GET', `/bookings/${bookingId}`, user)).earlierStays.count).toBe(0);
  });
});
