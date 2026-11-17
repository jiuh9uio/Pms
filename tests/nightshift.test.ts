import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { clientKey } from '../src/server/lib/clientkey.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

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
const today = todayBerlin();

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  const res = await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' });
  admin = { pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value };
});
afterAll(async () => { await app.close(); await close(); });

describe('Begrenzung je Absender', () => {
  it('IPv4 unverändert, IPv6 je /64-Netz', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:0db8:0001:0002:ffff:1:2:3'));
    expect(clientKey('2001:db8:1:2::1')).not.toBe(clientKey('2001:db8:1:3::1'));
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});

describe('Restaurant: Bearbeiten und Statuswechsel', () => {
  it('Tisch inzwischen verkleinert: Telefonnummer ändern geht trotzdem; mehr Personen nicht', async () => {
    const t = await ok('POST', '/restaurant/tables', admin, { name: 'Tisch 9', seats: 6, area: '', sort: 1 });
    const date = addDays(today, 3);
    const r = await ok('POST', '/restaurant/reservations', admin, { date, time: '18:00', durationMin: 120, persons: 6, name: 'Familie Erfunden', phone: '', note: '', tableId: t.id });
    const tables = await ok('GET', '/restaurant/tables', admin);
    const tb = tables.find((x: { id: string }) => x.id === t.id);
    await ok('PUT', `/restaurant/tables/${t.id}`, admin, { name: 'Tisch 9', seats: 4, area: '', sort: 1, active: true, version: tb.version });
    const day = await ok('GET', `/restaurant/reservations?date=${date}`, admin);
    const res = (day.list ?? day).find((x: { id: string }) => x.id === r.id);
    await ok('PUT', `/restaurant/reservations/${r.id}`, admin, { date, time: '18:00', durationMin: 120, persons: 6, name: 'Familie Erfunden', phone: '0123 456', note: '', tableId: t.id, version: res.version });
    expect((await call('PUT', `/restaurant/reservations/${r.id}`, admin, { date, time: '18:00', durationMin: 120, persons: 7, name: 'Familie Erfunden', phone: '0123 456', note: '', tableId: t.id, version: res.version + 1 })).statusCode).toBe(409);
    // künftige Reservierung: weder „Gäste da“ noch „Tisch frei“
    expect((await call('POST', `/restaurant/reservations/${r.id}/status`, admin, { status: 'done', version: res.version + 1 })).statusCode).toBe(409);
    await ok('POST', `/restaurant/reservations/${r.id}/status`, admin, { status: 'cancelled', version: res.version + 1 });
    expect((await call('POST', `/restaurant/reservations/${r.id}/status`, admin, { status: 'seated', version: res.version + 2 })).statusCode).toBe(409);
  });
});

describe('Temperatur-Abfrage beim Start', () => {
  it('überschreibt keinen Wert, den schon jemand eingetragen hat', async () => {
    const [area] = await ok('GET', '/hygiene/areas', admin);
    const p = await ok('POST', '/hygiene/points', admin, { areaId: area.id, name: 'Kühlzelle Test', minC: 0, maxC: 7, active: true });
    await ok('PUT', '/hygiene/readings', admin, { entries: [{ pointId: p.id, date: today, valueC: 5, note: '' }] });
    const r = await ok('PUT', '/hygiene/readings', admin, { onlyNew: true, entries: [{ pointId: p.id, date: today, valueC: 3, note: '' }] });
    expect(r).toMatchObject({ saved: 0, kept: 1 });
    const [row] = await db.execute(sql`select value_c from hygiene_readings where point_id = ${p.id} and date = ${today}`);
    expect(Number(row!.value_c)).toBe(5);
  });
});

describe('Datumsprüfung öffentlicher Formulare', () => {
  it('ein Datum, das es nicht gibt, wird abgelehnt statt eines Serverfehlers', async () => {
    const res = await call('GET', '/public/site/availability?from=2027-02-30&to=2027-03-02&adults=2', {});
    expect(res.statusCode).toBe(400);
  });
});
