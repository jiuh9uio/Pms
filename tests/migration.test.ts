import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pms-umzug-'));
const { buildApp } = await import('../src/server/app.js');
const { connect, runMigrations } = await import('../src/server/db/client.js');
const { getSecretKey } = await import('../src/server/modules/mail.js');

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
const bin = (path: string, who: Record<string, string>, body: Buffer, headers: Record<string, string>) =>
  app.inject({ method: 'POST', url: `/api/v1/settings/migration/${path}`, headers: { 'content-type': 'application/octet-stream', cookie: `pms_session=${who.pms_session}`, ...headers }, payload: body });
const n = async (table: string) => Number((await db.execute(sql.raw(`select count(*)::int as n from ${table}`)))[0]!.n);
const PW = 'Umzug-Passwort-ä1';
const GUEST = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: '', email: '', phone: '', street: 'Testweg 3', zip: '22222', city: 'Testdorf', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };

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
  await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890' });
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 2, firstNumber: 101, floor: '1' });
  const roomId = (await ok('GET', '/rooms', admin))[0].id;
  const b = await ok('POST', '/bookings', user, { guest: GUEST, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId, from: '2033-03-01', to: '2033-03-03', adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
  const { id } = await ok('POST', '/invoices', user, { bookingId: b.id, include: 'all' });
  const d = await ok('GET', `/invoices/${id}`, user);
  await ok('POST', `/invoices/${id}/issue`, user, { version: d.version });
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Umzugspaket', () => {
  let pkg: Buffer;
  let before: Record<string, number>;
  let key: string;
  const TABLES = ['guests', 'bookings', 'invoices', 'invoice_lines', 'users', 'rooms', 'audit_log'];

  it('nur der Administrator erstellt ein Paket, mit Passwort ab 10 Zeichen', async () => {
    expect((await call('POST', '/settings/migration/export', user, { password: PW })).statusCode).toBe(403);
    expect((await call('POST', '/settings/migration/export', admin, { password: 'kurz' })).statusCode).toBe(400);
    before = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await n(t)] as const)));
    key = getSecretKey().toString('base64');
    const res = await call('POST', '/settings/migration/export', admin, { password: PW });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/Umzug-\d{12}\.pmsumzug/);
    pkg = res.rawPayload;
    expect(pkg.subarray(0, 9).toString()).toBe('PMSUMZUG1');
    // verschlüsselt: kein Gastname im Klartext
    expect(pkg.includes(Buffer.from('Beispiel'))).toBe(false);
  });

  it('prüft das Paket ohne etwas zu ändern; falsches Passwort und fremde Dateien werden abgelehnt', async () => {
    const wrong = await bin('check', admin, pkg, { 'x-package-password': encodeURIComponent('falsches-Passwort') });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('bad_password');
    expect((await bin('check', admin, Buffer.from('irgendwas anderes, kein Paket ...........................................'), { 'x-package-password': encodeURIComponent(PW) })).json().error.code).toBe('bad_file');
    expect((await bin('check', user, pkg, { 'x-package-password': encodeURIComponent(PW) })).statusCode).toBe(403);
    const s = (await bin('check', admin, pkg, { 'x-package-password': encodeURIComponent(PW) })).json();
    expect(s).toMatchObject({ guests: before.guests, bookings: before.bookings, invoices: 1, users: 2 });
  });

  it('spielt das Paket ein: alles wie vorher, Schlüssel übernommen, Schutz von Rechnungen und Protokoll wieder aktiv', async () => {
    // Zielzustand verändern: neuer Gast, anderer Schlüssel-Inhalt wird überschrieben
    await ok('POST', '/guests', admin, { ...GUEST, lastName: 'NachDemExport' });
    expect(await n('guests')).toBe(before.guests! + 1);
    const noConfirm = await bin('import', admin, pkg, { 'x-package-password': encodeURIComponent(PW) });
    expect(noConfirm.statusCode).toBe(400);
    expect((await bin('import', user, pkg, { 'x-package-password': encodeURIComponent(PW), 'x-confirm': 'UMZUG' })).statusCode).toBe(403);
    const res = await bin('import', admin, pkg, { 'x-package-password': encodeURIComponent(PW), 'x-confirm': 'UMZUG' });
    expect(res.statusCode, res.body).toBe(200);
    for (const t of TABLES) expect(await n(t), t).toBe(t === 'audit_log' ? before[t]! + 1 : before[t]); // + Eintrag „Umzug eingespielt“ (der Export-Eintrag bleibt auf dem alten Rechner)
    expect((await db.execute(sql`select count(*)::int as n from guests where last_name = 'NachDemExport'`))[0]!.n).toBe(0);
    expect(getSecretKey().toString('base64')).toBe(key);
    expect(readFileSync(join(process.env.PMS_DATA_DIR!, 'secret.key')).toString('base64')).toBe(key);
    await expect(db.execute(sql`delete from invoices`)).rejects.toThrow();
    await expect(db.execute(sql`update audit_log set action = 'x'`)).rejects.toThrow();
    // Anmeldung mit den Zugangsdaten aus dem Paket funktioniert, fortlaufende Nummern laufen weiter
    const again = session(await call('POST', '/auth/login', {}, { username: 'chef', password: 'sehr-geheim-123' }));
    const g = await ok('POST', '/guests', again, { ...GUEST, lastName: 'NachDemUmzug' });
    expect(g.id).toBeTruthy();
    const ids = (await db.execute(sql`select id from audit_log order by id`)) as unknown as { id: number | string }[];
    expect(new Set(ids.map((r) => String(r.id))).size).toBe(ids.length);
  });
});
