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

describe('Abmelden nach Inaktivität – auch auf dem Server', () => {
  it('Hintergrund-Abfragen verlängern nicht; nach Ablauf ist die Anmeldung beendet', async () => {
    const res = await call('POST', '/auth/setup', {}, {});
    expect(res.statusCode).not.toBe(200); // schon eingerichtet
    const login = await call('POST', '/auth/login', {}, { username: 'chef', password: 'sehr-geheim-123' });
    const me = { pms_session: login.cookies.find((c) => c.name === 'pms_session')!.value };
    await ok('PUT', '/settings/security', admin, { idleMinutes: 15 });
    const [s] = await db.execute(sql`select id from sessions order by created_at desc limit 1`);
    // vor 10 Minuten zuletzt aktiv; Hintergrund-Abfrage („none“) darf das nicht verlängern
    await db.execute(sql`update sessions set last_seen_at = now() - interval '10 minutes' where id = ${s!.id}`);
    const bg = await app.inject({ method: 'GET', url: '/api/v1/sync', cookies: me, headers: { 'x-input-age': 'none' } });
    expect(bg.statusCode).toBe(200);
    const [after] = await db.execute(sql`select extract(epoch from now() - last_seen_at)::int as age from sessions where id = ${s!.id}`);
    expect(Number(after!.age)).toBeGreaterThanOrEqual(590);
    // 20 Minuten ohne Eingabe → abgemeldet, auch wenn der Browser erst jetzt wieder fragt
    await db.execute(sql`update sessions set last_seen_at = now() - interval '20 minutes' where id = ${s!.id}`);
    expect((await app.inject({ method: 'GET', url: '/api/v1/sync', cookies: me, headers: { 'x-input-age': '100' } })).statusCode).toBe(401);
    await ok('PUT', '/settings/security', admin, { idleMinutes: 0 });
  });
});

describe('Offener Betrag der Reservierung', () => {
  it('Leistungen eines stornierten Zimmers zählen nicht mit (wie bei der Rechnung)', async () => {
    const cat = await ok('POST', '/categories', admin, { name: 'Einzelzimmer', description: '', stdOccupancy: 1, maxPersons: 1, basePriceCents: 5000, sort: 1 });
    await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 2, firstNumber: 201, floor: '2' });
    const rooms = (await ok('GET', '/rooms', admin)).filter((r: { number: string }) => r.number === '201' || r.number === '202');
    const from = addDays(today, 10), to = addDays(today, 11);
    const b = await ok('POST', '/bookings', admin, { guest: { salutation: '', firstName: 'Erfunden', lastName: 'Zweizimmer', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' },
      groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: rooms.map((r: { id: string }) => ({ roomId: r.id, from, to, adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null })) });
    let d = await ok('GET', `/bookings/${b.id}`, admin);
    const second = d.rooms[1];
    await ok('POST', `/bookings/${b.id}/charges`, admin, { bookingRoomId: second.id, name: 'Parkplatz', unitPriceCents: 1000, quantity: 1, taxRateId: (await ok('GET', '/tax-rates', admin))[0].id });
    d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.totalCents).toBe(11000);
    await ok('POST', `/booking-rooms/${second.id}/status`, admin, { status: 'cancelled', version: d.rooms[1].version });
    d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.chargesCents).toBe(0);
    expect(d.totalCents).toBe(5000);
  });
});

describe('Rechnungen und Zahlungen (Teil B)', () => {
  let bookingId = '';
  const issueFor = async (include: string) => {
    const id = (await ok('POST', '/invoices', admin, { bookingId, include })).id;
    const d = await ok('GET', `/invoices/${id}`, admin);
    return { id, issued: await ok('POST', `/invoices/${id}/issue`, admin, { version: d.version }) };
  };
  it('Vorbereitung: Reservierung mit Übernachtung', async () => {
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, name: 'Testhaus', street: 'Weg 1', zip: '12345', city: 'Ort', taxNumber: '1/2/3', invoicePrefix: 'RE', paymentTermDays: 14 });
    const cat = await ok('POST', '/categories', admin, { name: 'Testzimmer', description: '', stdOccupancy: 1, maxPersons: 1, basePriceCents: 30000, sort: 9 });
    await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 301, floor: '3' });
    const room = (await ok('GET', '/rooms', admin)).find((r: { number: string }) => r.number === '301');
    bookingId = (await ok('POST', '/bookings', admin, { guest: { salutation: '', firstName: 'Erfunden', lastName: 'Rechnungsgast', company: '', email: '', phone: '', street: 'Weg 2', zip: '12345', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' },
      groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: room.id, from: addDays(today, -1), to: today, adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] })).id;
  });

  it('Gegenbuchung einer Zahlung auf einer stornierten Rechnung geht gegen die übertragene Anzahlung', async () => {
    const a = await issueFor('all');
    const pay = await ok('POST', '/payments', admin, { invoiceId: a.id, amountCents: 30000, method: 'Karte', date: today, payer: '', note: '' });
    await ok('POST', `/invoices/${a.id}/cancel`, admin, { reason: 'Anschrift falsch' });
    let bill = await ok('GET', `/bookings/${bookingId}/billing`, admin);
    expect(bill.unassignedPaidCents).toBe(30000);
    await ok('POST', `/payments/${pay.id}/reverse`, admin, { note: 'Karte zurückgebucht' });
    bill = await ok('GET', `/bookings/${bookingId}/billing`, admin);
    expect(bill.unassignedPaidCents).toBe(0);
    expect(bill.paidCents).toBe(0);
    // Storno-Umbuchungen sind gekennzeichnet (werden nicht in der TSE signiert)
    const notes = (await db.execute(sql`select note from payments where booking_id = ${bookingId} and note like 'Übertrag%'`)).map((r) => String(r.note));
    expect(notes.length).toBe(2);
  });

  it('Menge auf 2 Stellen gerundet; Summe passt zur gedruckten Menge', async () => {
    const id = (await ok('POST', '/invoices', admin, { bookingId, include: 'all' })).id;
    await ok('POST', `/invoices/${id}/lines`, admin, { description: 'Saalmiete', detail: '', quantity: 0.125, unitPriceCents: 10000, taxRatePercent: 19 });
    const d = await ok('GET', `/invoices/${id}`, admin);
    const l = d.lines.find((x: { description: string }) => x.description === 'Saalmiete');
    expect(l).toMatchObject({ quantity: 0.13, totalCents: 1300 });
    await ok('POST', `/invoices/${id}/remove`, admin, { version: d.version });
  });
});

describe('E-Rechnung: Netto je Steuersatz wie auf der PDF-Rechnung', () => {
  it('zwei 7-%-Positionen à 10,00 €: Basis 18,69 €, Steuer 1,31 €, kein Rundungsbetrag', async () => {
    const { computeEInvoice } = await import('../src/shared/einvoice.js');
    const { taxBreakdown } = await import('../src/shared/billing.js');
    const c = computeEInvoice({ paidCents: 0, lines: [{ name: 'A', quantity: 1, unitGrossCents: 1000, taxRate: 7 }, { name: 'B', quantity: 1, unitGrossCents: 1000, taxRate: 7 }] });
    const pdf = taxBreakdown([{ totalCents: 1000, taxRatePercent: 7 }, { totalCents: 1000, taxRatePercent: 7 }]);
    expect(c.taxes[0]).toMatchObject({ basisCents: pdf[0]!.netCents, taxCents: pdf[0]!.taxCents });
    expect(c.lines.reduce((s, l) => s + l.netCents, 0)).toBe(1869);
    expect(c.roundingCents).toBe(0);
  });
});

describe('HACCP: Sollbereich je Messwert und Korrekturregeln', () => {
  it('alter Wert behält seinen Sollbereich; Mitarbeiter nur heute/gestern; ältere Korrektur nur mit Begründung', async () => {
    await ok('POST', '/users', admin, { username: 'kueche2', name: 'Küche', password: 'kueche-12345', role: 'user', modules: ['kontrollen'] });
    const res = await call('POST', '/auth/login', {}, { username: 'kueche2', password: 'kueche-12345' });
    const staff = { pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value };
    const [area] = await ok('GET', '/hygiene/areas', admin);
    const p = await ok('POST', '/hygiene/points', admin, { areaId: area.id, name: 'Kühlschrank Regel', minC: 0, maxC: 7, active: true });
    const old = addDays(today, -5);
    // Mitarbeiter: vor fünf Tagen nicht
    const r1 = await call('PUT', '/hygiene/readings', staff, { entries: [{ pointId: p.id, date: old, valueC: 5, note: '' }] });
    expect([400, 403]).toContain(r1.statusCode);
    await ok('PUT', '/hygiene/readings', staff, { entries: [{ pointId: p.id, date: addDays(today, -1), valueC: 5, note: '' }] });
    // Administrator trägt 9 °C mit Maßnahme ein
    await ok('PUT', '/hygiene/readings', admin, { entries: [{ pointId: p.id, date: old, valueC: 9, note: 'Ware entsorgt' }] });
    // Maßnahme darf nicht verschwinden; Korrektur ohne Begründung nicht
    expect((await call('PUT', '/hygiene/readings', admin, { entries: [{ pointId: p.id, date: old, valueC: 5, note: '' }] })).statusCode).toBe(400);
    // Sollbereich der Messstelle später auf 10 °C: der alte Wert bleibt „außerhalb“ bewertet (gespeichert 0–7)
    const pts = (await ok('GET', '/hygiene/areas', admin)).flatMap((a: { points: { id: string; version: number }[] }) => a.points);
    const cur = pts.find((x: { id: string }) => x.id === p.id)!;
    await ok('PUT', `/hygiene/points/${p.id}`, admin, { areaId: area.id, name: 'Kühlschrank Regel', minC: 0, maxC: 10, active: true, version: cur.version });
    const list = await ok('GET', `/hygiene/readings?from=${old}&to=${old}`, admin);
    expect(list.find((x: { pointId: string }) => x.pointId === p.id)).toMatchObject({ valueC: 9, maxC: 7, rangeSaved: true });
  });
});

describe('Posteingang: von Hand eingeordnet bleibt eingeordnet', () => {
  it('„Neu einordnen“ überschreibt eine von Hand geänderte Art nicht', async () => {
    const [m] = await db.execute(sql`insert into inbox_mails (uid_validity, uid, subject, received_at, body, kind, extract) values ('1', 1, 'Hallo', now(), 'nur eine Frage', 'other', '{"kind":"other"}'::jsonb) returning id`);
    await ok('PATCH', `/inbox/${m!.id}`, admin, { kind: 'table' });
    await ok('POST', '/inbox/reclassify', admin, {});
    const [after] = await db.execute(sql`select kind from inbox_mails where id = ${m!.id}`);
    expect(after!.kind).toBe('table');
  });
});

describe('Frühstück passt sich an Nächte und Personen an', () => {
  it('Verlängerung um eine Nacht: Frühstücksmenge steigt mit', async () => {
    const tax = (await ok('GET', '/tax-rates', admin))[0];
    await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax.id, isBreakfast: true, active: true });
    const cat = await ok('POST', '/categories', admin, { name: 'Frühstückszimmer', description: '', stdOccupancy: 2, maxPersons: 3, basePriceCents: 8000, sort: 7 });
    await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 401, floor: '4' });
    const room = (await ok('GET', '/rooms', admin)).find((r: { number: string }) => r.number === '401');
    const from = addDays(today, 20);
    const b = await ok('POST', '/bookings', admin, { guest: { salutation: '', firstName: 'Erfunden', lastName: 'Frühstücksgast', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' },
      groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: true,
      rooms: [{ roomId: room.id, from, to: addDays(from, 3), adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    let d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.charges[0].quantity).toBe(6);
    await app.inject({ method: 'PATCH', url: `/api/v1/booking-rooms/${d.rooms[0].id}`, cookies: admin, payload: { to: addDays(from, 5), version: d.rooms[0].version } });
    d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.charges[0].quantity).toBe(10);
    await app.inject({ method: 'PATCH', url: `/api/v1/booking-rooms/${d.rooms[0].id}`, cookies: admin, payload: { adults: 3, version: d.rooms[0].version } });
    d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.charges[0].quantity).toBe(15);
  });
});

describe('Rechnungslayout: Zahlungs-QR-Code und eigene Farbe', () => {
  it('GiroCode-Inhalt nach EPC-Aufbau; ohne gültige IBAN oder Betrag kein Code', async () => {
    const { epcPayload, accentRgb } = await import('../src/server/einvoice/invoicepdf.js');
    expect(epcPayload({ name: 'Musterhaus am See', iban: 'DE02 1203 0000 0000 2020 51', bic: 'BYLADEM1001', cents: 38400, text: 'Rechnung RE-2026-0001' }))
      .toBe(['BCD', '002', '1', 'SCT', 'BYLADEM1001', 'Musterhaus am See', 'DE02120300000000202051', 'EUR384.00', '', '', 'Rechnung RE-2026-0001'].join('\n'));
    expect(epcPayload({ name: 'X', iban: '', bic: '', cents: 100, text: '' })).toBeNull();
    expect(epcPayload({ name: 'X', iban: 'DE02120300000000202051', bic: '', cents: 0, text: '' })).toBeNull();
    // sehr helle eigene Farbe wird abgedunkelt (lesbar)
    const [r, g, b] = accentRgb({ accent: 'custom', accentHex: '#ffffff' });
    expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThanOrEqual(0.551);
  });
  it('Vorschau mit allen neuen Optionen erzeugt ein PDF', async () => {
    const q = new URLSearchParams({ style: 'modern', accent: 'custom', accentHex: '#7a3b8f', logoSize: 'large', foldMarks: 'true', qrCode: 'true', letterhead: 'true', senderLine: 'false' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/settings/invoice-layout/preview?${q}`, cookies: admin });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Angebotslayout', () => {
  it('speichert eigene Gestaltung und liefert ein Muster-Angebot als PDF', async () => {
    const d = await ok('GET', '/settings/offer-layout', admin);
    expect(d).toMatchObject({ likeInvoice: true, prices: 'all', signature: true });
    await ok('PUT', '/settings/offer-layout', admin, { ...d, likeInvoice: false, style: 'elegant', accent: 'custom', accentHex: '#8a2d4f', prices: 'total', questionBoxes: true });
    expect(await ok('GET', '/settings/offer-layout', admin)).toMatchObject({ likeInvoice: false, style: 'elegant', prices: 'total', questionBoxes: true });
    const q = new URLSearchParams({ likeInvoice: 'false', style: 'modern', logoSize: 'large', foldMarks: 'true', letterhead: 'true', signature: 'false' });
    const res = await app.inject({ method: 'GET', url: `/api/v1/settings/offer-layout/preview?${q}`, cookies: admin });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call('PUT', '/settings/offer-layout', admin, { ...d, accentHex: 'rot' })).statusCode).toBe(400);
  });
});
