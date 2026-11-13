import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { todayBerlin } from '../src/shared/hotel.js';

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

describe('Bezahlen und Abrechnen', () => {
  it('rechnet eine Reservierung vollständig bar ab und merkt sich den gegebenen Betrag', async () => {
    const b = await booking();
    expect((await billing(b)).uninvoicedCents).toBe(19800);
    const inv = await issue(b);
    expect(inv).toMatchObject({ grossCents: 19800, openCents: 19800 });
    expect((await pay({ bookingId: b, amountCents: 19800, method: 'Bar', givenCents: 15000 })).statusCode).toBe(400); // zu wenig gegeben
    expect((await pay({ bookingId: b, amountCents: 19800, method: 'Bar', givenCents: 20000 })).statusCode).toBe(200);
    const after = await ok('GET', `/invoices/${inv.id}`, user);
    expect(after).toMatchObject({ openCents: 0, paidCents: 19800 });
    expect(after.payments[0]).toMatchObject({ method: 'Bar', recordedBy: 'Rezeption' });
    expect((await db.execute(sql`select given_cents from payments where invoice_id = ${inv.id}`))[0]!.given_cents).toBe(20000);
    expect((await billing(b)).uninvoicedCents).toBe(0);
  });

  it('verhindert doppelte Abrechnung, erlaubt aber Teilrechnungen und Neuabrechnung nach Storno', async () => {
    const b = await booking(true);
    const lodging = await issue(b, 'lodging');
    expect(lodging.grossCents).toBe(19800);
    expect((await billing(b)).uninvoicedCents).toBe(4800);
    const again = await call('POST', '/invoices', user, { bookingId: b, include: 'lodging' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_invoiced');
    const rest = await issue(b); // „alles“ berechnet nur noch, was fehlt
    expect(rest.grossCents).toBe(4800);
    expect((await call('POST', '/invoices', user, { bookingId: b, include: 'all' })).statusCode).toBe(409);
    await ok('POST', `/invoices/${lodging.id}/cancel`, admin, { reason: 'falsche Anschrift' });
    expect((await billing(b)).uninvoicedCents).toBe(19800);
    expect((await issue(b)).grossCents).toBe(19800);
  });

  it('lässt bei zwei gleichzeitigen Abrechnungen derselben Reservierung nur eine zu', async () => {
    const b = await booking();
    const both = await Promise.all([admin, user].map((who) => call('POST', '/invoices', who, { bookingId: b, include: 'all' })));
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await billing(b)).invoices).toHaveLength(1);
  });

  it('verteilt Anzahlung und Teilzahlungen mit verschiedenen Zahlungsarten und verhindert Überzahlung und Doppelklick', async () => {
    const b = await booking(true); // 198 € + 48 €
    expect((await pay({ bookingId: b, amountCents: 5000, method: 'Überweisung' })).statusCode).toBe(200); // Anzahlung vor dem Aufenthalt
    const twice = await pay({ bookingId: b, amountCents: 5000, method: 'Überweisung' });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe('duplicate_payment');
    const a = await issue(b, 'lodging'); // Anzahlung wird verrechnet
    expect(a).toMatchObject({ grossCents: 19800, paidCents: 5000, openCents: 14800 });
    const c = await issue(b, 'extras');
    expect(c.openCents).toBe(4800);
    expect((await pay({ bookingId: b, amountCents: 30000, method: 'Bar' })).json().error.code).toBe('overpay');
    expect((await pay({ bookingId: b, amountCents: 16000, method: 'Karte' })).statusCode).toBe(200); // füllt Rechnung 1 (148 €), Rest 12 € auf Rechnung 2
    expect((await ok('GET', `/invoices/${a.id}`, user)).openCents).toBe(0);
    expect((await ok('GET', `/invoices/${c.id}`, user)).openCents).toBe(3600);
    expect((await pay({ invoiceId: c.id, amountCents: 3700, method: 'Bar' })).json().error.code).toBe('overpay');
    expect((await pay({ invoiceId: c.id, amountCents: 3600, method: 'Bar' })).statusCode).toBe(200);
    const bill = await billing(b);
    expect(bill.paidCents).toBe(24600);
    expect(bill.payments.map((p: { method: string }) => p.method).sort()).toEqual(['Bar', 'Karte', 'Karte', 'Überweisung']);
    expect((await pay({ bookingId: b, amountCents: 100, method: 'Bar' })).json().error.code).toBe('overpay');
  });

  it('lässt die Rechnung bei Überweisung offen, bis der Zahlungseingang gebucht ist', async () => {
    const b = await booking();
    const inv = await issue(b);
    expect((await ok('GET', '/invoices?status=open', user)).some((i: { id: string }) => i.id === inv.id)).toBe(true);
    await ok('POST', '/payments', user, { invoiceId: inv.id, amountCents: 19800, method: 'Überweisung', date: today, payer: '', note: 'Zahlungseingang' });
    expect((await ok('GET', '/invoices?status=open', user)).some((i: { id: string }) => i.id === inv.id)).toBe(false);
    expect((await ok('GET', '/invoices?status=paid&method=%C3%9Cberweisung', user)).some((i: { id: string }) => i.id === inv.id)).toBe(true);
    expect((await ok('GET', '/invoices?status=paid&method=Bar&serviceFrom=2032-01-01', user)).some((i: { id: string }) => i.id === inv.id)).toBe(false);
    const byService = await ok('GET', `/invoices?serviceFrom=${inv.serviceFrom}&serviceTo=${inv.serviceFrom}`, user);
    expect(byService.map((i: { id: string }) => i.id)).toContain(inv.id);
  });

  it('checkt aus, ohne eine neue Rechnung zu erzeugen', async () => {
    const b = await booking();
    await issue(b);
    await db.execute(sql`update room_allocations set period = daterange(${today}::date - 1, ${today}::date + 1) where id in (select allocation_id from booking_rooms where booking_id = ${b})`);
    let room = (await ok('GET', `/bookings/${b}`, user)).rooms[0];
    await ok('POST', `/booking-rooms/${room.id}/status`, user, { status: 'checked_in', version: room.version });
    room = (await ok('GET', `/bookings/${b}`, user)).rooms[0];
    await ok('POST', `/booking-rooms/${room.id}/status`, user, { status: 'checked_out', version: room.version });
    expect((await billing(b)).invoices).toHaveLength(1);
  });
});

describe('Rechnungsarchiv', () => {
  it('speichert das PDF beim Ausstellen und gibt es danach unverändert aus', async () => {
    const b = await booking();
    const draftId = (await ok('POST', '/invoices', user, { bookingId: b, include: 'all' })).id;
    const draft = await call('GET', `/invoices/${draftId}/pdf`, user);
    expect(draft.statusCode).toBe(200);
    expect(draft.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(Array.from(await db.execute(sql`select 1 from invoice_documents where invoice_id = ${draftId}`))).toHaveLength(0); // Entwürfe werden nicht archiviert
    const d = await ok('GET', `/invoices/${draftId}`, user);
    const inv = await ok('POST', `/invoices/${draftId}/issue`, user, { version: d.version });
    const first = await call('GET', `/invoices/${inv.id}/pdf`, user);
    expect(first.headers['content-disposition']).toContain(`${inv.number}.pdf`);
    // spätere Änderungen an Hausangaben, Logo und Zahlungen ändern die Archivkopie nicht
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, name: 'Neuer Name GmbH' });
    await ok('POST', '/payments', user, { invoiceId: inv.id, amountCents: 19800, method: 'Bar', date: today, payer: '', note: '' });
    const second = await call('GET', `/invoices/${inv.id}/pdf?download=1`, user);
    expect(second.headers['content-disposition']).toContain('attachment');
    expect(second.rawPayload.equals(first.rawPayload)).toBe(true);
    await expect(db.execute(sql`update invoice_documents set pdf = '\\x00' where invoice_id = ${inv.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from invoice_documents where invoice_id = ${inv.id}`)).rejects.toThrow();
    // Stornobeleg bekommt ebenfalls ein PDF; die Rechnung bleibt mit der Reservierung verknüpft
    const st = await ok('POST', `/invoices/${inv.id}/cancel`, admin, { reason: 'Test' });
    expect((await call('GET', `/invoices/${st.id}/pdf`, user)).rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ok('GET', `/invoices/${inv.id}`, user)).bookingId).toBe(b);
    expect((await ok('GET', '/invoices?status=cancelled', user)).map((i: { id: string }) => i.id)).toContain(inv.id);
  });

  it('nimmt als Logo nur kleine PNG- oder JPEG-Bilder vom Administrator an', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    expect((await call('PUT', '/settings/logo', user, { mime: 'image/png', dataBase64: png.toString('base64') })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/logo', admin, { mime: 'image/png', dataBase64: Buffer.from('kein Bild').toString('base64') })).statusCode).toBe(400);
    expect((await call('GET', '/settings/logo', user)).statusCode).toBe(404);
    await ok('PUT', '/settings/logo', admin, { mime: 'image/png', dataBase64: png.toString('base64') });
    const got = await call('GET', '/settings/logo', user);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.equals(png)).toBe(true);
    // neue Rechnung wird mit Logo erzeugt (PDF entsteht ohne Fehler)
    const inv = await issue(await booking());
    expect((await call('GET', `/invoices/${inv.id}/pdf`, user)).statusCode).toBe(200);
    await ok('POST', '/settings/logo/remove', admin, {});
    expect((await call('GET', '/settings/logo', user)).statusCode).toBe(404);
  });
});
