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

describe('Logo überall', () => {
  it('Einstellung, öffentliches Logo nur wenn eingeschaltet, E-Mail mit Logo als HTML-Fassung', async () => {
    const { setMailSender } = await import('../src/server/modules/mail.js') as unknown as { setMailSender: (s: unknown) => void };
    // Logo hochladen (1×1 PNG)
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await ok('PUT', '/settings/logo', admin, { mime: 'image/png', dataBase64: png });
    expect(await ok('GET', '/settings/logo-info', admin)).toMatchObject({ present: true, printouts: true, guestPages: true, emails: false });
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/logo' })).statusCode).toBe(200);
    await ok('PUT', '/settings/logo-usage', admin, { printouts: true, guestPages: false, emails: true });
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/logo' })).statusCode).toBe(404);
    const { mailHtml } = await import('../src/server/modules/logo.js');
    const html = mailHtml('Guten Tag <Test>,\n\nLink: https://example.org/x\nZeile 2', 'Haus');
    expect(html).toContain('cid:logo');
    expect(html).toContain('&lt;Test&gt;');
    expect(html).toContain('<a href="https://example.org/x"');
    // echter Versandweg (nachgebildet): HTML-Fassung und Logo als eingebettetes Bild
    const sent: { html?: string; text: string; attachments?: { cid?: string }[] }[] = [];
    setMailSender(async (_c: unknown, m: { html?: string; text: string; attachments?: { cid?: string }[] }) => { sent.push(m); });
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.example.org', port: 587, user: 'haus@example.org', fromName: 'Haus', password: 'nur-test' });
    const { sendMail } = await import('../src/server/modules/mail.js');
    await sendMail(db as never, { userId: null, userName: 'Test', ip: null }, { to: 'gast@example.org', subject: 'Test', text: 'Hallo' });
    expect(sent[0]!.text).toBe('Hallo');
    expect(sent[0]!.html).toContain('cid:logo');
    expect(sent[0]!.attachments?.some((x) => x.cid === 'logo')).toBe(true);
    await ok('PUT', '/settings/logo-usage', admin, { printouts: true, guestPages: true, emails: false });
    await sendMail(db as never, { userId: null, userName: 'Test', ip: null }, { to: 'gast@example.org', subject: 'Test', text: 'Hallo' });
    expect(sent[1]!.html).toBeUndefined();
  });
});

describe('Aufs Zimmer und Ausfallgebühr', () => {
  it('Restaurant-Verzehr nur auf eingecheckte Zimmer; Ausfallgebühr als Entwurf nach den Bedingungen', async () => {
    const cat = await ok('POST', '/categories', admin, { name: 'Gebührzimmer', description: '', stdOccupancy: 1, maxPersons: 1, basePriceCents: 10000, sort: 8 });
    await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 2, firstNumber: 501, floor: '5' });
    const rooms = (await ok('GET', '/rooms', admin)).filter((r: { number: string }) => r.number === '501' || r.number === '502');
    const guest = { salutation: '', firstName: 'Erfunden', lastName: 'Gebühr', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' };
    const b = await ok('POST', '/bookings', admin, { guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: rooms[0].id, from: today, to: addDays(today, 2), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null },
        { roomId: rooms[1].id, from: addDays(today, 1), to: addDays(today, 3), adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }] });
    let d = await ok('GET', `/bookings/${b.id}`, admin);
    const [r1, r2] = d.rooms;
    const tax = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19) ?? (await ok('GET', '/tax-rates', admin))[0];
    // noch nicht eingecheckt → abgelehnt
    expect((await call('POST', '/restaurant/room-charge', admin, { bookingRoomId: r1.id, name: 'Restaurant', amountCents: 3850, taxRateId: tax.id })).statusCode).toBe(409);
    await ok('POST', `/booking-rooms/${r1.id}/status`, admin, { status: 'checked_in', version: r1.version });
    const inHouse = await ok('GET', '/restaurant/in-house', admin);
    expect(inHouse.map((x: { room: string }) => x.room)).toContain('501');
    await ok('POST', '/restaurant/room-charge', admin, { bookingRoomId: r1.id, name: 'Restaurant', amountCents: 3850, taxRateId: tax.id });
    d = await ok('GET', `/bookings/${b.id}`, admin);
    expect(d.charges.find((c: { name: string }) => c.name.startsWith('Restaurant'))).toMatchObject({ unitPriceCents: 3850, bookingRoomId: r1.id });
    // Ausfallgebühr: ohne storniertes Zimmer nicht möglich
    expect((await call('GET', `/bookings/${b.id}/cancel-fee`, admin)).statusCode).toBe(409);
    // Bedingungen: kostenfrei bis 7 Tage vorher, danach 80 %
    const pol = await ok('GET', '/settings/cancel-policy', admin).catch(() => null);
    if (pol) await ok('PUT', '/settings/cancel-policy', admin, { ...pol, enabled: true, freeDays: 7, feePercent: 80 });
    await ok('POST', `/booking-rooms/${r2.id}/status`, admin, { status: 'cancelled', version: d.rooms[1].version });
    const s = await ok('GET', `/bookings/${b.id}/cancel-fee`, admin);
    expect(s).toMatchObject({ rooms: ['502'], lodgingCents: 20000, noShow: false, existingDraftOrInvoice: null });
    if (pol) expect(s).toMatchObject({ free: false, feePercent: 80, feeCents: 16000 });
    const r = await ok('POST', `/bookings/${b.id}/cancel-fee`, admin, { amountCents: 16000, taxRatePercent: 0, text: '' });
    const inv = await ok('GET', `/invoices/${r.invoiceId}`, admin);
    expect(inv).toMatchObject({ status: 'draft', grossCents: 16000 });
    expect(inv.lines).toHaveLength(1);
    expect(inv.lines[0]).toMatchObject({ description: 'Ausfallgebühr', unitPriceCents: 16000, taxRatePercent: 0 });
    // kein zweites Mal
    expect((await call('POST', `/bookings/${b.id}/cancel-fee`, admin, { amountCents: 16000, taxRatePercent: 0, text: '' })).statusCode).toBe(409);
  });
});

describe('Temperaturprotokoll ausgeben', () => {
  it('PDF, E-Mail mit PDF (nachgebildet) und kompakter Bon', async () => {
    const [area] = await ok('GET', '/hygiene/areas', admin);
    const p1 = await ok('POST', '/hygiene/points', admin, { areaId: area.id, name: 'Kühlzelle Druck', minC: 0, maxC: 7, active: true });
    const p2 = await ok('POST', '/hygiene/points', admin, { areaId: area.id, name: 'Tiefkühl Druck', minC: null, maxC: -18, active: true });
    const d1 = addDays(today, -2), d2 = addDays(today, -1);
    await ok('PUT', '/hygiene/readings', admin, { entries: [
      { pointId: p1.id, date: d1, valueC: 4, note: '' }, { pointId: p2.id, date: d1, valueC: -20, note: '' },
      { pointId: p1.id, date: d2, valueC: 9, note: 'Tür offen, Ware geprüft' } ] });
    const q = `from=${d1}&to=${today}&area=${area.id}`;
    const pdf = await app.inject({ method: 'GET', url: `/api/v1/hygiene/export/pdf?${q}`, cookies: admin });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'GET', url: `/api/v1/hygiene/export/pdf?from=${today}&to=${d1}`, cookies: admin })).statusCode).toBe(400);
    // E-Mail (Versand nachgebildet)
    const { setMailSender } = await import('../src/server/modules/mail.js') as unknown as { setMailSender: (s: unknown) => void };
    const sent: { to: string; attachments?: { filename: string }[] }[] = [];
    setMailSender(async (_c: unknown, m: { to: string; attachments?: { filename: string }[] }) => { sent.push(m); });
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.example.org', port: 587, user: 'haus@example.org', fromName: 'Haus', password: 'nur-test' });
    const draft = await ok('GET', `/hygiene/export/mail?${q}`, admin);
    expect(draft.subject).toMatch(/Temperaturprotokoll/);
    await ok('POST', `/hygiene/export/mail?${q}`, admin, { to: 'amt@example.org', subject: draft.subject, text: draft.text });
    expect(sent.at(-1)!.to).toBe('amt@example.org');
    expect(sent.at(-1)!.attachments?.[0]?.filename).toMatch(/^Temperaturprotokoll_.*\.pdf$/);
    // Bon: je Tag eine Zeile, Breite wird eingehalten
    const { collectHygiene, bonLines } = await import('../src/server/modules/hygieneexport.js');
    const data = await collectHygiene(db as never, { from: d1, to: today, areaId: area.id });
    const lines = bonLines(data, { hotel: 'Testhaus', from: d1, to: today, by: 'Test' }, 32).filter((l): l is { text: string } => 'text' in l).map((l) => l.text);
    for (const t of lines) expect(t.length).toBeLessThanOrEqual(32);
    const dayLine = lines.find((t) => t.startsWith(`${d2.slice(8, 10)}.${d2.slice(5, 7)}.`))!;
    expect(dayLine).toMatch(/9!/); // außerhalb des Sollbereichs markiert
    expect(lines.some((t) => /Tür offen/.test(t))).toBe(true);
  });
});

describe('Steuersätze prüfen', () => {
  it('schlägt Frühstück auf 7 % vor (Getränke-Pauschalen nicht) und stellt nur auf Knopfdruck um', async () => {
    const r19 = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
    const fr = await ok('POST', '/services', admin, { name: 'Frühstück Steuertest', priceCents: 1500, per: 'person_night', taxRateId: r19.id, isBreakfast: true, active: true });
    await ok('POST', '/services', admin, { name: 'Parkplatz Steuertest', priceCents: 800, per: 'night', taxRateId: r19.id, isBreakfast: false, active: true });
    await ok('POST', '/offer-items', admin, { name: 'Getränkepauschale', description: '', unit: 'person', priceCents: 1500, taxRatePercent: 19, area: 'both', sort: 1, active: true });
    await ok('POST', '/offer-items', admin, { name: 'Abendessen Buffet', description: '', unit: 'person', priceCents: 3200, taxRatePercent: 19, area: 'both', sort: 2, active: true });
    const c = await ok('GET', '/tax-check', admin);
    const names = c.findings.map((f: { name: string }) => f.name);
    expect(names).toContain('Frühstück Steuertest');
    expect(names).toContain('Abendessen Buffet');
    expect(names).not.toContain('Parkplatz Steuertest');
    expect(names).not.toContain('Getränkepauschale');
    // nichts ändert sich ohne Knopfdruck
    const svc = (await ok('GET', '/services', admin)).find((s: { id: string }) => s.id === fr.id);
    expect(svc.taxRatePercent).toBe(19);
    await ok('POST', '/tax-check/apply', admin, { ids: [fr.id] });
    const after = (await ok('GET', '/services', admin)).find((s: { id: string }) => s.id === fr.id);
    expect(after.taxRatePercent).toBe(7);
    expect((await ok('GET', '/tax-check', admin)).findings.map((f: { name: string }) => f.name)).not.toContain('Frühstück Steuertest');
  });
});

describe('Einkauf: Warenzugang und Leergut mit Bon', () => {
  it('speichert Warenzugang und Leergut, druckt Bons (auch ohne Drucker gespeichert), rechnet offene Fässer und storniert ohne Löschen', async () => {
    await ok('PUT', '/settings/kitchen-printer', admin, { enabled: false, host: '', port: 9100, width: 48 });
    await ok('PUT', '/settings/front-printer', admin, { enabled: false, host: '', port: 9100, width: 48 });
    let o = await ok('GET', '/stock', admin);
    expect(o.articles.map((a: { name: string }) => a.name)).toEqual(['Pils – Fass 50 l', 'Hefe – Fass 20 l', 'Kupfer – Fass 30 l']);
    expect(o.printerReady).toBe(false);
    const at = (p: string, a: string) => o.atSuppliers.find((x: { partner: string; article: string }) => x.partner === p && x.article === a)?.qty ?? 0;
    // ohne Drucker: trotzdem gespeichert, Druckfehler wird gemeldet
    const r1 = await ok('POST', '/stock/receipts', admin, { date: '2031-07-02', supplier: 'Brauerei Beispiel', ref: 'B-77', note: '', print: true,
      lines: [{ qty: 5, article: 'Pils – Fass 50 l' }, { qty: 2, article: 'Pils – Fass 50 l' }, { qty: 1, article: 'Hefe – Fass 20 l' }], empties: [], depositCents: null, emptiesDepositCents: null });
    expect(r1).toMatchObject({ number: 'WE-2031-0001', printed: false });
    expect(r1.printError).toBeTruthy();
    o = await ok('GET', '/stock', admin);
    expect(at('Brauerei Beispiel', 'Pils – Fass 50 l')).toBe(7); // gleiche Artikel zusammengefasst
    expect(o.suppliers).toContain('Brauerei Beispiel');
    expect((await call('POST', '/stock/receipts', admin, { date: '2031-07-02', supplier: 'X', ref: '', note: '', print: false, lines: [], empties: [], depositCents: null, emptiesDepositCents: null })).statusCode).toBe(400);
    // mit Drucker: Warenzugang mit Leergut → 2 Bons (Fahrer + uns)
    const { createServer } = await import('node:net');
    const jobs: Buffer[][] = [];
    const printer = createServer({ allowHalfOpen: true }, (sock) => { const j: Buffer[] = []; jobs.push(j); sock.on('data', (d) => j.push(d)); });
    await new Promise<void>((r) => printer.listen(0, '127.0.0.1', () => r()));
    await ok('PUT', '/settings/front-printer', admin, { enabled: true, host: '127.0.0.1', port: (printer.address() as { port: number }).port, width: 42 });
    expect(await ok('POST', '/stock/receipts', admin, { date: '2031-07-09', supplier: 'brauerei beispiel ', ref: '', note: '', print: true,
      lines: [{ qty: 3, article: 'Kupfer – Fass 30 l' }], empties: [{ qty: 4, article: 'Pils – Fass 50 l' }], depositCents: 9000, emptiesDepositCents: 12000 })).toEqual({ number: 'WE-2031-0002', printed: true });
    // Leergut-Rückgabe allein (auch mehr als offen erlaubt – Fässer aus der Zeit vor dem Programm)
    expect(await ok('POST', '/stock/empties', admin, { date: '2031-07-10', supplier: 'Brauerei Beispiel', note: 'ein Fass verbeult', print: true,
      lines: [{ qty: 3, article: 'Pils – Fass 50 l' }, { qty: 2, article: 'Hefe – Fass 20 l' }], depositCents: 13000 })).toEqual({ number: 'LG-2031-0001', printed: true });
    await new Promise((r) => setTimeout(r, 150));
    expect(jobs).toHaveLength(4);
    const [drv, ours, lgDrv] = jobs.map((j) => Buffer.concat(j).toString('latin1'));
    expect(drv).toContain('WARENZUGANG');
    expect(drv).toContain('WE-2031-0002');
    expect(drv).toContain('Unterschrift Fahrer');
    expect(drv).toContain('Exemplar f');
    expect(ours).toContain('abheften');
    expect(drv).toContain('Pfand Saldo');
    expect(drv).toContain('-30,00 \xa4'.replace('\xa4', String.fromCharCode(0xd5))); // € in Codepage 858
    expect(lgDrv).toContain('Pfand Leergut (Gutschrift)');
    expect(lgDrv).toContain('LG-2031-0001');
    expect(lgDrv).toContain('ein Fass verbeult');
    expect(lgDrv).not.toContain('Ware angenommen');
    o = await ok('GET', '/stock', admin);
    expect(at('Brauerei Beispiel', 'Pils – Fass 50 l')).toBe(0); // 7 − 4 − 3
    expect(at('Brauerei Beispiel', 'Hefe – Fass 20 l')).toBe(0); // 1 − 2 → nicht negativ angezeigt
    expect(at('Brauerei Beispiel', 'Kupfer – Fass 30 l')).toBe(3);
    expect(o.bons.find((b: { number: string }) => b.number === 'WE-2031-0002').depositCents).toBe(-3000);
    expect(o.bons.find((b: { number: string }) => b.number === 'LG-2031-0001').depositCents).toBe(-13000);
    expect(o.bons.find((b: { number: string }) => b.number === 'WE-2031-0001').depositCents).toBeNull();
    // Nachdruck
    expect(o.bons.map((b: { number: string }) => b.number).slice(0, 3)).toEqual(['LG-2031-0001', 'WE-2031-0002', 'WE-2031-0001']);
    expect(await ok('POST', `/stock/bons/${o.bons[2].auditId}/reprint`, admin, {})).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 150));
    const again = Buffer.concat(jobs[4]!).toString('latin1');
    expect(again).toContain('Nachdruck');
    expect(again).toContain('WE-2031-0001');
    expect(again).toContain('B-77');
    expect((await call('POST', '/stock/bons/999999999/reprint', admin, {})).statusCode).toBe(404);
    // Stornieren: Eintrag bleibt, zählt nicht mehr
    const kupfer = o.recent.find((m: { kind: string; article: string }) => m.kind === 'in' && m.article === 'Kupfer – Fass 30 l');
    await ok('POST', `/stock/moves/${kupfer.id}/void`, admin, {});
    expect((await call('POST', `/stock/moves/${kupfer.id}/void`, admin, {})).json().error.code).toBe('already_voided');
    o = await ok('GET', '/stock', admin);
    expect(at('Brauerei Beispiel', 'Kupfer – Fass 30 l')).toBe(0);
    expect(o.recent.find((m: { id: string }) => m.id === kupfer.id).voided).toBe(true);
    // Artikel ändern
    expect(await ok('PUT', '/stock/articles', admin, { articles: [{ name: 'Kupfer – Fass 30 l', depositCents: 3000 }, { name: ' Radler – Fass 30 l ', depositCents: 0 }, { name: 'kupfer – fass 30 l', depositCents: 1 }] }))
      .toEqual([{ name: 'Kupfer – Fass 30 l', depositCents: 3000 }, { name: 'Radler – Fass 30 l', depositCents: 0 }]);
    await ok('POST', '/stock/receipts', admin, { date: '2031-07-11', supplier: 'Brauerei Beispiel', ref: '', note: '', print: false, lines: [{ qty: 2, article: 'Kupfer – Fass 30 l' }], empties: [], depositCents: 6000, emptiesDepositCents: null });
    o = await ok('GET', '/stock', admin);
    expect(o.atSuppliers.find((x: { article: string }) => x.article === 'Kupfer – Fass 30 l')).toMatchObject({ qty: 2, depositCents: 6000 });
    expect(o.atSuppliers.find((x: { article: string }) => x.article === 'Hefe – Fass 20 l')).toBeUndefined();
    await ok('PUT', '/settings/front-printer', admin, { enabled: false, host: '', port: 9100, width: 48 });
    printer.close();
  });
});

describe('Einkauf: alte Protokolleinträge aus Version 1.92.0', () => {
  it('ignoriert Einträge ohne Bon-Inhalt in der Bon-Liste und beim Nachdruck', async () => {
    await db.execute(sql`insert into audit_log (user_name, action, entity, entity_id, after) values ('alt', 'create', 'stock_receipt', null, ${JSON.stringify({ date: '2026-11-19', supplier: 'Alt', ref: '', note: '', lines: [{ qty: 1, article: 'Pils' }], empties: [] })}::jsonb)`);
    const o = await ok('GET', '/stock', admin);
    expect(o.bons.every((b: { number: string }) => !!b.number)).toBe(true);
    const [row] = await db.execute(sql`select max(id)::int as id from audit_log where entity = 'stock_receipt' and user_name = 'alt'`) as unknown as { id: number }[];
    expect((await call('POST', `/stock/bons/${row!.id}/reprint`, admin, {})).statusCode).toBe(404);
  });
});

describe('Gutscheine', () => {
  it('vergibt Nummern, verschlüsselt den PIN, erzeugt PDF, Rechnungsentwurf mit Porto und storniert ohne Löschen', async () => {
    await ok('PUT', '/voucher-numbering', admin, { format: 'prefix', prefix: 'SH-', start: 1001, digits: 4, validYears: 3, postageCents: 250 });
    let o = await ok('GET', '/vouchers', admin);
    expect(o.nextNumber).toBe('SH-1001');
    expect(o.suggestedValidUntil).toBe(`${Number(today.slice(0, 4)) + 3}-12-31`);
    const base = { pin: '4711-0815', posCardNo: 'K-99', valueCents: 5000, issuedOn: today, validUntil: '', buyerName: 'Erika Erfunden', buyerCompany: '', buyerStreet: 'Weg 1', buyerZip: '11111', buyerCity: 'Ort', buyerCountry: '', buyerEmail: '', recipientName: 'Max', message: 'Alles Gute!', designId: '', note: '' };
    const v1 = await ok('POST', '/vouchers', admin, { ...base, number: o.nextNumber });
    expect(v1.number).toBe('SH-1001');
    expect((await ok('GET', '/vouchers', admin)).nextNumber).toBe('SH-1002');
    // doppelte Nummer
    expect((await call('POST', '/vouchers', admin, { ...base, posCardNo: 'K-100', number: 'SH-1001' })).json().error.fields.number).toMatch(/vergeben/);
    // PIN: verschlüsselt in der Datenbank, in der Liste nur die letzten Stellen
    const [raw] = await db.execute(sql`select pin_enc, pin_hint from vouchers where id = ${v1.id}`) as unknown as { pin_enc: string; pin_hint: string }[];
    expect(raw!.pin_enc).not.toContain('4711');
    expect(raw!.pin_hint).toBe('15');
    o = await ok('GET', '/vouchers', admin);
    const listed = o.vouchers.find((v: { id: string }) => v.id === v1.id);
    expect(JSON.stringify(listed)).not.toContain('4711');
    expect(listed).toMatchObject({ hasPin: true, pinHint: '15', status: 'active' });
    expect(await ok('POST', `/vouchers/${v1.id}/pin`, admin, {})).toEqual({ pin: '4711-0815' });
    // PDF
    const pdf = await call('GET', `/vouchers/${v1.id}/pdf`, admin);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // Motiv hochladen (kleines PNG)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const d = await ok('POST', '/voucher-designs', admin, { name: 'Winter', mime: 'image/png', dataBase64: png.toString('base64'), textPos: 'right' });
    expect((await call('POST', '/voucher-designs', admin, { name: 'Falsch', mime: 'image/png', dataBase64: Buffer.from('kein bild').toString('base64'), textPos: 'right' })).statusCode).toBe(400);
    expect((await call('GET', `/voucher-designs/${d.id}/preview`, admin)).headers['content-type']).toBe('application/pdf');
    // Rechnungsentwurf: Gutschein 0 %, Porto 19 %
    const inv = await ok('POST', `/vouchers/${v1.id}/invoice`, admin, { valueTaxPercent: 0, postageCents: 250, postageTaxPercent: 19 });
    const draft = await ok('GET', `/invoices/${inv.invoiceId}`, admin);
    expect(draft.status).toBe('draft');
    expect(draft.recipientName).toBe('Erika Erfunden');
    expect(draft.lines.map((l: { description: string; totalCents: number; taxRatePercent: number }) => [l.description, l.totalCents, l.taxRatePercent])).toEqual([['Gutschein Nr. SH-1001', 5000, 0], ['Porto und Versand', 250, 19]]);
    expect((await call('POST', `/vouchers/${v1.id}/invoice`, admin, { valueTaxPercent: 0, postageCents: 0, postageTaxPercent: 19 })).json().error.code).toBe('voucher_invoiced');
    o = await ok('GET', '/vouchers', admin);
    expect(o.vouchers.find((v: { id: string }) => v.id === v1.id).invoiceStatus).toBe('draft');
    // Bearbeiten ohne PIN: PIN bleibt
    const cur = o.vouchers.find((v: { id: string }) => v.id === v1.id);
    await ok('PUT', `/vouchers/${v1.id}`, admin, { ...base, number: 'SH-1001', pin: '', message: 'Neu', version: cur.version });
    expect(await ok('POST', `/vouchers/${v1.id}/pin`, admin, {})).toEqual({ pin: '4711-0815' });
    // Stornieren: bleibt erhalten, PDF nicht mehr möglich
    const cur2 = (await ok('GET', '/vouchers', admin)).vouchers.find((v: { id: string }) => v.id === v1.id);
    await ok('POST', `/vouchers/${v1.id}/status`, admin, { status: 'cancelled', version: cur2.version });
    expect((await call('GET', `/vouchers/${v1.id}/pdf`, admin)).statusCode).toBe(409);
    expect((await ok('GET', '/vouchers', admin)).vouchers.find((v: { id: string }) => v.id === v1.id).status).toBe('cancelled');
    // Protokoll ohne PIN
    const [log] = await db.execute(sql`select count(*)::int as n from audit_log where entity = 'voucher' and (after::text like '%4711%' or before::text like '%4711%')`) as unknown as { n: number }[];
    expect(log!.n).toBe(0);
  });
});

describe('Gutschein-Design-Editor', () => {
  it('speichert Gestaltung ohne Bild, liefert sie zurück und druckt danach', async () => {
    const { layoutTemplate, fillText } = await import('../src/shared/vouchers.js');
    const layout = layoutTemplate('classic');
    layout.elements.push({ ...layout.elements[2]!, id: 'eigen', label: 'Eigener Text', text: 'Einlösbar im Restaurant · {website}', y: 120 });
    const d = await ok('POST', '/voucher-designs/editor', admin, { name: 'Editor-Test', layout });
    const got = await ok('GET', `/voucher-designs/${d.id}`, admin);
    expect(got).toMatchObject({ name: 'Editor-Test', hasImage: false });
    expect(got.layout.elements.map((e: { label: string }) => e.label)).toContain('Eigener Text');
    const pv = await call('GET', `/voucher-designs/${d.id}/preview`, admin);
    expect(pv.headers['content-type']).toBe('application/pdf');
    expect(pv.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    // Bild ergänzen, dann wieder entfernen
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await ok('PUT', `/voucher-designs/${d.id}/editor`, admin, { name: 'Editor-Test', layout, image: { mime: 'image/png', dataBase64: png } });
    expect((await ok('GET', `/voucher-designs/${d.id}`, admin)).hasImage).toBe(true);
    await ok('PUT', `/voucher-designs/${d.id}/editor`, admin, { name: 'Editor-Test 2', layout, image: null });
    expect(await ok('GET', `/voucher-designs/${d.id}`, admin)).toMatchObject({ name: 'Editor-Test 2', hasImage: false });
    expect((await call('GET', `/voucher-designs/${d.id}/image`, admin)).statusCode).toBe(404);
    // Liste kennt das Design
    expect((await ok('GET', '/vouchers', admin)).designs.find((x: { id: string }) => x.id === d.id)).toMatchObject({ hasLayout: true, hasImage: false });
    // ungültige Farbe wird abgelehnt
    const bad = structuredClone(layout); bad.elements[0]!.color = 'rot';
    expect((await call('POST', '/voucher-designs/editor', admin, { name: 'x', layout: bad })).statusCode).toBe(400);
    // Platzhalter: leere Zeilen und leere Teilstücke fallen weg
    expect(fillText('für {empfaenger}\nausgestellt am {ausgestellt} · gültig bis {gueltig}', { empfaenger: '', ausgestellt: '01.01.2027', gueltig: '' })).toBe('ausgestellt am 01.01.2027');
  });
});

describe('Gutschein-Vorlagen', () => {
  it('alle Vorlagen sind gültig und lassen sich übernehmen und drucken', async () => {
    const { DESIGN_PRESETS } = await import('../src/shared/voucherPresets.js');
    const { voucherLayout } = await import('../src/shared/vouchers.js');
    expect(DESIGN_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of DESIGN_PRESETS) {
      expect(voucherLayout.safeParse(p.layout).success, p.key).toBe(true);
      const d = await ok('POST', '/voucher-designs/editor', admin, { name: p.name, layout: p.layout });
      const pv = await call('GET', `/voucher-designs/${d.id}/preview`, admin);
      expect(pv.rawPayload.subarray(0, 4).toString(), p.key).toBe('%PDF');
    }
  });
});

describe('Gutscheinbuch', () => {
  it('speichert Zahlungsart und Kassierer, vermerkt Einlösung mit Datum und Benutzer', async () => {
    const o = await ok('GET', '/vouchers', admin);
    const base = { pin: '', posCardNo: '300777', valueCents: 2500, issuedOn: today, validUntil: '', buyerName: '', buyerCompany: '', buyerStreet: '', buyerZip: '', buyerCity: '', buyerCountry: '', buyerEmail: '', recipientName: '', message: '', designId: '', note: '' };
    const v = await ok('POST', '/vouchers', admin, { ...base, number: o.nextNumber, payMethod: 'EC-Karte', cashier: 'Anna' });
    let row = (await ok('GET', '/vouchers', admin)).vouchers.find((x: { id: string }) => x.id === v.id);
    expect(row).toMatchObject({ payMethod: 'EC-Karte', cashier: 'Anna', redeemedAt: null });
    expect((await ok('GET', '/vouchers', admin)).cashiers).toContain('Anna');
    await ok('POST', `/vouchers/${v.id}/status`, admin, { status: 'redeemed', version: row.version });
    row = (await ok('GET', '/vouchers', admin)).vouchers.find((x: { id: string }) => x.id === v.id);
    expect(row.status).toBe('redeemed');
    expect(row.redeemedAt).toBeTruthy();
    expect(row.redeemedBy).toBe('Chefin');
    await ok('POST', `/vouchers/${v.id}/status`, admin, { status: 'active', version: row.version });
    row = (await ok('GET', '/vouchers', admin)).vouchers.find((x: { id: string }) => x.id === v.id);
    expect(row).toMatchObject({ status: 'active', redeemedAt: null, redeemedBy: null });
  });
});

describe('Gutscheinbuch: Kassennummer', () => {
  it('lehnt eine schon vergebene Kassennummer ab', async () => {
    const o = await ok('GET', '/vouchers', admin);
    const base = { pin: '', valueCents: 1000, issuedOn: today, validUntil: '', buyerName: '', buyerCompany: '', buyerStreet: '', buyerZip: '', buyerCity: '', buyerCountry: '', buyerEmail: '', recipientName: '', message: '', designId: '', note: '', payMethod: 'Bar', cashier: '' };
    await ok('POST', '/vouchers', admin, { ...base, number: o.nextNumber, posCardNo: 'K-DOPPELT' });
    const r = await call('POST', '/vouchers', admin, { ...base, number: (await ok('GET', '/vouchers', admin)).nextNumber, posCardNo: 'k-doppelt' });
    expect(r.json().error.fields.posCardNo).toMatch(/schon bei Gutschein/);
  });
});

describe('Gutscheinnummer Nummer/Jahr', () => {
  it('zählt je Jahr ab 1 (bzw. ab Startnummer) und beginnt im neuen Jahr wieder bei 1', async () => {
    const y = Number(today.slice(0, 4)), yy = String(y % 100).padStart(2, '0'), ny = String((y + 1) % 100).padStart(2, '0');
    await ok('PUT', '/voucher-numbering', admin, { format: 'yearly', yearStart: 38, yearStartYear: y, prefix: '', start: 1, digits: 1, validYears: 3, postageCents: 0 });
    expect((await ok('GET', '/vouchers', admin)).nextNumber).toBe(`38/${yy}`);
    const base = { pin: '', posCardNo: '', valueCents: 1000, issuedOn: today, validUntil: '', buyerName: '', buyerCompany: '', buyerStreet: '', buyerZip: '', buyerCity: '', buyerCountry: '', buyerEmail: '', recipientName: '', message: '', designId: '', note: '', payMethod: 'Bar', cashier: '' };
    await ok('POST', '/vouchers', admin, { ...base, number: `38/${yy}` });
    expect((await ok('GET', '/vouchers', admin)).nextNumber).toBe(`39/${yy}`);
    expect((await ok('GET', `/vouchers/next-number?date=${y + 1}-01-05`, admin)).number).toBe(`1/${ny}`);
    await ok('PUT', '/voucher-numbering', admin, { format: 'prefix', prefix: 'SH-', start: 1001, digits: 4, validYears: 3, postageCents: 0 });
  });
});
