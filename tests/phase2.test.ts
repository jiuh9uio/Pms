import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin, type BookingDto } from '../src/shared/hotel.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
let user: Record<string, string>;

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });

const GUEST = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: '', email: 'erika@example.com', phone: '', street: '', zip: '', city: 'Musterstadt', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
const room = (roomId: string, from: string, to: string, extra: object = {}) => ({ roomId, from, to, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null, ...extra });
const booking = (rooms: object[], extra: object = {}) => ({ guest: GUEST, groupName: '', source: 'Telefon', paymentMethod: 'Karte', notes: '', breakfast: false, rooms, ...extra });

let catId: string;
let r1: string;
let r2: string;
const today = todayBerlin();

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Zimmer und Preise', () => {
  it('lässt nur Administratoren Stammdaten ändern', async () => {
    const cat = { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 3, basePriceCents: 10000, sort: 1 };
    expect((await call('POST', '/categories', user, cat)).statusCode).toBe(403);
    catId = (await ok('POST', '/categories', admin, cat)).id;
    const mk = (number: string) => ({ number, categoryId: catId, floor: '1', note: '', active: true, priceOverrideCents: null });
    r1 = (await ok('POST', '/rooms', admin, mk('1'))).id;
    r2 = (await ok('POST', '/rooms', admin, mk('2'))).id;
    expect((await call('POST', '/rooms', admin, mk('1'))).statusCode).toBe(409);
    expect((await ok('GET', '/rooms', user)).map((r: { number: string }) => r.number)).toEqual(['1', '2']);
  });

  it('legt mehrere Zimmer auf einmal an – alle oder keines', async () => {
    const [cat] = await ok('GET', '/categories', admin);
    const ez = await ok('POST', '/categories', admin, { ...cat, name: 'Einzelzimmer', basePriceCents: 6900, stdOccupancy: 1, maxPersons: 1 });
    expect((await call('POST', '/rooms/bulk', user, { categoryId: ez.id, count: 3, firstNumber: 10, floor: '1' })).statusCode).toBe(403);
    const made = await ok('POST', '/rooms/bulk', admin, { categoryId: ez.id, count: 3, firstNumber: 10, floor: '1' });
    expect(made.numbers).toEqual(['10', '11', '12']);
    const clash = await call('POST', '/rooms/bulk', admin, { categoryId: ez.id, count: 3, firstNumber: 12, floor: '1' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.message).toContain('12');
    expect((await ok('GET', '/rooms', user)).map((r: { number: string }) => r.number)).toEqual(['1', '2', '10', '11', '12']);
    expect((await call('POST', '/rooms/bulk', admin, { categoryId: ez.id, count: 0, firstNumber: 20, floor: '' })).statusCode).toBe(400);
    // für die folgenden Tests wieder nur Zimmer 1 und 2 buchbar
    for (const r of (await ok('GET', '/rooms', admin)).filter((x: { number: string }) => Number(x.number) >= 10))
      await ok('PUT', `/rooms/${r.id}`, admin, { number: r.number, categoryId: r.categoryId, floor: r.floor, note: '', active: false, priceOverrideCents: null, version: r.version });
  });

  it('berechnet Wochenend- und Saisonpreise in Reihenfolge der Priorität', async () => {
    const rule = { name: 'Wochenende', startDate: '2031-01-01', endDate: '2031-12-31', weekdays: [5, 6], categoryId: null, mode: 'percent', value: 10, priority: 20, active: true };
    await ok('POST', '/rate-rules', admin, rule);
    await ok('POST', '/rate-rules', admin, { ...rule, name: 'Messe', startDate: '2031-06-06', endDate: '2031-06-06', weekdays: [], mode: 'fixed', value: 150, priority: 10 });
    // 08.05.2031 ist ein Donnerstag
    const q = await ok('GET', `/quote?roomId=${r1}&from=2031-05-08&to=2031-05-11`, user);
    expect(q.nightly.map((n: { priceCents: number }) => n.priceCents)).toEqual([10000, 11000, 11000]);
    expect(q.nightly[1].source).toBe('Wochenende');
    // 06.06.2031 (Freitag): erst Festpreis 150, dann +10 %
    expect((await ok('GET', `/quote?roomId=${r1}&from=2031-06-06&to=2031-06-07`, user)).totalCents).toBe(16500);
    const bad = await call('POST', '/rate-rules', admin, { ...rule, endDate: '2030-01-01' });
    expect(bad.json().error.fields.endDate).toBeTruthy();
  });
});

describe('Reservierungen', () => {
  let b: BookingDto;

  it('legt eine Buchung mit zwei Zimmern, neuem Gast und Frühstück an', async () => {
    const tax19 = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
    await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax19.id, isBreakfast: true, active: true });
    const created = await ok('POST', '/bookings', user, booking([room(r1, '2031-05-08', '2031-05-11'), room(r2, '2031-05-08', '2031-05-11', { adults: 1 })], { breakfast: true, groupName: 'Hochzeit' }));
    expect(created.number).toMatch(/^B\d{2}-00001$/);
    b = await ok('GET', `/bookings/${created.id}`, user);
    expect(b.guest.lastName).toBe('Beispiel');
    expect(b.rooms).toHaveLength(2);
    expect(b.lodgingCents).toBe(64000);
    expect(b.rooms[0]!.nightly!.every((n) => n.taxRatePercent === 7)).toBe(true);
    expect(b.charges.map((c) => c.totalCents).sort()).toEqual([3600, 7200]); // 1 bzw. 2 Personen × 3 Nächte × 12 €
    expect(b.charges[0]!.taxRatePercent).toBe(19);
    expect(b.totalCents).toBe(64000 + 10800);
  });

  it('prüft Eingaben', async () => {
    const res = await call('POST', '/bookings', user, booking([room(r1, '2031-07-10', '2031-07-10')]));
    expect(res.statusCode).toBe(400);
    expect((await call('POST', '/bookings', user, { ...booking([room(r1, '2031-07-10', '2031-07-12')]), guest: undefined })).statusCode).toBe(400);
    expect((await call('GET', '/bookings', {})).statusCode).toBe(401);
  });

  it('verhindert Doppelbuchungen – auch bei gleichzeitigen Anfragen', async () => {
    const clash = await call('POST', '/bookings', user, booking([room(r1, '2031-05-10', '2031-05-12')]));
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('room_taken');
    const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/bookings', user, booking([room(r1, '2031-08-01', '2031-08-04')]))));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 409)).toHaveLength(7);
    // eine abgelehnte Buchung hinterlässt nichts (auch keinen Gast)
    expect(await ok('GET', '/bookings?q=Beispiel&from=2031-08-01&to=2031-08-04', user)).toHaveLength(1);
    // Anreise am Abreisetag ist möglich
    await ok('POST', '/bookings', user, booking([room(r1, '2031-05-11', '2031-05-12')]));
  });

  it('behält gebuchte Preise bei späteren Preisänderungen', async () => {
    const cats = await ok('GET', '/categories', admin);
    await ok('PUT', `/categories/${catId}`, admin, { ...cats[0], basePriceCents: 20000 });
    const same: BookingDto = await ok('GET', `/bookings/${b.id}`, user);
    expect(same.lodgingCents).toBe(64000);
    // Verlängerung um eine Nacht in Zimmer 2: nur die neue Nacht (Sonntag) kostet den neuen Preis
    const br = same.rooms.find((r) => r.roomNumber === '2')!;
    const longer: BookingDto = await ok('PATCH', `/booking-rooms/${br.id}`, user, { to: '2031-05-12', version: br.version });
    expect(longer.rooms.find((r) => r.id === br.id)!.nightly!.map((n) => n.priceCents)).toEqual([10000, 11000, 11000, 20000]);
    b = longer;
  });

  it('lehnt Verschieben auf belegte oder gesperrte Zeiträume ab und erkennt veraltete Stände', async () => {
    const br = b.rooms.find((r) => r.roomNumber === '2')!;
    expect((await call('PATCH', `/booking-rooms/${br.id}`, user, { roomId: r1, version: br.version })).statusCode).toBe(409);
    expect((await call('PATCH', `/booking-rooms/${br.id}`, user, { to: '2031-05-13', version: br.version - 1 })).json().error.code).toBe('stale');
    const block = await ok('POST', '/blocks', user, { roomId: r2, from: '2031-05-12', to: '2031-05-15', reason: 'Maler' });
    expect((await call('PATCH', `/booking-rooms/${br.id}`, user, { to: '2031-05-13', version: br.version })).json().error.code).toBe('room_taken');
    expect((await call('POST', '/bookings', user, booking([room(r2, '2031-05-13', '2031-05-14')]))).statusCode).toBe(409);
    await ok('POST', `/blocks/${block.id}/remove`, user);
    await ok('PATCH', `/booking-rooms/${br.id}`, user, { to: '2031-05-13', version: br.version });
  });

  it('setzt manuelle Preise und rechnet auf Wunsch neu', async () => {
    const created = await ok('POST', '/bookings', user, booking([room(r2, '2031-09-01', '2031-09-03', { pricePerNightCents: 7500 })]));
    let x: BookingDto = await ok('GET', `/bookings/${created.id}`, user);
    expect(x.lodgingCents).toBe(15000);
    expect(x.rooms[0]!.priceManual).toBe(true);
    x = await ok('PATCH', `/booking-rooms/${x.rooms[0]!.id}`, user, { to: '2031-09-04', version: x.rooms[0]!.version });
    expect(x.lodgingCents).toBe(22500); // neue Nacht übernimmt den manuellen Preis
    x = await ok('PATCH', `/booking-rooms/${x.rooms[0]!.id}`, user, { pricePerNightCents: null, version: x.rooms[0]!.version });
    expect(x.lodgingCents).toBe(60000);
  });

  it('gibt das Zimmer bei Storno frei und belegt es beim Reaktivieren wieder', async () => {
    const created = await ok('POST', '/bookings', user, booking([room(r1, '2031-10-01', '2031-10-03')]));
    let x: BookingDto = await ok('GET', `/bookings/${created.id}`, user);
    x = await ok('POST', `/booking-rooms/${x.rooms[0]!.id}/status`, user, { status: 'cancelled', version: x.rooms[0]!.version });
    expect(x.lodgingCents).toBe(0);
    const other = await ok('POST', '/bookings', user, booking([room(r1, '2031-10-02', '2031-10-04')]));
    const again = await call('POST', `/booking-rooms/${x.rooms[0]!.id}/status`, user, { status: 'confirmed', version: x.rooms[0]!.version });
    expect(again.json().error.code).toBe('room_taken');
    expect((await call('POST', `/booking-rooms/${x.rooms[0]!.id}/status`, user, { status: 'checked_in', version: x.rooms[0]!.version })).statusCode).toBe(409);
    expect(other.id).toBeTruthy();
  });
});

describe('Check-in, Check-out und Übersicht', () => {
  it('führt durch Anreise und vorzeitige Abreise', async () => {
    const future = await ok('POST', '/bookings', user, booking([room(r2, addDays(today, 5), addDays(today, 7))]));
    const f: BookingDto = await ok('GET', `/bookings/${future.id}`, user);
    expect((await call('POST', `/booking-rooms/${f.rooms[0]!.id}/status`, user, { status: 'checked_in', version: f.rooms[0]!.version })).statusCode).toBe(409);

    const created = await ok('POST', '/bookings', user, booking([room(r1, addDays(today, -1), addDays(today, 3))]));
    let x: BookingDto = await ok('GET', `/bookings/${created.id}`, user);
    const dash = await ok('GET', '/dashboard', user);
    expect(dash.tasks.some((t: { kind: string }) => t.kind === 'overdue_arrival')).toBe(true);

    x = await ok('POST', `/booking-rooms/${x.rooms[0]!.id}/status`, user, { status: 'checked_in', version: x.rooms[0]!.version });
    expect(x.rooms[0]!.checkedInAt).not.toBeNull();
    const d2 = await ok('GET', '/dashboard', user);
    expect(d2.rooms).toMatchObject({ total: 2, occupied: 1, free: 1, occupancyPercent: 50 });
    expect(d2.revenueTodayCents).toBe(x.rooms[0]!.nightly!.find((n) => n.date === today)!.priceCents);

    // Anreisedatum ist nach dem Check-in fest
    expect((await call('PATCH', `/booking-rooms/${x.rooms[0]!.id}`, user, { from: today, version: x.rooms[0]!.version })).statusCode).toBe(409);
    // vorzeitige Abreise heute: Zeitraum endet heute, spätere Nächte entfallen, Zimmer ist wieder buchbar
    x = await ok('POST', `/booking-rooms/${x.rooms[0]!.id}/status`, user, { status: 'checked_out', version: x.rooms[0]!.version });
    expect(x.rooms[0]!.to).toBe(today);
    expect(x.rooms[0]!.nightly).toHaveLength(1);
    await ok('POST', '/bookings', user, booking([room(r1, today, addDays(today, 1))]));
    expect((await ok('GET', '/dashboard', user)).arrivals).toHaveLength(1);
    // Housekeeping: Zimmer nach Abreise zu reinigen, mit heutiger Anreise als Aufgabe oben
    let hk = await ok('GET', '/dashboard', user);
    expect(hk.dirty).toEqual([expect.objectContaining({ number: '1', occupied: false, arrivalToday: expect.stringContaining('Beispiel') })]);
    expect(hk.tasks.find((t: { kind: string }) => t.kind === 'cleaning').text).toContain('Zimmer 1 reinigen');
    await ok('POST', `/rooms/${r1}/housekeeping`, user, { status: 'clean' });
    hk = await ok('GET', '/dashboard', user);
    expect(hk.dirty).toEqual([]);
    expect((await call('POST', `/rooms/${r1}/housekeeping`, user, { status: 'kaputt' })).statusCode).toBe(400);
    // abgeschlossene Zimmerbuchung kann nicht mehr verschoben werden
    expect((await call('PATCH', `/booking-rooms/${x.rooms[0]!.id}`, user, { to: addDays(today, 2), version: x.rooms[0]!.version })).statusCode).toBe(409);

    const history = await ok('GET', `/bookings/${created.id}/history`, user);
    expect(history.map((h: { action: string }) => h.action)).toEqual(['status', 'status', 'create']);
    expect(history[0].after.earlyDeparture.to).toBe(today);
  });

  it('zeigt Belegungen und Sperren im Plan und Gäste mit Aufenthalten', async () => {
    await ok('POST', '/blocks', user, { roomId: r2, from: addDays(today, 10), to: addDays(today, 12), reason: 'Reparatur' });
    const cal = await ok('GET', `/calendar?from=${addDays(today, -2)}&days=21`, user);
    expect(cal.rooms).toHaveLength(2);
    expect(cal.entries.filter((e: { kind: string }) => e.kind === 'block')).toHaveLength(1);
    expect(cal.entries.filter((e: { kind: string }) => e.kind === 'stay').length).toBeGreaterThanOrEqual(3);
    const free = await ok('GET', `/availability?from=${addDays(today, 10)}&to=${addDays(today, 11)}`, user);
    expect(free.map((r: { number: string }) => r.number)).toEqual(['1']);

    const guests = await ok('GET', '/guests?q=beisp', user);
    expect(guests.length).toBeGreaterThan(0);
    const g = guests.find((x: { stays: number }) => x.stays > 0);
    expect(g).toBeTruthy();
    const detail = await ok('GET', `/guests/${g.id}`, user);
    expect(detail.bookings).toHaveLength(1);
    const upd = await ok('PUT', `/guests/${g.id}`, user, { ...GUEST, phone: '0123 456', version: g.version });
    expect(upd.phone).toBe('0123 456');
  });
});
