import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { pgMessage } from '../src/server/lib/errors.js';
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
  expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();
const year = today.slice(0, 4);
let bookingId: string;
/** Meldung, mit der die Datenbank eine Änderung ablehnt */
const refused = async (q: Promise<unknown>) => { try { await q; return 'nicht abgelehnt'; } catch (e) { return pgMessage(e) ?? String(e); } };

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user', modules: ['hotel'] });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  // Zimmer, Frühstück und eine Buchung: 2 Nächte à 100 € (7 %), Frühstück 2 Pers. × 2 N. × 12 € (19 %)
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 10000, sort: 1 });
  const { numbers } = await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 1, floor: '' });
  expect(numbers).toEqual(['1']);
  const room = (await ok('GET', '/rooms', admin))[0];
  const tax19 = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
  await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax19.id, isBreakfast: true, active: true });
  const guest = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: 'Beispiel GmbH', email: '', phone: '', street: 'Hauptstr. 1', zip: '12345', city: 'Musterstadt', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
  bookingId = (await ok('POST', '/bookings', user, {
    guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: true,
    rooms: [{ roomId: room.id, from: addDays(today, -2), to: today, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }],
  })).id;
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Anzahlung bei Teilrechnungen', () => {
  it('Überschuss der ersten Rechnung deckt die zweite – kein zweites Kassieren', async () => {
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890' });
    const total = 2 * 10000 + 4 * 1200;
    await ok('POST', '/payments', user, { bookingId, amountCents: total, method: 'Bar', date: today, payer: '', note: 'Anzahlung' });
    const issue = async (include: string) => {
      const { id } = await ok('POST', '/invoices', user, { bookingId, include });
      const d = await ok('GET', `/invoices/${id}`, user);
      await ok('POST', `/invoices/${id}/issue`, user, { version: d.version });
      return id as string;
    };
    const a = await issue('lodging');
    const b = await issue('extras');
    const ia = await ok('GET', `/invoices/${a}`, user), ib = await ok('GET', `/invoices/${b}`, user);
    expect(ia.grossCents).toBe(20000);
    expect(ib.grossCents).toBe(4800);
    expect([ia.openCents, ib.openCents]).toEqual([0, 0]);
    expect(ia.creditCents).toBe(-4800);
    expect(ib.creditCents).toBe(4800);
    expect(ib.paidCents).toBe(4800);
    const bill = await ok('GET', `/bookings/${bookingId}/billing`, user);
    expect(bill.invoices.every((i: { openCents: number }) => i.openCents === 0)).toBe(true);
    // nichts mehr offen: weitere Zahlung wird abgelehnt
    expect((await call('POST', '/payments', user, { bookingId, amountCents: 4800, method: 'Bar', date: today, payer: '', note: '' })).statusCode).toBe(409);
    expect((await call('POST', '/payments', user, { invoiceId: b, amountCents: 100, method: 'Bar', date: today, payer: '', note: '' })).statusCode).toBe(409);
    // Übersicht „offene Rechnungen“ zählt nichts
    expect((await ok('GET', '/invoices/summary', user)).count).toBe(0);
    expect(await ok('GET', '/invoices?status=open', user)).toHaveLength(0);
    // PDF der zweiten Rechnung zeigt die Verrechnung
    const pdf = await call('GET', `/invoices/${b}/pdf`, user);
    expect(pdf.statusCode).toBe(200);
  });

  it('E-Rechnung: nur eine unversendete je Rechnung; nach Storno nicht mehr versendbar', async () => {
    const list = await ok('GET', `/invoices?status=archive`, admin);
    const inv = list.find((i: { kind: string; status: string }) => i.kind === 'invoice' && i.status === 'issued');
    await db.execute(sql`update invoices set recipient_country = 'Deutschland' where id = ${inv.id}`).catch(() => {});
    const e1 = await call('POST', `/einvoices/from-invoice/${inv.id}`, admin);
    expect(e1.statusCode, e1.body).toBe(200);
    await ok('POST', `/einvoices/from-invoice/${inv.id}`, admin);
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from einvoices where invoice_id = ${inv.id}`)) as unknown as { n: number }[];
    expect(n).toBe(1);
    await ok('POST', `/invoices/${inv.id}/cancel`, admin, { reason: 'Test' });
    const eid = ((await db.execute(sql`select id from einvoices where invoice_id = ${inv.id}`))[0] as { id: string }).id;
    const send = await call('POST', `/einvoices/${eid}/send`, admin, { to: 'a@example.org', subject: 'x', body: 'y', attach: 'pdf' });
    expect(send.statusCode).toBe(409);
    expect(send.json().error.code).toBe('invoice_cancelled');
  });

  it('veralteter Entwurf wird nicht ausgestellt', async () => {
    const room = (await ok('GET', '/rooms', admin))[0];
    const b = await ok('POST', '/bookings', user, { guest: { salutation: '', firstName: 'Max', lastName: 'Entwurf', company: '', email: '', phone: '', street: 'Weg 2', zip: '12345', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' },
      groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false, rooms: [{ roomId: room.id, from: addDays(today, 40), to: addDays(today, 42), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    const { id } = await ok('POST', '/invoices', user, { bookingId: b.id, include: 'all' });
    const br = (await ok('GET', `/bookings/${b.id}`, user)).rooms[0];
    await ok('PATCH', `/booking-rooms/${br.id}`, user, { pricePerNightCents: 8000, version: br.version });
    const d = await ok('GET', `/invoices/${id}`, user);
    const r = await call('POST', `/invoices/${id}/issue`, user, { version: d.version });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('stale_draft');
  });
});
