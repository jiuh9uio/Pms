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

describe('Kurzbestätigung „im Sollbereich“', () => {
  it('fragt nur nach Bereichen mit offenen Messstellen und speichert die Bestätigung mit Namen', async () => {
    const areas = await ok('GET', '/hygiene/areas', admin);
    const lager = areas.find((a: { name: string }) => a.name === 'Lager');
    const kueche = areas.find((a: { name: string }) => a.name === 'Küche');
    await ok('POST', '/hygiene/points', admin, { areaId: lager.id, name: 'Getränkekühlung', minC: 2, maxC: 8, active: true });
    await ok('POST', '/hygiene/points', admin, { areaId: kueche.id, name: 'Salattheke', minC: 0, maxC: 7, active: true });

    let open = await ok('GET', '/hygiene/open', user);
    expect(open.map((o: { areaName: string; points: { name: string }[] }) => [o.areaName, o.points.map((p) => p.name)])).toEqual([['Küche', ['Salattheke']], ['Lager', ['Getränkekühlung']]]);

    expect((await ok('POST', `/hygiene/areas/${kueche.id}/confirm`, user)).confirmed).toBe(1);
    expect((await ok('POST', `/hygiene/areas/${kueche.id}/confirm`, user)).confirmed).toBe(0); // zweites Tippen ändert nichts
    open = await ok('GET', '/hygiene/open', user);
    expect(open.map((o: { areaName: string }) => o.areaName)).toEqual(['Lager']);

    const list = await ok('GET', `/hygiene/readings?from=${today}&to=${today}`, user);
    const salat = list.find((r: { confirmed: boolean }) => r.confirmed);
    expect(salat).toMatchObject({ valueC: null, confirmed: true, userName: 'Küche' });
    // bereits gemessene Werte bleiben unberührt
    expect(list.filter((r: { confirmed: boolean }) => !r.confirmed)).toHaveLength(2);

    // ein später gemessener Wert ersetzt die Bestätigung und steht als Korrektur im Protokoll
    await ok('PUT', '/hygiene/readings', user, { entries: [{ pointId: salat.pointId, date: today, valueC: 5.5, note: '' }] });
    const after = (await ok('GET', `/hygiene/readings?from=${today}&to=${today}`, user)).find((r: { pointId: string }) => r.pointId === salat.pointId);
    expect(after).toMatchObject({ valueC: 5.5, confirmed: false });
    const log = (await ok('GET', '/audit?entity=hygiene_reading&limit=50', admin)).items;
    expect(log.some((e: { action: string }) => e.action === 'confirm')).toBe(true);
    expect(log.find((e: { action: string; before: { valueC: unknown } }) => e.action === 'correct' && e.before.valueC === 'im Soll bestätigt')).toBeTruthy();
  });
});

describe('Freigabe der Bereiche je Benutzer', () => {
  it('lässt Benutzer nur in freigegebene Bereiche – vom Server geprüft', async () => {
    const made = await ok('POST', '/users', admin, { username: 'nurhotel', name: 'Nur Hotel', password: 'nurhotel-123', role: 'user', modules: ['hotel'] });
    expect(made.modules).toEqual(['hotel']);
    const h = session(await call('POST', '/auth/login', {}, { username: 'nurhotel', password: 'nurhotel-123' }));
    expect((await call('GET', '/bookings', h)).statusCode).toBe(200);
    for (const [m, p] of [['GET', '/inspection-types'], ['GET', '/hygiene/open'], ['PUT', '/hygiene/readings']] as const) {
      const res = await call(m, p, h, { entries: [] });
      expect(res.statusCode, p).toBe(403);
      expect(res.json().error.message).toContain('Kontrollen');
    }
    // Freigabe umstellen wirkt sofort, ohne neue Anmeldung
    await ok('PATCH', `/users/${made.id}`, admin, { modules: ['kontrollen'], version: made.version });
    expect((await call('GET', '/bookings', h)).statusCode).toBe(403);
    expect((await call('GET', '/calendar?from=2031-01-01&days=7', h)).statusCode).toBe(403);
    expect((await call('GET', '/inspection-types', h)).statusCode).toBe(200);
    expect((await call('GET', '/settings/hotel', h)).statusCode).toBe(200); // Stammdaten bleiben lesbar
    // Administratoren dürfen unabhängig von der Liste alles; unbekannte Bereiche werden abgelehnt
    expect((await call('GET', '/bookings', admin)).statusCode).toBe(200);
    expect((await call('POST', '/users', admin, { username: 'falsch', name: 'X', password: 'falsch-12345', role: 'user', modules: ['kasse'] })).statusCode).toBe(400);
    expect((await ok('GET', '/auth/state', h)).user.modules).toEqual(['kontrollen']);
  });
});

describe('Reinigungsprotokoll', () => {
  it('führt Aufgaben mit Intervall, Fälligkeit und Abhaken mit Namen', async () => {
    const [kueche] = await ok('GET', '/hygiene/areas', admin);
    const task = { areaId: kueche.id, name: 'Arbeitsflächen desinfizieren', intervalDays: 1, active: true };
    expect((await call('POST', '/cleaning/tasks', user, task)).statusCode).toBe(403);
    const t1 = await ok('POST', '/cleaning/tasks', admin, task);
    const t2 = await ok('POST', '/cleaning/tasks', admin, { ...task, name: 'Kühltruhe abtauen', intervalDays: 30 });
    expect((await call('POST', '/cleaning/tasks', admin, { ...task, intervalDays: 0 })).statusCode).toBe(400);

    let tasks = await ok('GET', '/cleaning/tasks', user);
    expect(tasks.every((t: { due: boolean; lastDate: null }) => t.due && t.lastDate === null)).toBe(true);
    const due = await ok('GET', '/cleaning/due', user);
    expect(due[0].tasks.map((t: { name: string }) => t.name)).toEqual(['Arbeitsflächen desinfizieren', 'Kühltruhe abtauen']);

    // einzelne Aufgabe abhaken, danach den Rest des Bereichs mit einem Tipp
    expect((await ok('POST', `/cleaning/tasks/${t2.id}/done`, user)).done).toBe(1);
    expect((await ok('POST', `/cleaning/areas/${kueche.id}/done`, user)).done).toBe(1);
    expect((await ok('POST', `/cleaning/areas/${kueche.id}/done`, user)).done).toBe(0);
    expect(await ok('GET', '/cleaning/due', user)).toEqual([]);

    tasks = await ok('GET', '/cleaning/tasks', user);
    const abtauen = tasks.find((t: { id: string }) => t.id === t2.id);
    expect(abtauen).toMatchObject({ lastDate: today, lastBy: 'Küche', due: false, doneToday: true, dueDate: addDays(today, 30) });
    const log = await ok('GET', `/cleaning/log?from=${today}&to=${today}`, user);
    expect(log).toHaveLength(2);

    // versehentliches Abhaken von heute zurücknehmen – steht im Änderungsprotokoll
    await ok('POST', `/cleaning/tasks/${t1.id}/undo`, user);
    expect((await call('POST', `/cleaning/tasks/${t1.id}/undo`, user)).statusCode).toBe(404);
    expect((await ok('GET', '/cleaning/due', user))[0].tasks.map((t: { name: string }) => t.name)).toEqual(['Arbeitsflächen desinfizieren']);
    const audit = (await ok('GET', '/audit?entity=cleaning&limit=20', admin)).items.map((e: { action: string }) => e.action);
    expect(audit).toEqual(['undo', 'done', 'done']);
  });
});

describe('Wareneingangskontrolle', () => {
  it('trägt Lieferungen ein und verlangt bei Beanstandung eine Notiz', async () => {
    const a = await ok('POST', '/goods-receipts', user, { supplier: 'Metzgerei Muster', goods: 'Frischfleisch', tempC: 3.5, ok: true, note: '' });
    expect(a).toMatchObject({ date: today, tempC: 3.5, ok: true });
    const bad = await call('POST', '/goods-receipts', user, { supplier: 'Metzgerei Muster', goods: 'Hackfleisch', tempC: 9, ok: false, note: '' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.fields.note).toBeTruthy();
    await ok('POST', '/goods-receipts', user, { supplier: 'Getränke Beispiel', goods: 'Fassbier', tempC: null, ok: false, note: 'Fass beschädigt, Annahme verweigert' });
    const list = await ok('GET', `/goods-receipts?month=${today.slice(0, 7)}`, user);
    expect(list).toHaveLength(2);
    expect(list.map((r: { ok: boolean }) => r.ok).sort()).toEqual([false, true]);
    expect(await ok('GET', '/goods-receipts/suppliers', user)).toEqual(expect.arrayContaining(['Metzgerei Muster', 'Getränke Beispiel']));
    expect((await ok('GET', '/goods-receipts?month=2020-01', user))).toHaveLength(0);
  });

  it('löscht nur Einträge von heute', async () => {
    const [first] = await ok('GET', `/goods-receipts?month=${today.slice(0, 7)}`, user);
    await db.execute(sql`update goods_receipts set date = ${addDays(today, -1)}::date where id = ${first.id}`);
    expect((await call('POST', `/goods-receipts/${first.id}/remove`, admin)).statusCode).toBe(409);
    await db.execute(sql`update goods_receipts set date = ${today}::date where id = ${first.id}`);
    await ok('POST', `/goods-receipts/${first.id}/remove`, user);
    expect(await ok('GET', `/goods-receipts?month=${today.slice(0, 7)}`, user)).toHaveLength(1);
  });
});

describe('Restaurant: Tischreservierungen', () => {
  const D = '2031-06-14';
  const res = (extra: object = {}) => ({ date: D, time: '18:00', durationMin: 120, persons: 4, name: 'Familie Beispiel', phone: '', note: '', tableId: null as string | null, ...extra });
  let t1: string, t2: string;

  it('lässt nur den Administrator Tische anlegen', async () => {
    expect((await call('POST', '/restaurant/tables', user, { name: 'Tisch 1', seats: 4, area: '', sort: 1 })).statusCode).toBe(403);
    expect((await call('GET', '/restaurant/tables', user)).statusCode).toBe(200);
    t1 = (await ok('POST', '/restaurant/tables', admin, { name: 'Tisch 1', seats: 4, area: 'Gaststube', sort: 1 })).id;
    t2 = (await ok('POST', '/restaurant/tables', admin, { name: 'Tisch 2', seats: 2, area: 'Gaststube', sort: 2 })).id;
    expect((await call('POST', '/restaurant/tables', admin, { name: 'Tisch 1', seats: 4, area: '', sort: 3 })).statusCode).toBe(409);
  });

  it('verhindert doppelt belegte und zu kleine Tische', async () => {
    const a = (await ok('POST', '/restaurant/reservations', admin, res({ tableId: t1 }))).id;
    const clash = await call('POST', '/restaurant/reservations', admin, res({ tableId: t1, time: '19:30', name: 'Zweite' }));
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('table_taken');
    expect((await call('POST', '/restaurant/reservations', admin, res({ tableId: t2, name: 'Zu viele' }))).json().error.code).toBe('table_small');
    await ok('POST', '/restaurant/reservations', admin, res({ tableId: t1, time: '20:00', name: 'Danach' })); // direkt im Anschluss ist frei
    await ok('POST', '/restaurant/reservations', admin, res({ name: 'Ohne Tisch', persons: 12 }));
    expect((await call('POST', '/restaurant/reservations', admin, res({ time: '25:00' }))).statusCode).toBe(400);

    // gleichzeitige Anfragen auf denselben freien Tisch: genau eine gewinnt
    const both = await Promise.all([1, 2].map((i) => call('POST', '/restaurant/reservations', admin, res({ tableId: t2, persons: 2, time: '12:00', name: `Mittag ${i}` }))));
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);

    const list = await ok('GET', `/restaurant/reservations?date=${D}`, admin);
    expect(list.map((r: { time: string }) => r.time)).toEqual(['12:00', '18:00', '18:00', '20:00']);
    const first = list.find((r: { id: string }) => r.id === a);
    expect(first).toMatchObject({ tableName: 'Tisch 1', status: 'booked' });

    // Storno gibt den Tisch frei; Reaktivieren geht nur, solange er noch frei ist
    await ok('POST', `/restaurant/reservations/${a}/status`, admin, { status: 'cancelled', version: first.version });
    const b = (await ok('POST', '/restaurant/reservations', admin, res({ tableId: t1, name: 'Nachrücker' }))).id;
    expect((await call('POST', `/restaurant/reservations/${a}/status`, admin, { status: 'booked', version: first.version + 1 })).statusCode).toBe(409);
    expect((await call('POST', `/restaurant/reservations/${b}/status`, admin, { status: 'seated', version: 99 })).statusCode).toBe(409); // veralteter Stand

    // Verschieben auf eine belegte Zeit wird abgelehnt, auf eine freie angenommen
    const nb = (await ok('GET', `/restaurant/reservations?date=${D}`, admin)).find((r: { id: string }) => r.id === b);
    const { id: _id, tableName: _t, status: _s, createdBy: _c, ...data } = nb;
    expect((await call('PUT', `/restaurant/reservations/${b}`, admin, { ...data, time: '19:00' })).statusCode).toBe(409);
    await ok('PUT', `/restaurant/reservations/${b}`, admin, { ...data, time: '16:00', durationMin: 90 });
  });
});
