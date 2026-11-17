import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';
import { purgeExpiredRegistrations } from '../src/server/modules/registrations.js';

/** Meldeschein-Angaben nach Ablauf der Aufbewahrungsfrist automatisch löschen. */
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

describe('Meldescheine automatisch löschen', () => {
  const stay = async (lastName: string, from: string, nights: number, room = 0) => {
    const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName, birthdate: '1970-05-05', nationality: 'deutsch', idNumber: 'AB123' }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[room], from, to: addDays(from, nights), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    return b.id as string;
  };
  const checkedOut = (id: string) => db.execute(sql`update booking_rooms set status = 'checked_out', checked_in_at = now(), checked_out_at = now() where booking_id = ${id}`);
  const guestOf = async (id: string) => (await ok('GET', `/bookings/${id}`, user)).guest;

  it('löscht Geburtsdatum, Staatsangehörigkeit und Ausweis nach einem Jahr – Name und Anschrift bleiben', async () => {
    const old = await stay('Altgast', addDays(today, -400), 2);
    await checkedOut(old);
    const recent = await stay('Neugast', addDays(today, -30), 2, 1);
    await checkedOut(recent);
    const g = await guestOf(old);
    // alter Protokolleintrag mit Meldeschein-Angaben
    await db.execute(sql`insert into audit_log (at, user_name, action, entity, entity_id, after) values (now() - interval '400 days', 'Test', 'update', 'guest', ${g.id}, ${JSON.stringify({ birthdate: '1970-05-05', idNumber: 'AB123' })}::jsonb)`);
    // ausgeschaltet: nichts passiert
    await ok('PUT', '/registrations/purge', admin, { enabled: false });
    expect((await purgeExpiredRegistrations(db)).guests).toBe(0);
    expect((await call('PUT', '/registrations/purge', user, { enabled: true })).statusCode).toBe(403);
    await ok('PUT', '/registrations/purge', admin, { enabled: true });
    expect((await purgeExpiredRegistrations(db)).guests).toBe(1);
    const after = await guestOf(old);
    expect(after).toMatchObject({ lastName: 'Altgast', street: 'Weg 1', birthdate: null, nationality: '', idNumber: '' });
    expect((await guestOf(recent))).toMatchObject({ birthdate: '1970-05-05', idNumber: 'AB123' });
    const [a] = await db.execute(sql`select after from audit_log where entity = 'guest' and entity_id = ${g.id} and at < now() - interval '1 year'`);
    expect(a!.after).toEqual({ anonymisiert: true });
    const reg = (await ok('GET', '/registrations?expired=1', user)).find((r: { bookingId: string }) => r.bookingId === old);
    expect(reg.purged).toBe(true);
    expect((await ok('GET', '/registrations/purge', user)).lastGuests).toBe(1);
    // ein zweiter Lauf findet nichts mehr
    expect((await purgeExpiredRegistrations(db)).guests).toBe(0);
  });

  it('nicht löschen, wenn der Gast wieder gebucht hat', async () => {
    const old = await stay('Stammgast', addDays(today, -500), 1);
    await checkedOut(old);
    const g = await guestOf(old);
    await ok('POST', '/bookings', user, { guestId: g.id, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[0], from: addDays(today, 50), to: addDays(today, 51), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    await purgeExpiredRegistrations(db);
    expect((await guestOf(old)).idNumber).toBe('AB123');
  });

  it('bereinigt auch jüngere Protokolleinträge und erfasst Gäste ohne Check-in (z. B. storniert)', async () => {
    // Aufenthalt vor 14 Monaten, E-Mail vor 3 Monaten geändert (Protokoll enthält die Ausweisdaten)
    const old = await stay('Spaetaenderung', addDays(today, -420), 1);
    await checkedOut(old);
    const g = await guestOf(old);
    await db.execute(sql`insert into audit_log (at, user_name, action, entity, entity_id, before, after) values (now() - interval '90 days', 'Test', 'update', 'guest', ${g.id}, ${JSON.stringify({ email: '', idNumber: 'AB123' })}::jsonb, ${JSON.stringify({ email: 'x@example.org', idNumber: 'AB123' })}::jsonb)`);
    // Online-Meldeschein ausgefüllt, dann storniert (nie eingecheckt), Anreise vor 13 Monaten
    const cancelled = await stay('Storniert', addDays(today, -395), 1, 1);
    await db.execute(sql`update booking_rooms set status = 'cancelled' where booking_id = ${cancelled}`);
    // vergessene, nie abgeschlossene Reservierung vor 2 Jahren
    const forgotten = await stay('Vergessen', addDays(today, -730), 1, 1);
    await purgeExpiredRegistrations(db);
    for (const id of [old, cancelled, forgotten]) expect((await guestOf(id)).idNumber, id).toBe('');
    const rows = await db.execute(sql`select before, after from audit_log where entity = 'guest' and entity_id = ${g.id} and at > now() - interval '100 days'`);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/AB123/);
  });

  it('Zusammenführen: Protokolleinträge des entfernten Gastes werden anonymisiert', async () => {
    const a = await ok('POST', '/guests', admin, { ...GUEST, lastName: 'Doppelt', idNumber: '' });
    const b = await ok('POST', '/guests', admin, { ...GUEST, lastName: 'Doppelt', idNumber: 'ZZ999' });
    await ok('POST', `/guests/${a.id}/merge`, admin, { otherId: b.id });
    const rows = await db.execute(sql`select before, after from audit_log where entity = 'guest' and entity_id = ${b.id}`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(JSON.stringify(r)).not.toMatch(/ZZ999/);
  });
});
