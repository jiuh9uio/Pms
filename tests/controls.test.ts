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
  expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'kueche', name: 'Küche', password: 'kueche-12345', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'kueche-12345' }));
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Kontrollarten', () => {
  it('bringt Hygieneamt und Finanzamt mit und lässt weitere anlegen', async () => {
    const types = await ok('GET', '/inspection-types', user);
    expect(types.map((t: { name: string }) => t.name)).toEqual(['Hygieneamt', 'Finanzamt']);
    expect(types[0].kind).toBe('hygiene');
    expect((await call('POST', '/inspection-types', user, { name: 'Brandschutz', active: true })).statusCode).toBe(403);
    await ok('POST', '/inspection-types', admin, { name: 'Brandschutz', active: true });
    expect((await call('POST', '/inspection-types', admin, { name: 'Brandschutz', active: true })).statusCode).toBe(409);
    expect((await ok('GET', '/inspection-types', user)).map((t: { name: string }) => t.name)).toEqual(['Hygieneamt', 'Finanzamt', 'Brandschutz']);
  });

  it('führt Unterlagen und Kontrollbesuche', async () => {
    const fa = (await ok('GET', '/inspection-types', user)).find((t: { name: string }) => t.name === 'Finanzamt');
    let d = await ok('GET', `/inspection-types/${fa.id}`, user);
    expect(d.items.length).toBeGreaterThan(0);
    expect((await call('POST', `/inspection-types/${fa.id}/items`, user, { text: 'Neu' })).statusCode).toBe(403);
    d = await ok('POST', `/inspection-types/${fa.id}/items`, admin, { text: 'Kassenbuch' });
    const item = d.items.find((i: { text: string }) => i.text === 'Kassenbuch');
    d = await ok('PUT', `/inspection-items/${item.id}`, user, { ready: true, note: 'Ordner 3', version: item.version });
    expect(d.type.itemsReady).toBe(1);
    expect((await call('PUT', `/inspection-items/${item.id}`, user, { ready: false, note: '', version: item.version })).json().error.code).toBe('stale');
    expect((await call('POST', `/inspection-types/${fa.id}/visits`, user, { date: addDays(today, 1), inspector: '', result: '', notes: '' })).statusCode).toBe(400);
    d = await ok('POST', `/inspection-types/${fa.id}/visits`, user, { date: today, inspector: 'Frau Prüfer', result: 'ohne Beanstandung', notes: '' });
    expect(d.visits[0]).toMatchObject({ inspector: 'Frau Prüfer', recordedBy: 'Küche' });
    expect(d.type.lastVisit).toBe(today);
  });
});

describe('Temperaturprotokoll', () => {
  let truhe: string;
  let schrank: string;

  it('lässt den Administrator Bereiche und Messstellen einrichten', async () => {
    const [kueche] = await ok('GET', '/hygiene/areas', user);
    expect(kueche.name).toBe('Küche');
    const p = { areaId: kueche.id, name: 'Kühltruhe', minC: null, maxC: -18, active: true };
    expect((await call('POST', '/hygiene/points', user, p)).statusCode).toBe(403);
    truhe = (await ok('POST', '/hygiene/points', admin, p)).id;
    schrank = (await ok('POST', '/hygiene/points', admin, { ...p, name: 'Kühlschrank', minC: 0, maxC: 7 })).id;
    expect((await call('POST', '/hygiene/points', admin, { ...p, minC: 5, maxC: 2 })).statusCode).toBe(400);
    await ok('POST', '/hygiene/areas', admin, { name: 'Lager', active: true });
    const areas = await ok('GET', '/hygiene/areas', user);
    expect(areas.map((a: { name: string }) => a.name)).toEqual(['Küche', 'Lager']);
    expect(areas[0].points.map((x: { name: string }) => x.name)).toEqual(['Kühltruhe', 'Kühlschrank']);
  });

  it('speichert Messwerte mit Namen und Zeitpunkt der Erfassung', async () => {
    await ok('PUT', '/hygiene/readings', user, { entries: [{ pointId: truhe, date: today, valueC: -19.5, note: '' }, { pointId: schrank, date: today, valueC: 4, note: '' }] });
    const list = await ok('GET', `/hygiene/readings?from=${today}&to=${today}`, user);
    expect(list).toHaveLength(2);
    expect(list.find((r: { pointId: string }) => r.pointId === truhe)).toMatchObject({ valueC: -19.5, userName: 'Küche' });
  });

  it('verlangt bei Abweichung die ergriffene Maßnahme und lehnt Zukunftsdaten ab', async () => {
    const warm = await call('PUT', '/hygiene/readings', user, { entries: [{ pointId: truhe, date: addDays(today, -1), valueC: -12, note: '' }] });
    expect(warm.statusCode).toBe(400);
    expect(warm.json().error.fields['entries.0.note']).toMatch(/Maßnahme/);
    await ok('PUT', '/hygiene/readings', user, { entries: [{ pointId: truhe, date: addDays(today, -1), valueC: -12, note: 'Tür stand offen, geschlossen, Nachmessung -18' }] });
    expect((await call('PUT', '/hygiene/readings', user, { entries: [{ pointId: truhe, date: addDays(today, 1), valueC: -19, note: '' }] })).statusCode).toBe(400);
    expect((await call('PUT', '/hygiene/readings', user, { entries: [] })).statusCode).toBe(400);
    expect((await call('PUT', '/hygiene/readings', {}, { entries: [] })).statusCode).toBe(401);
  });

  it('protokolliert Korrekturen mit altem und neuem Wert', async () => {
    await ok('PUT', '/hygiene/readings', admin, { entries: [{ pointId: schrank, date: today, valueC: 5, note: 'Ablesefehler korrigiert' }] });
    const [r] = (await ok('GET', `/hygiene/readings?from=${today}&to=${today}`, user)).filter((x: { pointId: string }) => x.pointId === schrank);
    expect(r).toMatchObject({ valueC: 5, userName: 'Chefin' });
    const log = (await ok('GET', '/audit?entity=hygiene_reading&limit=20', admin)).items;
    const fix = log.find((e: { action: string }) => e.action === 'correct');
    expect(fix.before).toMatchObject({ valueC: 4, enteredBy: 'Küche' });
    expect(fix.after.valueC).toBe(5);
    // unveränderter Wert erzeugt keinen weiteren Eintrag
    await ok('PUT', '/hygiene/readings', admin, { entries: [{ pointId: schrank, date: today, valueC: 5, note: 'Ablesefehler korrigiert' }] });
    expect((await ok('GET', '/audit?entity=hygiene_reading&limit=20', admin)).items).toHaveLength(log.length);
  });
});
