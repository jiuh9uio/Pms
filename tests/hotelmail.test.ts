import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pms-test-'));
process.env.PMS_ONLINE_CHECK_URL = 'http://127.0.0.1:9/';
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

  it('führt die Frühstücksliste und druckt sie auf dem Küchendrucker', { timeout: 30_000 }, async () => {
    const { createServer } = await import('node:net');
    // Buchung 08.–10.05.2031 ohne Frühstück: an beiden Morgen belegt, aber nichts gebucht
    let list = await ok('GET', '/breakfast?date=2031-05-09', admin);
    expect(list.rooms).toHaveLength(1);
    expect(list.total).toEqual({ rooms: 0, adults: 0, children: 0, without: 1 });
    expect((await ok('GET', '/breakfast?date=2031-05-08', admin)).rooms).toHaveLength(0); // Anreisetag: noch kein Frühstück
    expect((await ok('GET', '/breakfast?date=2031-05-10', admin)).rooms[0].departing).toBe(true);
    const tax = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
    const svc = await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax.id, isBreakfast: true, active: true });
    const b = await ok('GET', `/bookings/${bookingId}`, admin);
    await ok('POST', `/bookings/${bookingId}/charges`, admin, { serviceId: svc.id, bookingRoomId: b.rooms[0].id });
    list = await ok('GET', '/breakfast?date=2031-05-09', admin);
    expect(list.total).toEqual({ rooms: 1, adults: 2, children: 0, without: 0 });
    expect(list.printerReady).toBe(false);
    expect((await call('POST', '/breakfast/print', admin, { date: '2031-05-09' })).json().error.code).toBe('printer_not_configured');

    // Drucker: nur Adressen im eigenen Netz; hier ein Test-Drucker auf diesem Rechner
    expect((await call('PUT', '/settings/kitchen-printer', admin, { enabled: true, host: '8.8.8.8', port: 9100, width: 48 })).statusCode).toBe(400);
    const got: Buffer[] = [];
    // der Test-Drucker schließt die Verbindung nie von sich aus – das Programm darf darauf nicht warten
    const server = createServer({ allowHalfOpen: true }, (sock) => { sock.on('data', (d) => got.push(d)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    await ok('PUT', '/settings/kitchen-printer', admin, { enabled: true, host: '127.0.0.1', port, width: 48 });
    await ok('POST', '/breakfast/print', admin, { date: '2031-05-09' });
    await new Promise((r) => setTimeout(r, 100));
    const job = Buffer.concat(got);
    expect([...job.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]); // initialisieren, Zeichentabelle CP858
    const text = job.toString('latin1');
    expect(text).toContain('FR\x9aHST\x9aCK'); // Ü in CP858
    expect(text).toContain('Zi. 101  Erika Beispiel');
    expect(text).toContain('2 Personen');
    expect([...job.subarray(-4)]).toEqual([0x1d, 0x56, 66, 0]); // Schnitt
    // täglicher automatischer Druck: einmal je Tag im Zeitfenster nach der eingestellten Uhrzeit
    const { autoBreakfastTick } = await import('../src/server/modules/breakfast.js');
    await ok('PUT', '/settings/kitchen-printer', admin, { enabled: true, host: '127.0.0.1', port, width: 48, autoBreakfastTime: '06:00' });
    got.length = 0;
    expect(await autoBreakfastTick(db, new Date('2031-05-09T03:30:00Z'))).toBe('idle'); // 05:30 Uhr in Berlin – zu früh
    expect(await autoBreakfastTick(db, new Date('2031-05-09T04:20:00Z'))).toBe('printed'); // 06:20 Uhr – nachgeholt
    expect(await autoBreakfastTick(db, new Date('2031-05-09T04:21:00Z'))).toBe('idle'); // nicht doppelt
    expect(await autoBreakfastTick(db, new Date('2031-05-12T04:05:00Z'))).toBe('skipped'); // kein Zimmer belegt
    expect(await autoBreakfastTick(db, new Date('2031-05-10T08:30:00Z'))).toBe('idle'); // 10:30 Uhr – Zeitfenster vorbei
    await new Promise((r) => setTimeout(r, 100));
    expect(Buffer.concat(got).toString('latin1')).toContain('Zi. 101  Erika Beispiel');
    expect((await ok('GET', '/breakfast?date=2031-05-09', admin))).toMatchObject({ autoTime: '06:00', autoLast: '2031-05-12' });

    // Tischreservierungen des Tages an die Küche
    got.length = 0;
    await ok('POST', '/restaurant/reservations', admin, { date: '2031-05-09', time: '18:30', durationMin: 120, persons: 6, name: 'Kegelclub', phone: '', note: 'Geburtstag', tableId: null });
    expect((await ok('GET', '/restaurant/printer', admin)).ready).toBe(true);
    await ok('POST', '/restaurant/reservations/print', admin, { date: '2031-05-09' });
    await new Promise((r) => setTimeout(r, 100));
    const bon = Buffer.concat(got).toString('latin1');
    expect(bon).toContain('RESERVIERUNGEN');
    expect(bon).toContain('18:30  Kegelclub');
    expect(bon).toContain('6 Personen');
    server.close();
    await new Promise((r) => setTimeout(r, 2200)); // offene Verbindung wird vom Programm selbst abgebaut
    const down = await call('POST', '/breakfast/print', admin, { date: '2031-05-09' });
    expect(down.statusCode).toBe(502);
    expect(down.json().error.message).toContain('keine Verbindung');
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

  it('zeigt Geräte im Netz nur mit Freigabe für den Bereich Internet und merkt sich vergebene Namen', async () => {
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
    expect((await call('GET', '/network/status', user)).statusCode).toBe(403);
    // neue Benutzer erhalten den Bereich nicht von selbst; der Administrator gibt ihn frei
    const created = await ok('POST', '/users', admin, { username: 'technik', name: 'Technik', password: 'sehr-geheim-000', role: 'user' });
    expect(created.modules).not.toContain('internet');
    await call('PATCH' as never, `/users/${created.id}`, admin, { modules: ['internet'], version: created.version });
    const tech = session(await call('POST', '/auth/login', {}, { username: 'technik', password: 'sehr-geheim-000' }));
    expect((await call('GET', '/network/devices', tech)).statusCode).toBe(200);
    // Gäste-WLAN: lesen mit Freigabe, ändern nur der Administrator
    expect((await ok('GET', '/network/wifi', tech)).qr).toBeNull();
    const wifi = { ssid: 'Schuetzenhaus-Gast', password: 'willkommen-2031', open: false, note: 'Kostenlos für unsere Gäste' };
    expect((await call('PUT', '/network/wifi', tech, wifi)).statusCode).toBe(403);
    expect((await call('PUT', '/network/wifi', admin, { ...wifi, password: 'kurz' })).statusCode).toBe(400);
    const saved = await ok('PUT', '/network/wifi', admin, wifi);
    expect(saved.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(await ok('GET', '/network/wifi', tech)).toMatchObject({ ssid: 'Schuetzenhaus-Gast', password: 'willkommen-2031' });
    const audit = await ok('GET', '/audit?entity=settings&limit=5', admin);
    expect(JSON.stringify(audit)).not.toContain('willkommen-2031');

    // Ausfallprotokoll: erst die zweite fehlgeschlagene Prüfung trägt ein, die nächste erfolgreiche schließt
    const { startOutageMonitor } = await import('../src/server/modules/network.js');
    let up = true;
    const tick = startOutageMonitor(db, async () => up, 0);
    await tick();
    up = false; await tick();
    expect((await ok('GET', '/network/outages', admin)).outages).toHaveLength(0);
    await tick(); await tick();
    let log = await ok('GET', '/network/outages', admin);
    expect(log.outages).toHaveLength(1);
    expect(log.outages[0].endedAt).toBeNull();
    up = true; await tick();
    log = await ok('GET', '/network/outages', admin);
    expect(log.outages[0]).toMatchObject({ uncertain: false });
    expect(log.outages[0].endedAt).toBeTruthy();
    // benanntes Gerät, das nicht antwortet, erscheint als nicht erreichbar
    await ok('PUT', '/network/devices/aa:bb:cc:dd:ee:ff', admin, { name: 'Drucker' });
    const again = await ok('GET', '/network/devices', admin);
    expect(again.devices.find((x: { mac: string }) => x.mac === 'aa:bb:cc:dd:ee:ff')).toMatchObject({ name: 'Drucker', online: false });
    const st = await ok('GET', '/network/status', admin);
    expect(typeof st.online).toBe('boolean');
  }, 60_000);

  it('sucht über Gäste, Reservierungen, Rechnungen und Tischreservierungen – nur in freigegebenen Bereichen', async () => {
    const r = await ok('GET', '/search?q=beispiel', admin);
    const kinds = r.hits.map((h: { kind: string }) => h.kind);
    expect(kinds).toEqual(expect.arrayContaining(['guest', 'booking', 'invoice']));
    expect(r.hits.find((h: { kind: string }) => h.kind === 'booking').sub).toContain('08.05.2031');
    const byNumber = await ok('GET', `/search?q=${encodeURIComponent((await ok('GET', '/invoices', admin))[0].number)}`, admin);
    expect(byNumber.hits.some((h: { kind: string }) => h.kind === 'invoice')).toBe(true);
    expect((await ok('GET', '/search?q=kegelclub', admin)).hits[0]).toMatchObject({ kind: 'table', id: '2031-05-09' });
    expect((await ok('GET', '/search?q=100%25', admin)).hits).toEqual([]); // Sonderzeichen sind kein Platzhalter
    expect((await call('GET', '/search?q=x', admin)).statusCode).toBe(400);
    expect((await call('GET', '/search?q=beispiel', {})).statusCode).toBe(401);
    // Benutzer nur mit „Kontrollen“: keine Treffer aus Hotel oder Restaurant
    await ok('POST', '/users', admin, { username: 'kueche', name: 'Küche', password: 'sehr-geheim-456', role: 'user', modules: ['kontrollen'] });
    const kueche = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'sehr-geheim-456' }));
    expect((await ok('GET', '/search?q=beispiel', kueche)).hits).toEqual([]);
    expect((await ok('GET', '/search?q=kegelclub', kueche)).hits).toEqual([]);
  });

  it('verlangt die Freigabe für den Bereich Hotel', async () => {
    const user = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'sehr-geheim-456' }));
    expect((await call('GET', `/bookings/${bookingId}/mail`, user)).statusCode).toBe(403);
  });

  it('druckt Info-Zettel im Schnelldruck: Öffnungszeiten, WLAN mit QR-Code, eigene Vorlagen, freier Text', async () => {
    const { createServer } = await import('node:net');
    const got: Buffer[] = [];
    let connections = 0;
    const server = createServer({ allowHalfOpen: true }, (sock) => { connections++; sock.on('data', (d) => got.push(d)); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const text = async () => { await new Promise((r) => setTimeout(r, 120)); const t = Buffer.concat(got).toString('latin1'); got.length = 0; return t; };

    // ohne Bondrucker vorne wird der Küchendrucker verwendet; ist keiner eingerichtet, gibt es eine klare Meldung
    await ok('PUT', '/settings/kitchen-printer', admin, { enabled: false, host: '', port: 9100, width: 48 });
    expect((await ok('GET', '/quickprint', admin)).printerReady).toBe(false);
    expect((await call('POST', '/quickprint/print', admin, { id: 'info', copies: 1 })).json().error.code).toBe('printer_not_configured');
    await ok('PUT', '/settings/kitchen-printer', admin, { enabled: true, host: '127.0.0.1', port, width: 48 });
    expect((await ok('GET', '/quickprint', admin)).printerName).toBe('Küchendrucker');
    expect((await call('PUT', '/settings/front-printer', admin, { enabled: true, host: '1.2.3.4', port, width: 32 })).statusCode).toBe(400);
    await ok('PUT', '/settings/front-printer', admin, { enabled: true, host: '127.0.0.1', port, width: 32 });

    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, phone: '01234 56789', openingHours: 'Mo-Fr 11:30-14:00 und 17:30-22:00\nDi Ruhetag' });
    const o = await ok('GET', '/quickprint', admin);
    expect(o).toMatchObject({ printerReady: true, printerName: 'Bondrucker vorne' });
    expect(o.slips.map((x: { id: string }) => x.id)).toEqual(['info', 'wifi', 'stay', 'review']);
    expect(o.slips[0].preview).toContain('Di Ruhetag');

    await ok('POST', '/quickprint/print', admin, { id: 'info', copies: 2 });
    let bon = await text();
    expect(connections).toBe(2); // zwei Ausdrucke
    expect(bon).toContain('Di Ruhetag');
    expect(bon).toContain('Telefon: 01234 56789');
    expect(bon.split('\n').every((l) => l.replace(/[\x00-\x1f].?/g, '').length <= 34)).toBe(true); // auf 32 Zeichen umbrochen

    await ok('POST', '/quickprint/print', admin, { id: 'wifi', copies: 1 });
    bon = await text();
    expect(bon).toContain('WIFI:T:WPA;S:Schuetzenhaus-Gast;P:willkommen-2031;;'); // Inhalt des QR-Codes
    expect(bon).toContain('\x1d(k\x03\x001Q0'); // QR-Code drucken
    expect(bon).toContain('Passwort: willkommen-2031');

    const user = session(await call('POST', '/auth/login', {}, { username: 'theke', password: 'sehr-geheim-789' }));
    expect((await call('POST', '/quickprint/templates', user, { title: 'Taxi', body: 'x', sort: 1 })).statusCode).toBe(403);
    const t = await ok('POST', '/quickprint/templates', admin, { title: 'Taxi', body: 'Taxi Muster: 01234 11111\nRund um die Uhr erreichbar.', sort: 1 });
    await ok('POST', '/quickprint/print', admin, { id: t.id, copies: 1 });
    expect(await text()).toContain('Taxi Muster: 01234 11111');
    const slip = (await ok('GET', '/quickprint', admin)).slips.find((x: { id: string }) => x.id === t.id);
    await ok('PUT', `/quickprint/templates/${t.id}`, admin, { title: 'Taxi', body: 'Neue Nummer 22222', sort: 1, version: slip.version });
    await ok('POST', '/quickprint/text', admin, { title: 'Weg zum Bahnhof', text: 'Links, dann 300 m geradeaus.', copies: 1 });
    expect(await text()).toContain('300 m geradeaus.');
    await ok('POST', `/quickprint/templates/${t.id}/remove`, admin);
    expect((await call('POST', '/quickprint/print', admin, { id: t.id, copies: 1 })).statusCode).toBe(404);
    expect((await call('POST', '/quickprint/print', admin, { id: 'info', copies: 9 })).statusCode).toBe(400);
    // Zettel „Ihr Aufenthalt“ und Website-QR aus den Hotel-Einstellungen
    const h2 = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...h2, breakfastTimes: 'täglich 7:00-10:00 Uhr', website: 'www.schuetzenhaus.example' });
    await ok('POST', '/quickprint/print', admin, { id: 'stay', copies: 1 });
    bon = await text();
    expect(bon).toContain('bis 11:00 Uhr');
    expect(bon).toContain('7:00-10:00 Uhr');
    await ok('POST', '/quickprint/print', admin, { id: 'web', copies: 1 });
    expect(await text()).toContain('https://www.schuetzenhaus.example');

    // Vorschläge: übernehmen, Platzhalter sperren den Druck bis zum Ausfüllen
    const sug = await ok('GET', '/quickprint/suggestions', admin);
    expect(sug.map((x: { key: string }) => x.key)).toEqual(expect.arrayContaining(['notfall', 'taxi', 'feiern']));
    expect((await call('POST', '/quickprint/suggestions', user, { keys: ['taxi'] })).statusCode).toBe(403);
    expect(await ok('POST', '/quickprint/suggestions', admin, { keys: ['notfall', 'feiern', 'gibt-es-nicht'] })).toEqual({ added: 2 });
    expect((await ok('GET', '/quickprint/suggestions', admin)).some((x: { key: string }) => x.key === 'notfall')).toBe(false);
    const all = (await ok('GET', '/quickprint', admin)).slips;
    const notfall = all.find((x: { title: string }) => x.title === 'Wichtige Rufnummern');
    const feiern = all.find((x: { title: string }) => x.title === 'Feiern bei uns');
    expect(notfall.hint).toContain('Platzhalter');
    expect((await call('POST', '/quickprint/print', admin, { id: notfall.id, copies: 1 })).json().error.code).toBe('slip_incomplete');
    await ok('POST', '/quickprint/print', admin, { id: feiern.id, copies: 1 });
    expect(await text()).toContain('Familienfeier');
    await ok('PUT', `/quickprint/templates/${notfall.id}`, admin, { title: notfall.title, body: 'Notruf: 112\nPolizei: 110\nApotheke am Markt: 01234 222', sort: notfall.sort, version: notfall.version });
    await ok('POST', '/quickprint/print', admin, { id: notfall.id, copies: 1 });
    expect(await text()).toContain('Apotheke am Markt');

    // Bewertungs-Zettel: erst mit Link druckbar, QR-Code führt zur Bewertungsseite
    expect((await call('POST', '/quickprint/print', admin, { id: 'review', copies: 1 })).json().error.code).toBe('slip_incomplete');
    expect((await call('PUT', '/quickprint/review', admin, { url: 'http://unsicher.example', headline: '', text: '', thanks: '' })).statusCode).toBe(400);
    expect((await call('PUT', '/quickprint/review', user, { url: 'https://g.page/r/abc/review', headline: '', text: '', thanks: '' })).statusCode).toBe(403);
    await ok('PUT', '/quickprint/review', admin, { url: 'https://g.page/r/abc/review', headline: '', text: '', thanks: '' });
    const rev = (await ok('GET', '/quickprint', admin)).slips.find((x: { id: string }) => x.id === 'review');
    expect(rev.review.headline).toBe('Hat es Ihnen gefallen?'); // leere Felder: Standardtext
    await ok('POST', '/quickprint/print', admin, { id: 'review', copies: 1 });
    bon = await text();
    expect(bon).toContain('https://g.page/r/abc/review');
    expect(bon).toContain('Hat es Ihnen');
    expect(bon).toMatch(/Bewertung bei[\s\S]{0,30}Google/); // auf 32 Zeichen umbrochen
    server.close();
    await new Promise((r) => setTimeout(r, 2200));
  }, 60_000);
});
