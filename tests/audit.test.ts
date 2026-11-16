import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

/** Prüfungen zu den Logikfehlern aus der Durchsicht (Version 1.75.0). */
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

describe('Korrekturen aus der Logik-Durchsicht', () => {
  it('Restaurant: „Gäste da“ nur am Tag selbst, „Nicht erschienen“ nicht im Voraus', async () => {
    const r = await ok('POST', '/restaurant/reservations', user, { date: addDays(today, 7), time: '18:00', durationMin: 120, persons: 2, name: 'Zukunft', phone: '', note: '', tableId: null });
    expect((await call('POST', `/restaurant/reservations/${r.id}/status`, user, { status: 'seated', version: r.version ?? 1 })).statusCode).toBe(409);
    expect((await call('POST', `/restaurant/reservations/${r.id}/status`, user, { status: 'no_show', version: r.version ?? 1 })).statusCode).toBe(409);
    const t = await ok('POST', '/restaurant/reservations', user, { date: today, time: '12:00', durationMin: 90, persons: 2, name: 'Heute', phone: '', note: '', tableId: null });
    expect((await call('POST', `/restaurant/reservations/${t.id}/status`, user, { status: 'seated', version: t.version ?? 1 })).statusCode).toBe(200);
  });

  it('Übergabebuch: zweites „Erledigt“ überschreibt den ersten Vermerk nicht', async () => {
    const n = await ok('POST', '/team/notes', user, { kind: 'task', text: 'Glühbirne Zimmer 101', place: '', dueDate: null });
    await ok('POST', `/team/notes/${n.id}/done`, user, { done: true, note: 'erledigt' });
    const again = await call('POST', `/team/notes/${n.id}/done`, admin, { done: true, note: 'nochmal' });
    expect(again.statusCode).toBe(409);
    const [row] = await db.execute(sql`select done_by, done_note from team_notes where id = ${n.id}`);
    expect(row).toMatchObject({ done_by: 'Rezeption', done_note: 'erledigt' });
  });

  it('Gast storniert online: abweichende Gebühr → nichts storniert', async () => {
    const b = await ok('POST', '/bookings', user, { guest: GUEST, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[0], from: addDays(today, 60), to: addDays(today, 62), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const pol = await ok('GET', '/settings/cancel-policy', admin);
    await ok('PUT', '/settings/cancel-policy', admin, { ...pol, enabled: true, online: true, freeDays: 3, feePercent: 80 });
    const token = new URL((await ok('GET', `/bookings/${b.id}/guest-link`, user)).url).pathname.split('/')[2]!;
    const cred = { lastName: 'Pruefung', zip: '12345' };
    expect((await call('POST', `/public/booking/${token}/cancel`, {}, { ...cred, confirm: true, feeCents: 999 })).statusCode).toBe(409);
    expect((await ok('GET', `/bookings/${b.id}`, user)).rooms[0].status).toBe('confirmed');
    expect((await call('POST', `/public/booking/${token}/cancel`, {}, { ...cred, confirm: true, feeCents: 0 })).statusCode).toBe(200);
  });

  it('Check-out nach vorzeitiger Abreise lässt sich nicht einfach zurücknehmen', async () => {
    const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: 'Frueh' }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[1], from: today, to: addDays(today, 3), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    let [r] = (await ok('GET', `/bookings/${b.id}`, user)).rooms;
    await ok('POST', `/booking-rooms/${r.id}/status`, user, { status: 'checked_in', version: r.version });
    [r] = (await ok('GET', `/bookings/${b.id}`, user)).rooms;
    await ok('POST', `/booking-rooms/${r.id}/status`, user, { status: 'checked_out', version: r.version });
    [r] = (await ok('GET', `/bookings/${b.id}`, user)).rooms;
    expect(r.to).toBe(addDays(today, 1));
    const back = await call('POST', `/booking-rooms/${r.id}/status`, user, { status: 'checked_in', version: r.version });
    expect(back.statusCode).toBe(409);
    expect(back.json().error.message).toMatch(/vorzeitig abgereist/);
  });

  it('Online-Meldeschein: leere Felder löschen keine vorhandene Ausweisnummer', async () => {
    const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: 'Ausweis' }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[0], from: addDays(today, 90), to: addDays(today, 91), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const form = await ok('POST', `/bookings/${b.id}/guest-form`, user, {});
    const token = new URL(form.url).pathname.split('/').at(-1)!;
    const res = await call('POST', `/public/guest-form/${token}`, {}, { firstName: 'Erika', lastName: 'Ausweis', birthdate: '1980-01-01', nationality: 'deutsch', street: 'Neue Str. 2', zip: '12345', city: 'Ort', country: 'Deutschland', idNumber: '', companions: 0 });
    expect(res.statusCode, res.body).toBe(200);
    const g = (await ok('GET', `/bookings/${b.id}`, user)).guest;
    expect(g.idNumber).toBe('X123');
    expect(g.street).toBe('Neue Str. 2');
  });

  it('Zahlungen: Mitarbeiter buchen genau den offenen Betrag, Teil- und Minusbeträge nur der Administrator', async () => {
    const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: 'Zahler' }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: roomIds[1], from: addDays(today, 120), to: addDays(today, 122), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const pay = (who: Record<string, string>, amountCents: number) => call('POST', '/payments', who, { bookingId: b.id, amountCents, method: 'Bar', date: today, payer: '', note: '' });
    const part = await pay(user, 5000);
    expect(part.statusCode).toBe(409);
    expect(part.json().error.code).toBe('partial');
    expect((await pay(user, -100)).statusCode).toBe(403);
    expect((await pay(admin, 5000)).statusCode).toBe(200); // Teilzahlung durch den Administrator
    expect((await pay(user, 19800 - 5000)).statusCode).toBe(200); // Rest genau
    expect((await pay(user, 100)).json().error.code).toBe('overpay');
  });

  it('Testphase beenden: danach keine Rechnungen/Zahlungen mehr löschbar, anderes schon', async () => {
    expect((await ok('GET', '/settings/go-live', admin)).active).toBe(false);
    expect((await call('GET', '/settings/go-live', user)).statusCode).toBe(403);
    expect((await call('POST', '/settings/go-live', admin, { password: 'falsch', confirm: 'ECHTBETRIEB' })).statusCode).toBe(400);
    expect((await call('POST', '/settings/go-live', admin, { password: 'sehr-geheim-123', confirm: 'JA' })).statusCode).toBe(400);
    expect((await ok('POST', '/settings/go-live', admin, { password: 'sehr-geheim-123', confirm: 'echtbetrieb' })).active).toBe(true);
    const base = { billing: false, bookings: 'none', guests: false, resetNumbers: false, inbox: false, companies: false, dryRun: true, password: '', confirm: '' };
    const blocked = await call('POST', '/settings/purge', admin, { ...base, billing: true });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('go_live');
    expect((await call('POST', '/settings/purge', admin, { ...base, guests: true })).statusCode).toBe(200);
  });
});
