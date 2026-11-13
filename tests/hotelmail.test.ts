import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pms-test-'));
const { buildApp } = await import('../src/server/app.js');
const { connect, runMigrations } = await import('../src/server/db/client.js');
const { setMailSender } = await import('../src/server/modules/mail.js');

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const sent: { to: string; subject: string; text: string; files: { name: string; head: string }[] }[] = [];
let bookingId: string;

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  setMailSender(async (_c, m) => { sent.push({ to: m.to, subject: m.subject, text: m.text, files: (m.attachments ?? []).map((a) => ({ name: a.filename, head: a.content.subarray(0, 5).toString('latin1') })) }); });
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 101, floor: '1' });
  const room = (await ok('GET', '/rooms', admin))[0];
  const guest = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: '', email: 'erika@example.com', phone: '', street: 'Weg 1', zip: '11111', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
  bookingId = (await ok('POST', '/bookings', admin, { guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: room.id, from: '2031-05-08', to: '2031-05-10', adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] })).id;
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('E-Mail an den Gast', () => {
  it('schlägt eine Buchungsbestätigung vor und meldet fehlende Einrichtung', async () => {
    const d = await ok('GET', `/bookings/${bookingId}/mail`, admin);
    expect(d.to).toBe('erika@example.com');
    expect(d.ready).toBe(false);
    expect(d.subject).toContain('Reservierungsbestätigung');
    expect(d.text).toContain('Sehr geehrte Frau Beispiel,');
    expect(d.text).toContain('08.05.2031 bis 10.05.2031, 2 Nächte');
    expect(d.text).toMatch(/Gesamtbetrag: 198,00\s€/);
    const res = await call('POST', `/bookings/${bookingId}/mail`, admin, { to: d.to, subject: d.subject, text: d.text });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('mail_not_configured');
  });

  it('sendet die Bestätigung und vermerkt sie im Verlauf der Reservierung', async () => {
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.gmx.net', port: 587, user: 'hotel@example.com', fromName: 'Schützenhaus', password: 'geheim' });
    const d = await ok('GET', `/bookings/${bookingId}/mail`, admin);
    expect(d.ready).toBe(true);
    expect((await call('POST', `/bookings/${bookingId}/mail`, admin, { ...d, to: 'keine-adresse' })).statusCode).toBe(400);
    await ok('POST', `/bookings/${bookingId}/mail`, admin, { to: d.to, subject: d.subject, text: d.text + '\nPS: Parkplätze am Haus.' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'erika@example.com', files: [] });
    expect(sent[0]!.text).toContain('PS: Parkplätze am Haus.');
    const history = await ok('GET', `/bookings/${bookingId}/history`, admin);
    expect(history.some((h: { action: string }) => h.action === 'mail')).toBe(true);
  });

  it('sendet eine ausgestellte Rechnung als PDF, einen Entwurf nicht', async () => {
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890' });
    const inv = (await ok('POST', '/invoices', admin, { bookingId, include: 'all' })).id;
    expect((await call('GET', `/invoices/${inv}/mail`, admin)).statusCode).toBe(409);
    const draft = await ok('GET', `/invoices/${inv}`, admin);
    const issued = await ok('POST', `/invoices/${inv}/issue`, admin, { version: draft.version });
    const d = await ok('GET', `/invoices/${inv}/mail`, admin);
    expect(d).toMatchObject({ to: 'erika@example.com', ready: true });
    expect(d.text).toContain(`Rechnung ${issued.number}`);
    expect(d.attachment).toMatch(/\.pdf$/);
    await ok('POST', `/invoices/${inv}/mail`, admin, { to: d.to, subject: d.subject, text: d.text });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.files).toEqual([{ name: d.attachment, head: '%PDF-' }]);
  });

  it('schlägt eine Zahlungserinnerung nur für offene Rechnungen vor', async () => {
    const [inv] = await ok('GET', '/invoices', admin);
    const d = await ok('GET', `/invoices/${inv.id}/mail?kind=reminder`, admin);
    expect(d.subject).toContain('Zahlungserinnerung');
    expect(d.text).toMatch(/noch ein Betrag von 198,00\s€ offen/);
    await ok('POST', `/invoices/${inv.id}/mail?kind=reminder`, admin, { to: d.to, subject: d.subject, text: d.text });
    expect(sent.at(-1)!.subject).toContain('Zahlungserinnerung');
    await ok('POST', '/payments', admin, { invoiceId: inv.id, amountCents: 19800, method: 'Überweisung', date: new Date().toISOString().slice(0, 10), payer: '', note: '' });
    expect((await call('GET', `/invoices/${inv.id}/mail?kind=reminder`, admin)).statusCode).toBe(409);
  });

  it('wertet das Jahr je Monat aus', async () => {
    const r = await ok('GET', '/reports/year?year=2031', admin);
    expect(r.rooms).toBe(1);
    expect(r.months[4]).toMatchObject({ month: 5, nights: 2, available: 31, occupancyPercent: 6.5, lodgingCents: 19800 });
    expect(r.total).toMatchObject({ nights: 2, available: 365, lodgingCents: 19800 });
    const now = await ok('GET', `/reports/year?year=${new Date().getFullYear()}`, admin);
    expect(now.total).toMatchObject({ invoices: 1, invoicedCents: 19800 });
  });

  it('lässt den Gast den Meldeschein über einen einmaligen Link ausfüllen', async () => {
    expect(await ok('GET', `/bookings/${bookingId}/guest-form`, admin)).toMatchObject({ exists: false });
    const first = await ok('POST', `/bookings/${bookingId}/guest-form`, admin, {});
    const link = await ok('POST', `/bookings/${bookingId}/guest-form`, admin, {});
    expect(link.url).toMatch(/\/gast\/[A-Za-z0-9_-]{20,}$/);
    expect(link.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const pub = (u: string) => '/public/guest-form/' + u.split('/gast/')[1];
    expect((await call('GET', pub(first.url), {})).statusCode).toBe(404); // durch den neuen Link ersetzt
    expect((await call('GET', '/public/guest-form/' + 'x'.repeat(32), {})).statusCode).toBe(404);
    const view = await ok('GET', pub(link.url), {});
    expect(view).toEqual({ hotelName: expect.any(String), number: expect.any(String), from: '2031-05-08', to: '2031-05-10', firstName: 'Erika', lastName: 'Beispiel', submitted: false });
    const data = { firstName: 'Erika', lastName: 'Beispiel', birthdate: '1980-02-03', nationality: 'deutsch', street: 'Neue Str. 5', zip: '22222', city: 'Neustadt', country: 'Deutschland', idNumber: '', companions: 1 };
    const bad = await call('POST', pub(link.url), {}, { ...data, birthdate: '2999-01-01', city: '' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().error.fields).sort()).toEqual(['birthdate', 'city']);
    await ok('POST', pub(link.url), {}, data);
    expect((await call('POST', pub(link.url), {}, data)).statusCode).toBe(409); // nur eine Abgabe
    const b = await ok('GET', `/bookings/${bookingId}`, admin);
    expect(b.guest).toMatchObject({ street: 'Neue Str. 5', city: 'Neustadt', birthdate: '1980-02-03', email: 'erika@example.com' });
    expect((await ok('GET', `/bookings/${bookingId}/guest-form`, admin)).submittedAt).toBeTruthy();
    const history = await ok('GET', `/bookings/${bookingId}/history`, admin);
    expect(history.find((h: { action: string }) => h.action === 'guest_form').userName).toBe('Gast (Online-Meldeschein)');
    await db.execute(sql`update guest_forms set expires_at = now() - interval '1 minute'`);
    expect((await call('GET', pub(link.url), {})).statusCode).toBe(404);
  });

  it('zeigt Geräte im Netz nur Administratoren und merkt sich vergebene Namen', async () => {
    const scan = await ok('GET', '/network/devices', admin);
    expect(scan.devices.some((d: { self: boolean }) => d.self)).toBe(true);
    const d = scan.devices[0];
    expect(d.mac).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
    await ok('PUT', `/network/devices/${d.mac}`, admin, { name: 'Kasse' });
    expect((await ok('GET', '/network/devices', admin)).devices.find((x: { mac: string }) => x.mac === d.mac).name).toBe('Kasse');
    await ok('PUT', `/network/devices/${d.mac}`, admin, { name: '' });
    expect((await call('PUT', '/network/devices/keine-mac', admin, { name: 'x' })).statusCode).toBe(400);
    await ok('POST', '/users', admin, { username: 'theke', name: 'Theke', password: 'sehr-geheim-789', role: 'user', modules: ['hotel'] });
    const user = session(await call('POST', '/auth/login', {}, { username: 'theke', password: 'sehr-geheim-789' }));
    expect((await call('GET', '/network/devices', user)).statusCode).toBe(403);
  }, 20_000);

  it('verlangt die Freigabe für den Bereich Hotel', async () => {
    await ok('POST', '/users', admin, { username: 'kueche', name: 'Küche', password: 'sehr-geheim-456', role: 'user', modules: ['kontrollen'] });
    const user = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'sehr-geheim-456' }));
    expect((await call('GET', `/bookings/${bookingId}/mail`, user)).statusCode).toBe(403);
  });
});
