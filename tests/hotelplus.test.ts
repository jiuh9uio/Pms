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
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/** Absenderadresse der Anfragen – die öffentlichen Seiten erlauben 30 Aufrufe je Minute und Absender */
let clientIp = '127.0.0.1';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined, remoteAddress: clientIp });
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
async function bookingAt(from: string, to: string) {
  const b = await ok('POST', '/bookings', user, { guest: { ...GUEST, lastName: `Gast${n++}` }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: roomIds[0], from, to, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] });
  return b.id as string;
}
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

describe('Hotel: Optionsfrist, Vorschau, Statistik, doppelte Gäste', () => {
  const mk = async (g: object, from: string, to: string, extra: object = {}, status = 'confirmed') => (await ok('POST', '/bookings', user, {
    guest: { ...GUEST, ...g }, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: roomIds[0], from, to, adults: 2, children: 0, status, pricePerNightCents: null }], ...extra })).id as string;

  it('zeigt abgelaufene Optionen als Aufgabe, bis bestätigt oder storniert wird', async () => {
    const id = await mk({ lastName: 'Option' }, addDays(today, 20), addDays(today, 22), { optionUntil: addDays(today, -1) }, 'tentative');
    const fixed = await mk({ lastName: 'Fest' }, addDays(today, 30), addDays(today, 31), { optionUntil: addDays(today, -1) }); // bestätigt: Frist wird nicht gespeichert
    expect((await ok('GET', `/bookings/${id}`, user)).optionUntil).toBe(addDays(today, -1));
    expect((await ok('GET', `/bookings/${fixed}`, user)).optionUntil).toBeNull();
    let tasks = (await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].text).toContain('abgelaufen seit');
    expect(tasks[0].text).toContain('Option');
    // Frist verlängern: Aufgabe verschwindet
    const b = await ok('GET', `/bookings/${id}`, user);
    await ok('PATCH', `/bookings/${id}`, user, { optionUntil: addDays(today, 5), version: b.version });
    tasks = (await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option');
    expect(tasks).toHaveLength(0);
    await ok('PATCH', `/bookings/${id}`, user, { optionUntil: today, version: b.version + 1 });
    expect((await ok('GET', '/dashboard', user)).tasks.find((t: { kind: string }) => t.kind === 'option').text).toContain('läuft heute ab');
    // bestätigt: keine Aufgabe mehr
    const r = (await ok('GET', `/bookings/${id}`, user)).rooms[0];
    await ok('POST', `/booking-rooms/${r.id}/status`, user, { status: 'confirmed', version: r.version });
    expect((await ok('GET', '/dashboard', user)).tasks.filter((t: { kind: string }) => t.kind === 'option')).toHaveLength(0);
  });

  it('rechnet die Belegungsvorschau je Tag und Kategorie', async () => {
    const f = await ok('GET', `/reports/forecast?from=${addDays(today, 19)}&days=5`, user);
    expect(f.rooms).toBe(1);
    expect(f.categories).toEqual([expect.objectContaining({ name: 'Doppelzimmer', rooms: 1 })]);
    expect(f.days.map((d: { occupied: number; free: number; arrivals: number; departures: number }) => [d.occupied, d.free, d.arrivals, d.departures]))
      .toEqual([[0, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 1], [0, 1, 0, 0]]);
    expect(f.days[1]).toMatchObject({ occupancyPercent: 100, freeByCategory: [0] });
    await ok('POST', '/blocks', user, { roomId: roomIds[0], from: addDays(today, 23), to: addDays(today, 24), reason: 'Maler' });
    const g = await ok('GET', `/reports/forecast?from=${addDays(today, 23)}&days=1`, user);
    expect(g.days[0]).toMatchObject({ blocked: 1, free: 0, occupied: 0 });
    expect((await call('GET', `/reports/forecast?from=${today}&days=500`, user)).statusCode).toBe(400);
  });

  it('zählt Ankünfte und Übernachtungen nach Herkunftsland und Umsatz nach Buchungsquelle', async () => {
    await mk({ lastName: 'Jansen', country: 'Niederlande' }, '2036-03-30', '2036-04-02', { source: 'Booking.com' }); // 2 Nächte im März, 1 im April, 2 Personen
    await mk({ lastName: 'Meier', country: '' }, '2036-03-10', '2036-03-11');
    const mar = await ok('GET', '/reports/origin?year=2036&month=3', user);
    expect(mar.rows).toEqual([{ country: 'Niederlande', arrivals: 2, nights: 4 }, { country: 'ohne Angabe', arrivals: 2, nights: 2 }]);
    expect(mar.total).toEqual({ arrivals: 4, nights: 6 });
    expect(mar).toMatchObject({ beds: 2, openDays: 31 });
    const apr = await ok('GET', '/reports/origin?year=2036&month=4', user);
    expect(apr.rows).toEqual([{ country: 'Niederlande', arrivals: 0, nights: 2 }]); // Ankunft zählt im März
    const src = await ok('GET', '/reports/sources?year=2036', user);
    expect(src.rows).toEqual([{ source: 'Booking.com', bookings: 1, nights: 3, lodgingCents: 29700 }, { source: 'Telefon', bookings: 1, nights: 1, lodgingCents: 9900 }]);
  });

  it('findet doppelte Gäste und führt sie zusammen – nur der Administrator', async () => {
    const a = await mk({ firstName: 'Doris', lastName: 'Doppelt', email: 'doris@example.com', phone: '' }, '2037-01-10', '2037-01-11');
    const b = await mk({ firstName: 'Doris', lastName: 'doppelt ', email: '', phone: '0171 999' }, '2037-02-10', '2037-02-11');
    await mk({ firstName: 'Doris', lastName: 'Doppelt', email: '', phone: '' }, '2037-03-10', '2037-03-11');
    expect((await call('GET', '/guests/duplicates', user)).statusCode).toBe(403);
    const dups = (await ok('GET', '/guests/duplicates', admin)).filter((d: { keep: { firstName: string } }) => d.keep.firstName === 'Doris');
    expect(dups.length).toBeGreaterThanOrEqual(2);
    expect(dups[0].reason).toBe('gleicher Name');
    const ga = (await ok('GET', `/bookings/${a}`, user)).guest, gb = (await ok('GET', `/bookings/${b}`, user)).guest;
    expect((await call('POST', `/guests/${ga.id}/merge`, user, { otherId: gb.id })).statusCode).toBe(403);
    expect((await call('POST', `/guests/${ga.id}/merge`, admin, { otherId: ga.id })).statusCode).toBe(409);
    expect(await ok('POST', `/guests/${ga.id}/merge`, admin, { otherId: gb.id })).toEqual({ ok: true, bookingsMoved: 1 });
    const merged = (await ok('GET', `/bookings/${b}`, user)).guest;
    expect(merged).toMatchObject({ id: ga.id, email: 'doris@example.com', phone: '0171 999' }); // leere Felder ergänzt
    expect((await call('GET', `/guests/${gb.id}`, user)).statusCode).toBe(404);
    expect((await ok('GET', `/guests/${ga.id}`, user)).bookings.length).toBe(2);
  });

  it('zeigt dem Gast über seinen Link die Reservierung, nimmt die Ankunftszeit an und lässt nach den Bedingungen stornieren', async () => {
    const policy = { enabled: true, freeDays: 3, feePercent: 80, online: true, onlineLate: false, publicUrl: '', extraText: '' };
    expect((await call('PUT', '/settings/cancel-policy', user, policy)).statusCode).toBe(403);
    const far = await mk({ firstName: 'Lea', lastName: 'Link' }, addDays(today, 40), addDays(today, 42));
    const near = await mk({ firstName: 'Nah', lastName: 'Dran' }, addDays(today, 2), addDays(today, 3));
    const link = await ok('GET', `/bookings/${far}/guest-link`, user);
    expect(link.url).toMatch(/\/buchung\/[0-9a-f]{32}\.[A-Za-z0-9_-]{32}$/);
    expect(link.qr).toContain('data:image/png');
    const tok = (u: string) => u.split('/buchung/')[1]!;
    const t = tok(link.url);
    // gefälschter oder fremder Link
    expect((await call('GET', `/public/booking/${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`, {})).statusCode).toBe(404);
    expect((await call('GET', `/public/booking/${'0'.repeat(32)}.${t.split('.')[1]}`, {})).statusCode).toBe(404);

    // der Link allein zeigt nichts – erst Nachname und Postleitzahl öffnen die Reservierung
    expect(await ok('GET', `/public/booking/${t}`, {})).toEqual({ hotelName: 'Hotel & Restaurant Schützenhaus', hotelPhone: '', needsZip: true });
    const lea = { lastName: ' link ', zip: '11111' }, nah = { lastName: 'Dran', zip: '11111' };
    expect((await call('POST', `/public/booking/${t}/open`, {}, { lastName: 'Falsch', zip: '11111' })).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${t}/open`, {}, { lastName: 'Link', zip: '99999' })).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${t}/arrival`, {}, { lastName: 'Falsch', zip: '', time: '10:00', message: '' })).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${t}/cancel`, {}, { lastName: 'Falsch', zip: '', confirm: true })).statusCode).toBe(403);
    const open = (tk: string, c: object) => ok('POST', `/public/booking/${tk}/open`, {}, c);

    // ohne eingeschaltete Bedingungen: ansehen ja, stornieren nein
    let pub = await open(t, lea); // Groß-/Kleinschreibung und Leerzeichen sind egal
    expect(pub).toMatchObject({ guestName: 'Lea Link', state: 'active', totalCents: 19800, canCancel: false, from: addDays(today, 40) });
    expect(pub.cancelHint).toContain('rufen Sie uns bitte an');
    expect(JSON.stringify(pub)).not.toContain('Weg 1'); // keine Anschrift, keine Ausweisdaten
    expect((await call('POST', `/public/booking/${t}/cancel`, {}, { ...lea, confirm: true })).statusCode).toBe(409);

    // Ankunftszeit mitteilen: steht in der Reservierung und im Übergabebuch
    expect((await call('POST', `/public/booking/${t}/arrival`, {}, { ...lea, time: '25:00', message: '' })).statusCode).toBe(400);
    await ok('POST', `/public/booking/${t}/arrival`, {}, { ...lea, time: '21:30', message: 'Wir kommen mit dem Zug.' });
    expect(await ok('GET', `/bookings/${far}`, user)).toMatchObject({ arrivalTime: '21:30', guestMessage: 'Wir kommen mit dem Zug.' });
    expect((await ok('GET', '/team/notes', user))[0].text).toContain('Ankunft voraussichtlich 21:30 Uhr');

    // Bedingungen einschalten
    await ok('PUT', '/settings/cancel-policy', admin, policy);
    pub = await open(t, lea);
    expect(pub.terms).toMatchObject({ enabled: true, free: true, freeUntil: addDays(today, 37), feeCents: 0, feePercent: 80 });
    expect(pub.canCancel).toBe(true);
    expect(await ok('GET', `/bookings/${far}/cancel-terms`, user)).toMatchObject({ free: true, freeUntil: addDays(today, 37) });
    // nach der Frist: online nur, wenn ausdrücklich erlaubt – dann mit Ausfallgebühr als Meldung, nicht als Buchung
    const tn = tok((await ok('GET', `/bookings/${near}/guest-link`, user)).url);
    let late = await open(tn, nah);
    expect(late.terms).toMatchObject({ free: false, feeCents: 7920 }); // 80 % von 99 €
    expect(late.canCancel).toBe(false);
    expect((await call('POST', `/public/booking/${tn}/cancel`, {}, { ...nah, confirm: true })).statusCode).toBe(409);
    await ok('PUT', '/settings/cancel-policy', admin, { ...policy, onlineLate: true });
    expect((await call('POST', `/public/booking/${tn}/cancel`, {}, nah)).statusCode).toBe(400); // ohne Bestätigung
    late = await ok('POST', `/public/booking/${tn}/cancel`, {}, { ...nah, confirm: true });
    expect(late).toMatchObject({ state: 'cancelled', canCancel: false });
    const nb = await ok('GET', `/bookings/${near}`, user);
    expect(nb.rooms[0].status).toBe('cancelled');
    expect(nb.notes).toContain('Ausfallgebühr laut Bedingungen: 79,20 €');
    expect(nb.charges).toHaveLength(0); // nichts automatisch berechnet
    expect((await ok('GET', '/team/notes', user))[0].text).toContain('Storno durch den Gast');
    // das Zimmer ist wieder frei
    expect((await ok('GET', `/availability?from=${addDays(today, 2)}&to=${addDays(today, 3)}`, user)).length).toBe(1);

    // kostenfrei innerhalb der Frist
    const done = await ok('POST', `/public/booking/${t}/cancel`, {}, { ...lea, confirm: true });
    expect(done.state).toBe('cancelled');
    expect((await ok('GET', `/bookings/${far}`, user)).notes).toContain('Kostenfrei innerhalb der Frist');
    expect((await call('POST', `/public/booking/${t}/cancel`, {}, { ...lea, confirm: true })).statusCode).toBe(409); // nicht doppelt
    expect((await call('POST', `/public/booking/${t}/arrival`, {}, { ...lea, time: '10:00', message: '' })).statusCode).toBe(409);

    // Gast ohne hinterlegte Postleitzahl: der Nachname genügt; nach acht falschen Eingaben ist der Link eine Weile gesperrt
    const noZip = await mk({ firstName: 'Ole', lastName: 'Müller-Groß', zip: '' }, addDays(today, 70), addDays(today, 71));
    const tz = tok((await ok('GET', `/bookings/${noZip}/guest-link`, user)).url);
    expect((await ok('GET', `/public/booking/${tz}`, {})).needsZip).toBe(false);
    expect((await open(tz, { lastName: 'mueller gross', zip: '' })).guestName).toBe('Ole Müller-Groß'); // ausgeschriebene Umlaute gelten
    expect((await open(tz, { lastName: 'MULLER-GROSS', zip: 'egal' })).guestName).toBe('Ole Müller-Groß'); // Umlaute und Bindestrich großzügig
    for (let i = 0; i < 8; i++) expect((await call('POST', `/public/booking/${tz}/open`, {}, { lastName: 'Falsch', zip: '' })).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${tz}/open`, {}, { lastName: 'Müller-Groß', zip: '' })).statusCode).toBe(429);
  });

  it('nimmt Bedingungen und – mit Internetadresse – den Link in die Bestätigung auf', async () => {
    const id = await mk({ firstName: 'Mia', lastName: 'Mail', email: 'mia@example.com' }, addDays(today, 60), addDays(today, 61));
    let d = await ok('GET', `/bookings/${id}/mail`, user);
    expect(d.text).toContain('Kostenfreie Stornierung bis einschließlich');
    expect(d.text).toContain('80 % des Zimmerpreises');
    expect(d.text).not.toContain('/buchung/'); // ohne Adresse im Internet kein Link in der E-Mail
    expect((await call('PUT', '/settings/cancel-policy', admin, { enabled: true, freeDays: 3, feePercent: 80, online: true, onlineLate: false, publicUrl: 'hotel', extraText: '' })).statusCode).toBe(400);
    await ok('PUT', '/settings/cancel-policy', admin, { enabled: true, freeDays: 3, feePercent: 80, online: true, onlineLate: false, publicUrl: 'https://hotel.example.de/', extraText: '' });
    d = await ok('GET', `/bookings/${id}/mail`, user);
    expect(d.text).toMatch(/stornieren: https:\/\/hotel\.example\.de\/buchung\/[0-9a-f]{32}\./);
    expect((await ok('GET', `/bookings/${id}/guest-link`, user))).toMatchObject({ localOnly: false });
  });

  it('lässt den Gäste-Link sperren und neu ausstellen und zeigt nur, was eingestellt ist', async () => {
    clientIp = '10.0.0.7'; // eigener Absender, damit die Begrenzung der vorigen Tests nicht greift
    const policy = { enabled: true, freeDays: 3, feePercent: 80, online: true, onlineLate: false, publicUrl: '', extraText: '' };
    await ok('PUT', '/settings/cancel-policy', admin, { ...policy, showPrice: false, allowArrival: false, welcome: 'Schön, dass Sie kommen.' });
    const id = await mk({ firstName: 'Kai', lastName: 'Konfig', email: 'kai@example.com' }, addDays(today, 90), addDays(today, 91));
    const cred = { lastName: 'Konfig', zip: '11111' };
    const tok = (u: string) => u.split('/buchung/')[1]!;
    const first = await ok('GET', `/bookings/${id}/guest-link`, user);
    expect(first).toMatchObject({ blocked: false, version: 0, needsZip: true, guestEmail: 'kai@example.com' });
    const t1 = tok(first.url);
    // Anzeige nach Einstellung: kein Betrag, keine Ankunftszeit, Begrüßung
    const pub = await ok('POST', `/public/booking/${t1}/open`, {}, cred);
    expect(pub).toMatchObject({ totalCents: null, canArrival: false, welcome: 'Schön, dass Sie kommen.', canCancel: true });
    expect((await call('POST', `/public/booking/${t1}/arrival`, {}, { ...cred, time: '18:00', message: '' })).statusCode).toBe(409);
    // sperren: nichts geht mehr, auch nicht die Eingabeseite
    expect((await call('POST', `/bookings/${id}/guest-link`, user, { action: 'kaputt' })).statusCode).toBe(400);
    await ok('POST', `/bookings/${id}/guest-link`, user, { action: 'block' });
    expect((await ok('GET', `/bookings/${id}/guest-link`, user)).blocked).toBe(true);
    expect((await call('GET', `/public/booking/${t1}`, {})).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${t1}/open`, {}, cred)).statusCode).toBe(403);
    expect((await call('POST', `/public/booking/${t1}/cancel`, {}, { ...cred, confirm: true })).statusCode).toBe(403);
    await ok('POST', `/bookings/${id}/guest-link`, user, { action: 'unblock' });
    expect((await ok('POST', `/public/booking/${t1}/open`, {}, cred)).state).toBe('active');
    // neu ausstellen: der alte Link ist endgültig ungültig, der neue gilt
    await ok('POST', `/bookings/${id}/guest-link`, user, { action: 'renew' });
    const second = await ok('GET', `/bookings/${id}/guest-link`, user);
    expect(second.version).toBe(1);
    expect(tok(second.url)).not.toBe(t1);
    expect((await call('GET', `/public/booking/${t1}`, {})).statusCode).toBe(404);
    expect((await ok('POST', `/public/booking/${tok(second.url)}/open`, {}, cred)).guestName).toBe('Kai Konfig');
    // E-Mail mit dem Link: Vorschlag enthält die aktuelle Adresse und den Hinweis auf Name und Postleitzahl
    const draft = await ok('GET', `/bookings/${id}/guest-link/mail`, user);
    expect(draft).toMatchObject({ to: 'kai@example.com' });
    expect(draft.text).toContain(second.url);
    expect(draft.text).toContain('Ihren Nachnamen und Ihre Postleitzahl');
    const log = await db.execute(sql`select action from audit_log where action like 'guest_link_%' order by id`);
    expect(log.map((r) => r.action)).toEqual(['guest_link_block', 'guest_link_unblock', 'guest_link_renew']);
  });

  it('verweist auf die digitale Gästemappe: Bon-Zettel, E-Mails, Seite des Gastes', async () => {
    clientIp = '10.0.0.8';
    const guide = { enabled: true, provider: 'gastfreund', label: 'Digitale Gästemappe', url: 'https://mappe.example.org/schuetzenhaus', text: 'Alles rund um Ihren Aufenthalt.', inMails: true, onGuestPage: true };
    expect((await call('PUT', '/settings/guest-guide', user, guide)).statusCode).toBe(403);
    expect((await call('PUT', '/settings/guest-guide', admin, { ...guide, url: '' })).statusCode).toBe(400); // eingeschaltet ohne Adresse
    expect((await call('PUT', '/settings/guest-guide', admin, { ...guide, url: 'mappe' })).statusCode).toBe(400);
    const id = await mk({ firstName: 'Gabi', lastName: 'Mappe', email: 'gabi@example.com' }, addDays(today, 95), addDays(today, 96));
    const tok = (await ok('GET', `/bookings/${id}/guest-link`, user)).url.split('/buchung/')[1]!;
    const cred = { lastName: 'Mappe', zip: '11111' };
    // ohne Einrichtung: nirgends ein Verweis
    expect((await ok('GET', `/bookings/${id}/mail`, user)).text).not.toContain('Gästemappe');
    expect((await ok('POST', `/public/booking/${tok}/open`, {}, cred)).guide).toBeNull();
    await ok('PUT', '/settings/guest-guide', admin, guide);
    const mail = (await ok('GET', `/bookings/${id}/mail`, user)).text;
    expect(mail).toContain('Digitale Gästemappe: https://mappe.example.org/schuetzenhaus');
    expect(mail).toContain('Alles rund um Ihren Aufenthalt.');
    expect((await ok('POST', `/public/booking/${tok}/open`, {}, cred)).guide).toEqual({ label: 'Digitale Gästemappe', url: 'https://mappe.example.org/schuetzenhaus', text: 'Alles rund um Ihren Aufenthalt.' });
    // einzeln abschaltbar
    await ok('PUT', '/settings/guest-guide', admin, { ...guide, inMails: false, onGuestPage: false });
    expect((await ok('GET', `/bookings/${id}/mail`, user)).text).not.toContain('mappe.example.org');
    expect((await ok('POST', `/public/booking/${tok}/open`, {}, cred)).guide).toBeNull();
  });

  it('schlägt Firmendaten aus dem Impressum und über die Ortssuche vor – und ruft nichts aus dem eigenen Netz ab', async () => {
    const { createServer } = await import('node:http');
    const { setLookupTest } = await import('../src/server/modules/lookup.js');
    const seen: string[] = [];
    const site = createServer((req, res) => {
      seen.push(`${req.url} ${req.headers['user-agent']}`);
      if (req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<html><body><h1>Willkommen</h1><footer><a href="/impressum">Impressum</a></footer></body></html>'); }
      else if (req.url === '/impressum') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<h1>Impressum</h1><p>Muster Bau GmbH<br>Industriestr. 5<br>54321 Beispielstadt</p><p>Tel.: 030 1234567</p><p>USt-IdNr.: DE123456789</p>'); }
      else if (req.url!.startsWith('/search')) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify([
        { name: 'Bäckerei Krume', display_name: 'Bäckerei Krume, Hauptstraße 2, Musterstadt', address: { road: 'Hauptstraße', house_number: '2', postcode: '12345', town: 'Musterstadt', country: 'Deutschland' }, extratags: { phone: '+49 30 55555' } },
        { name: 'Ohne Straße', display_name: 'x', address: { postcode: '12345', town: 'Musterstadt' }, extratags: null }])); }
      else { res.writeHead(404); res.end('nichts'); }
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
    const port = (site.address() as { port: number }).port;
    // Schutz: Adressen im eigenen Netz werden abgelehnt
    const blocked = await call('POST', '/companies/lookup/imprint', user, { url: `http://127.0.0.1:${port}/` });
    expect(blocked.statusCode).toBe(502);
    expect(blocked.body).toContain('eigenen Netz');
    expect((await call('POST', '/companies/lookup/imprint', user, { url: 'file:///etc/passwd' })).statusCode).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(0);
    setLookupTest({ allowPrivate: true, searchBase: `http://127.0.0.1:${port}/search` });
    const r = await ok('POST', '/companies/lookup/imprint', user, { url: `http://127.0.0.1:${port}/` });
    expect(r.page).toBe(`http://127.0.0.1:${port}/impressum`); // dem Link „Impressum“ gefolgt
    expect(r.found).toMatchObject({ name: 'Muster Bau GmbH', street: 'Industriestr. 5', zip: '54321', city: 'Beispielstadt', phone: '030 1234567', vatId: 'DE123456789' });
    expect((await call('POST', '/companies/lookup/imprint', user, { url: `http://127.0.0.1:${port}/leer` })).statusCode).toBe(502);
    const places = await ok('GET', '/companies/lookup/search?q=B%C3%A4ckerei%20Krume%20Musterstadt', user);
    expect(places).toEqual([{ name: 'Bäckerei Krume', street: 'Hauptstraße 2', zip: '12345', city: 'Musterstadt', country: 'Deutschland', phone: '+49 30 55555', email: '', vatId: '', source: 'OpenStreetMap', label: 'Bäckerei Krume, Hauptstraße 2, Musterstadt' }]);
    expect(seen.at(-1)).toContain('SchuetzenhausPMS');
    expect(seen.at(-1)).toContain('q=B%C3%A4ckerei');
    expect((await call('GET', '/companies/lookup/search?q=ab', user)).statusCode).toBe(400);
    setLookupTest({ allowPrivate: false, searchBase: 'https://nominatim.openstreetmap.org/search' });
    site.close();
  });

  it('meldet Änderungen für das gleichzeitige Arbeiten', async () => {
    expect((await call('GET', '/sync', {})).statusCode).toBe(401);
    const before = (await ok('GET', '/sync', user)).rev;
    expect((await ok('GET', '/sync', user)).rev).toBe(before); // ohne Änderung gleich
    await ok('POST', '/team/notes', admin, { kind: 'note', text: 'Test', place: '', dueDate: '' });
    expect((await ok('GET', '/sync', user)).rev).toBeGreaterThan(before); // Änderung eines anderen Benutzers
  });

  it('führt eine Start-Checkliste und lässt die erste Rechnungsnummer festlegen', async () => {
    expect((await call('GET', '/setup/checklist', user)).statusCode).toBe(403);
    const c = await ok('GET', '/setup/checklist', admin);
    const item = (k: string) => c.groups.flatMap((g: { items: { key: string }[] }) => g.items).find((x: { key: string }) => x.key === k);
    expect(item('house')).toMatchObject({ state: 'todo' }); // Telefon fehlt im Testhaus
    expect(item('house').detail).toContain('Telefon');
    expect(item('rooms')).toMatchObject({ state: 'done' });
    expect(item('tax').state).toBe('done');
    expect(item('terminal').state).toBe('optional');
    expect(item('policy').state).toBe('done');
    expect(c.ready).toBe(false);
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, phone: '01234 5678' });
    const c2 = await ok('GET', '/setup/checklist', admin);
    expect(c2.groups[0].items.find((x: { key: string }) => x.key === 'house').state).toBe('done');
    expect(c2).toMatchObject({ ready: true, open: 0 }); // ohne eingebaute Sicherung (Tests) zählt sie nicht als fehlend

    // Rechnungsnummern: Anschluss an bisherige Nummern, nur nach oben
    const year = Number(today.slice(0, 4));
    const st = await ok('GET', `/settings/invoice-number?year=${year}`, admin);
    expect(st).toMatchObject({ year, next: 1, issued: 0 });
    expect(st.sample).toMatch(new RegExp(`${year}-0001$`));
    expect((await call('PUT', '/settings/invoice-number', user, { year, next: 120 })).statusCode).toBe(403);
    expect((await ok('PUT', '/settings/invoice-number', admin, { year, next: 120 })).sample).toMatch(/-0120$/);
    expect((await call('PUT', '/settings/invoice-number', admin, { year, next: 50 })).statusCode).toBe(409);
    const b = await mk({ lastName: 'Nummer' }, addDays(today, 100), addDays(today, 101));
    const inv = await issue(b);
    expect(inv.number).toMatch(new RegExp(`${year}-0120$`));
    expect((await issue(await mk({ lastName: 'Nummer2' }, addDays(today, 102), addDays(today, 103)))).number).toMatch(/-0121$/);
    expect(await ok('GET', `/settings/invoice-number?year=${year}`, admin)).toMatchObject({ next: 122, issued: 121 });
  });

  it('speichert das Rechnungslayout und liefert eine Muster-Rechnung als Vorschau', async () => {
    expect(await ok('GET', '/settings/invoice-layout', admin)).toEqual({ spacing: 'normal', fontSize: 'normal', intro: '', closing: '', style: 'classic', accent: 'black', font: 'sans', logoPos: 'right', table: 'lines' });
    expect((await call('PUT', '/settings/invoice-layout', user, { spacing: 'wide' })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/invoice-layout', admin, { spacing: 'riesig' })).statusCode).toBe(400);
    expect((await call('PUT', '/settings/invoice-layout', admin, { accent: 'pink' })).statusCode).toBe(400);
    const sizes: number[] = [];
    for (const q of ['spacing=compact&fontSize=small', 'spacing=wide&fontSize=large&intro=Vielen%20Dank&closing=Bis%20bald', 'style=modern&accent=blue&table=stripes&logoPos=left', 'style=elegant&accent=gold&font=serif&logoPos=center&table=plain']) {
      const r = await call('GET', `/settings/invoice-layout/preview?${q}`, admin);
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
      sizes.push(r.rawPayload.length);
    }
    expect(sizes[0]).not.toBe(sizes[1]);
    expect(await ok('PUT', '/settings/invoice-layout', admin, { spacing: 'wide', fontSize: 'large', intro: 'Vielen Dank', closing: '', style: 'elegant', accent: 'green', font: 'serif', logoPos: 'center', table: 'stripes' })).toMatchObject({ spacing: 'wide', intro: 'Vielen Dank' });
    // eine echte Rechnung lässt sich im neuen Layout erzeugen
    const inv = await issue(await mk({ lastName: 'Layout' }, addDays(today, 110), addDays(today, 112)));
    const pdf = await call('GET', `/invoices/${inv.id}/pdf`, admin);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('liefert die Datei, die das PMS als Programm-Symbol einrichtet', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/desktop-shortcut.bat', headers: { host: '192.168.178.20:3000' }, remoteAddress: '10.9.9.1' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('.bat');
    expect(r.body).toContain('set "URL=http://192.168.178.20:3000/"');
    expect(r.body).toContain("'--app=' + $env:URL");
    expect(r.body.split('\r\n').length).toBeGreaterThan(20); // Windows-Zeilenenden
    expect(r.body).not.toMatch(/[^\x00-\x7f]/); // nur ASCII, damit die Eingabeaufforderung nichts verstümmelt
    // eine untergeschobene Adresse mit Sonderzeichen wird nicht in die Datei geschrieben
    expect((await app.inject({ method: 'GET', url: '/api/v1/desktop-shortcut.bat', headers: { host: 'x" & calc & "' }, remoteAddress: '10.9.9.1' })).statusCode).toBe(400);
  });

  it('speichert, welche Mitteilungen das Programm von sich aus zeigt', async () => {
    const all = await ok('GET', '/settings/notices', user);
    expect(all).toEqual({ hygieneTemp: true, hygieneClean: true, netAlert: true, mailCount: true, teamCount: true, backupWarn: true, updateHint: true, setupHint: true });
    expect((await call('PUT', '/settings/notices', user, all)).statusCode).toBe(403);
    expect((await call('PUT', '/settings/notices', admin, { hygieneTemp: false })).statusCode).toBe(400); // immer alle Schalter
    await ok('PUT', '/settings/notices', admin, { ...all, hygieneClean: false, teamCount: false });
    expect(await ok('GET', '/settings/notices', user)).toMatchObject({ hygieneTemp: true, hygieneClean: false, teamCount: false, backupWarn: true });
  });

  it('schützt die Anmeldung mit einem zweiten Faktor (Code aus der Authenticator-App)', async () => {
    const { codeAt, stepOf, verifyCode, base32, fromBase32 } = await import('../src/server/lib/totp.js');
    // Prüfwert aus RFC 6238 (SHA-1, Zeit 59 s → 94287082, sechs Stellen: 287082)
    const rfc = base32(Buffer.from('12345678901234567890'));
    expect(codeAt(rfc, 1)).toBe('287082');
    expect(fromBase32(rfc).toString()).toBe('12345678901234567890');
    expect(verifyCode(rfc, '287082', 59_000)).toBe(1);
    expect(verifyCode(rfc, '000000', 59_000)).toBeNull();

    await ok('POST', '/users', admin, { username: 'zweifaktor', name: 'Zwei Faktor', password: 'ganz-geheim-123', role: 'user', modules: ['hotel'] });
    const login = (body: object) => app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'zweifaktor', password: 'ganz-geheim-123', ...body } });
    const me = { pms_session: (await login({})).cookies.find((c) => c.name === 'pms_session')!.value };
    const setup = await ok('POST', '/auth/totp/begin', me, {});
    expect(setup.qr).toMatch(/^data:image\/png/);
    // noch nicht bestätigt: Anmeldung weiter ohne Code
    expect((await login({})).statusCode).toBe(200);
    expect((await call('POST', '/auth/totp/confirm', me, { code: '000000' })).statusCode).toBe(400);
    await ok('POST', '/auth/totp/confirm', me, { code: codeAt(setup.secret, stepOf() - 1) });
    expect((await ok('GET', '/auth/state', me)).user.twoFactor).toBe(true);
    const stored = await db.execute(sql`select totp_secret_enc as s from users where username = 'zweifaktor'`);
    expect(String(stored[0]!.s)).not.toContain(setup.secret); // Geheimnis nur verschlüsselt

    const need = await login({});
    expect(need.statusCode).toBe(401);
    expect(need.json().error.code).toBe('totp_required');
    expect(need.cookies.find((c) => c.name === 'pms_session')).toBeUndefined();
    expect((await login({ code: '123456' })).json().error.code).toBe('totp_invalid');
    const good = codeAt(setup.secret, stepOf());
    expect((await login({ code: good })).statusCode).toBe(200);
    expect((await login({ code: good })).json().error.code).toBe('totp_invalid'); // derselbe Code gilt nicht zweimal
    // falsches Passwort verrät nicht, ob ein zweiter Faktor eingerichtet ist
    expect((await login({ password: 'falsch-falsch-1' })).json().error.code).not.toBe('totp_required');

    // ausschalten nur mit Passwort; Administrator kann aufheben
    expect((await call('POST', '/auth/totp/disable', me, { password: 'falsch' })).statusCode).toBe(400);
    const id = (await ok('GET', '/users', admin)).find((u: { username: string }) => u.username === 'zweifaktor').id;
    expect((await call('POST', `/users/${id}/totp-reset`, user, {})).statusCode).toBe(403);
    expect((await ok('POST', `/users/${id}/totp-reset`, admin, {})).twoFactor).toBe(false);
    expect((await login({})).statusCode).toBe(200);

    // Administrator richtet sie über die Benutzerverwaltung ein
    expect((await call('POST', `/users/${id}/totp/begin`, user, {})).statusCode).toBe(403);
    const byAdmin = await ok('POST', `/users/${id}/totp/begin`, admin, {});
    expect(byAdmin.account).toBe('zweifaktor');
    expect((await call('POST', `/users/${id}/totp/confirm`, admin, { code: '000000' })).statusCode).toBe(400);
    expect((await ok('POST', `/users/${id}/totp/confirm`, admin, { code: codeAt(byAdmin.secret, stepOf()) })).ok).toBe(true);
    expect((await ok('GET', '/users', admin)).find((u: { id: string }) => u.id === id).twoFactor).toBe(true);
    expect((await login({})).json().error.code).toBe('totp_required');
    expect((await login({ code: codeAt(byAdmin.secret, stepOf() + 1) })).statusCode).toBe(200);
    await ok('POST', `/users/${id}/totp-reset`, admin, {});

    // automatisches Abmelden: Einstellung
    expect(await ok('GET', '/settings/security', user)).toEqual({ idleMinutes: 0 });
    expect((await call('PUT', '/settings/security', user, { idleMinutes: 15 })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/security', admin, { idleMinutes: 2 })).statusCode).toBe(400);
    expect(await ok('PUT', '/settings/security', admin, { idleMinutes: 15 })).toEqual({ idleMinutes: 15 });
    await ok('PUT', '/settings/security', admin, { idleMinutes: 0 });
  });

  it('zeigt Gästen eine öffentliche Seite mit Zimmern, Verfügbarkeit und Anfrage', async () => {
    clientIp = '10.7.7.7';
    const anon = {};
    const catId = (await ok('GET', '/categories', admin))[0].id as string;
    // noch nicht freigeschaltet: nichts verraten, auch keine Kategorien
    const off = await ok('GET', '/public/site', anon);
    expect(off).toMatchObject({ enabled: false, preview: false, categories: [] });
    expect(off.hotel.street).toBe('');
    expect((await call('GET', `/public/site/availability?from=${addDays(today, 200)}&to=${addDays(today, 202)}&adults=2`, anon)).statusCode).toBe(409);
    expect((await ok('GET', '/auth/state', anon)).guestHome).toBe(false);
    // Einstellungen nur für den Administrator; Adressen müssen vollständig sein
    const base = { enabled: false, homepage: false, headline: 'Schlafen am Schützenplatz', intro: 'Ruhig gelegen.', highlights: 'WLAN\n\nParkplatz', showPrices: true, imprintUrl: '', privacyUrl: '', categories: { [catId]: { show: true, text: 'Mit Blick ins Grüne' } } };
    expect((await call('PUT', '/settings/site', user, base)).statusCode).toBe(403);
    expect((await call('PUT', '/settings/site', admin, { ...base, imprintUrl: 'impressum' })).statusCode).toBe(400);
    await ok('PUT', '/settings/site', admin, base);
    // Vorschau für den angemeldeten Administrator
    expect(await ok('GET', '/public/site', admin)).toMatchObject({ preview: true, headline: 'Schlafen am Schützenplatz', highlights: ['WLAN', 'Parkplatz'], categories: [{ id: catId, text: 'Mit Blick ins Grüne', fromPriceCents: 9900, hasPhoto: false }] });
    expect((await ok('GET', '/public/site', user)).preview).toBe(false);

    await ok('PUT', '/settings/site', admin, { ...base, enabled: true, homepage: true });
    const pub = await ok('GET', '/public/site', anon);
    expect(pub).toMatchObject({ enabled: true, preview: false, hotel: { street: 'Am Schützenplatz 1' } });
    expect(JSON.stringify(pub)).not.toMatch(/iban|taxNumber|DE00/i); // keine internen Angaben
    expect((await ok('GET', '/auth/state', anon)).guestHome).toBe(true);
    // Verfügbarkeit: frei mit Preis, belegt, zu viele Personen, ungültige Zeiträume
    const from = addDays(today, 300), to = addDays(today, 302);
    expect(await ok('GET', `/public/site/availability?from=${from}&to=${to}&adults=2`, anon)).toEqual({ nights: 2, categories: [{ id: catId, available: true, totalCents: 19800 }] });
    expect((await ok('GET', `/public/site/availability?from=${from}&to=${to}&adults=3`, anon)).categories[0].available).toBe(false);
    await bookingAt(from, to);
    expect((await ok('GET', `/public/site/availability?from=${from}&to=${to}&adults=2`, anon)).categories[0]).toEqual({ id: catId, available: false, totalCents: null });
    expect((await call('GET', `/public/site/availability?from=${addDays(today, -1)}&to=${today}&adults=2`, anon)).statusCode).toBe(400);
    expect((await call('GET', `/public/site/availability?from=${from}&to=${addDays(from, 40)}&adults=2`, anon)).statusCode).toBe(400);
    // ohne Preise: nur frei/belegt
    await ok('PUT', '/settings/site', admin, { ...base, enabled: true, showPrices: false });
    expect((await ok('GET', `/public/site/availability?from=${addDays(today, 320)}&to=${addDays(today, 321)}&adults=1`, anon)).categories[0]).toEqual({ id: catId, available: true, totalCents: null });
    expect((await ok('GET', '/public/site', anon)).categories[0].fromPriceCents).toBeNull();

    // Foto: nur gültige Bilder, öffentlich nur für freigegebene Kategorien
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ee0000000049454e44ae426082', 'hex');
    expect((await call('PUT', `/categories/${catId}/photo`, user, { mime: 'image/png', dataBase64: png.toString('base64') })).statusCode).toBe(403);
    expect((await call('PUT', `/categories/${catId}/photo`, admin, { mime: 'image/jpeg', dataBase64: png.toString('base64') })).statusCode).toBe(400);
    await ok('PUT', `/categories/${catId}/photo`, admin, { mime: 'image/png', dataBase64: png.toString('base64') });
    const photo = await call('GET', `/public/site/photo/${catId}`, anon);
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect((await ok('GET', '/public/site', anon)).categories[0].hasPhoto).toBe(true);
    await ok('PUT', '/settings/site', admin, { ...base, enabled: true, categories: { [catId]: { show: false, text: '' } } });
    expect((await call('GET', `/public/site/photo/${catId}`, anon)).statusCode).toBe(404);
    expect((await ok('GET', '/public/site', anon)).categories).toEqual([]);

    // Bereiche, Öffnungszeiten, Fragen und Bilder der Seite
    const full = await ok('GET', '/settings/site', admin);
    expect(full.sections.restaurant).toMatchObject({ show: true, title: 'Mit Zeit genießen.' }); // Vorschlagstexte für ältere Stände
    await ok('PUT', '/settings/site', admin, { ...full, enabled: true, hours: 'Mittwoch – Samstag | 17:00 – 22:00 Uhr\nSonntag | Ruhetag', faq: 'Wie reserviere ich?\nBitte anrufen.\n\nOhne Antwort', sections: { ...full.sections, vouchers: { ...full.sections.vouchers, show: false } } });
    const pub2 = await ok('GET', '/public/site', anon);
    expect(pub2.hours).toEqual([{ label: 'Mittwoch – Samstag', value: '17:00 – 22:00 Uhr' }, { label: 'Sonntag', value: 'Ruhetag' }]);
    expect(pub2.faq).toEqual([{ q: 'Wie reserviere ich?', a: 'Bitte anrufen.' }]);
    expect(pub2.sections.vouchers.show).toBe(false);
    expect(pub2.images.hero).toBe('');
    expect((await call('PUT', '/settings/site/image/hero', user, { mime: 'image/png', dataBase64: png.toString('base64') })).statusCode).toBe(403);
    expect((await call('PUT', '/settings/site/image/keller', admin, { mime: 'image/png', dataBase64: png.toString('base64') })).statusCode).toBe(400);
    await ok('PUT', '/settings/site/image/hero', admin, { mime: 'image/png', dataBase64: png.toString('base64') });
    expect((await ok('GET', '/public/site', anon)).images.hero).not.toBe('');
    expect((await call('GET', '/public/site/image/hero', anon)).headers['content-type']).toBe('image/png');
    await ok('PUT', '/settings/site', admin, { ...full, enabled: false });
    expect((await call('GET', '/public/site/image/hero', anon)).statusCode).toBe(404); // nicht freigeschaltet: kein Bild
    expect((await call('GET', '/public/site/image/hero', admin)).statusCode).toBe(200); // Vorschau
    await ok('PUT', '/settings/site', admin, { ...full, enabled: true, showAvailability: false });
    expect((await call('GET', `/public/site/availability?from=${addDays(today, 320)}&to=${addDays(today, 321)}&adults=1`, anon)).statusCode).toBe(409);

    // Anfrage mit gewünschter Kategorie landet im Posteingang
    await ok('PUT', '/settings/web-request', admin, { enabled: true, intro: '', privacy: 'Wir verwenden Ihre Angaben nur für die Anfrage.' });
    await ok('POST', '/public/booking-request', anon, { name: 'Erika Gast', email: 'erika@example.org', phone: '', from: addDays(today, 330), to: addDays(today, 332), adults: 2, children: 0, message: '', category: 'Doppelzimmer', consent: true, website: '' });
    const mail = await db.execute(sql`select body from inbox_mails where uid_validity = 'web' order by received_at desc limit 1`);
    expect(String(mail[0]!.body)).toContain('Gewünschte Zimmerkategorie: Doppelzimmer');
    // Video im Startbild: nur echte Videos, Teilabruf (Range) für iPhone/iPad
    const mp4 = Buffer.concat([Buffer.from('00000018667479706d703432', 'hex'), Buffer.alloc(2000, 7)]);
    const putVideo = (body: Buffer, who = admin, type = 'video/mp4') => app.inject({ method: 'PUT', url: '/api/v1/settings/site/video', cookies: who, headers: { 'content-type': type }, payload: body, remoteAddress: clientIp });
    expect((await putVideo(mp4, user)).statusCode).toBe(403);
    expect((await putVideo(Buffer.from('kein video'.repeat(10)))).statusCode).toBe(400);
    expect((await putVideo(mp4)).statusCode).toBe(200);
    expect((await ok('GET', '/public/site', anon)).video).not.toBe('');
    const whole = await call('GET', '/public/site/video', anon);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers['content-type']).toBe('video/mp4');
    expect(whole.rawPayload.length).toBe(mp4.length);
    const part = await app.inject({ method: 'GET', url: '/api/v1/public/site/video', headers: { range: 'bytes=0-99' }, remoteAddress: clientIp });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 0-99/${mp4.length}`);
    expect(part.rawPayload.subarray(4, 8).toString()).toBe('ftyp');
    expect((await app.inject({ method: 'GET', url: '/api/v1/public/site/video', headers: { range: 'bytes=999999-' }, remoteAddress: clientIp })).statusCode).toBe(416);
    await call('DELETE', '/settings/site/video', admin);
    expect((await call('GET', '/public/site/video', anon)).statusCode).toBe(404);

    // ein Formular für alles: Zimmer, Tisch, Feier, Gutschein, Frage
    clientIp = '10.7.7.8'; // eigene Absenderadresse: öffentliche Seiten erlauben 30 Aufrufe je Minute
    const who = { name: 'Erika Gast', email: 'erika@example.org', phone: '0123 456', message: '', consent: true, website: '' };
    const ask = (body: object) => call('POST', '/public/site/request', anon, { ...who, ...body });
    const last = async () => (await db.execute(sql`select subject, kind, body, extract from inbox_mails where uid_validity = 'web' order by uid desc limit 1`))[0] as { subject: string; kind: string; body: string; extract: Record<string, unknown> };
    expect((await ask({ type: 'room', from: addDays(today, 340), to: addDays(today, 342), adults: 2, children: 1, category: 'Doppelzimmer' })).statusCode).toBe(200);
    expect(await last()).toMatchObject({ kind: 'hotel', subject: expect.stringContaining('Zimmeranfrage'), extract: { from: addDays(today, 340), to: addDays(today, 342), persons: 2, children: 1 } });
    expect((await ask({ type: 'table', date: addDays(today, 5), time: '19:30', persons: 4 })).statusCode).toBe(200);
    expect(await last()).toMatchObject({ kind: 'table', extract: { dates: [addDays(today, 5)], time: '19:30', persons: 4 } });
    expect((await ask({ type: 'table', date: addDays(today, 5), time: '25:00', persons: 4 })).json().error.fields.time).toBeTruthy();
    expect((await ask({ type: 'table', date: addDays(today, -2), time: '19:00', persons: 2 })).json().error.fields.date).toContain('Vergangenheit');
    expect((await ask({ type: 'event', date: '', guests: 40, occasion: 'Hochzeit', message: '' })).statusCode).toBe(200);
    expect(await last()).toMatchObject({ kind: 'other', body: expect.stringContaining('Anlass: Hochzeit') });
    expect((await ask({ type: 'event', date: '', guests: 40, occasion: '', message: '' })).json().error.fields.message).toBeTruthy();
    // Tagung (z. B. Ärzte-Fortbildung): Veranstalter, Tage, Teilnehmer, Zimmer, Bestuhlung, Technik, Verpflegung
    const meeting = { type: 'meeting', organization: 'Ärztlicher Qualitätszirkel', kind: 'Seminar / Fortbildung / Schulung', from: addDays(today, 40), to: addDays(today, 41), participants: 25, rooms: 8, layout: 'U-Form', equipment: ['Beamer und Leinwand', 'Flipchart'], catering: ['Mittagessen', 'Kaffeepause nachmittags'] };
    expect((await ask(meeting)).statusCode).toBe(200);
    const mt = await last();
    expect(mt.subject).toBe(`Seminar: Anfrage von Ärztlicher Qualitätszirkel, ${addDays(today, 40).split('-').reverse().join('.')} bis ${addDays(today, 41).split('-').reverse().join('.')}, 25 Teilnehmer`);
    expect(mt.body).toContain('Art: Seminar / Fortbildung / Schulung');
    expect((await ask({ ...meeting, organization: 'Bäckerinnung Zwickau', kind: 'Innungs- oder Mitgliederversammlung', equipment: ['Rednerpult'] })).statusCode).toBe(200);
    expect((await last()).subject).toMatch(/^Innungs-\/Mitgliederversammlung: Anfrage von Bäckerinnung Zwickau/);
    expect((await ask({ ...meeting, kind: 'Kaffeekränzchen' })).statusCode).toBe(400);
    expect(mt.body).toContain('Technik: Beamer und Leinwand, Flipchart');
    expect(mt.body).toContain('Verpflegung: Mittagessen, Kaffeepause nachmittags');
    expect(mt.body).toContain('Übernachtungen: 8 Zimmer je Nacht');
    expect((await ask({ ...meeting, organization: '' })).json().error.fields.organization).toBeTruthy();
    expect((await ask({ ...meeting, to: addDays(today, 39) })).json().error.fields.to).toBeTruthy();
    expect((await ask({ ...meeting, equipment: ['Hubschrauber'] })).statusCode).toBe(400);
    expect((await ask({ ...meeting, to: '', rooms: 0, layout: '', equipment: [], catering: [] })).statusCode).toBe(200);
    expect((await last()).body).toContain('Übernachtungen: keine');
    expect((await ask({ type: 'voucher', value: '50 €' })).statusCode).toBe(200);
    expect((await last()).subject).toBe('Gutscheinanfrage: 50 €');
    expect((await ask({ type: 'question', message: 'Gibt es Parkplätze?' })).statusCode).toBe(200);
    expect((await ask({ type: 'question', message: '' })).statusCode).toBe(400);
    expect((await ask({ type: 'question', message: 'Ohne Häkchen', consent: false })).statusCode).toBe(400);
    expect((await ask({ type: 'unbekannt', message: 'x' })).statusCode).toBe(400);
    // Anfrageformular selbst einstellen: eigene Listen, Arten abschalten, Tischzeiten
    const cfg = await ok('GET', '/settings/site', admin);
    expect(cfg.form.equipment).toContain('Beamer und Leinwand');
    expect((await call('PUT', '/settings/site', admin, { ...cfg, form: { ...cfg.form, equipment: ['A', 'a'] } })).statusCode).toBe(400); // doppelt
    await ok('PUT', '/settings/site', admin, { ...cfg, form: { ...cfg.form, equipment: ['Fernseher mit HDMI'], layouts: [], types: { ...cfg.form.types, voucher: false }, tableFrom: '17:00', tableTo: '21:00', tableMaxPersons: 8 } });
    expect((await ok('GET', '/public/site', anon)).form).toMatchObject({ equipment: ['Fernseher mit HDMI'], layouts: [], types: { voucher: false }, tableFrom: '17:00' });
    expect((await ask({ ...meeting, equipment: ['Fernseher mit HDMI'], layout: '' })).statusCode).toBe(200);
    expect((await ask({ ...meeting, equipment: ['Beamer und Leinwand'], layout: '' })).json().error.fields.equipment).toBeTruthy(); // nicht mehr angeboten
    expect((await ask({ ...meeting, equipment: [], layout: 'U-Form' })).json().error.fields.layout).toBeTruthy();
    expect((await ask({ type: 'voucher', value: '20 €' })).statusCode).toBe(409);
    expect((await ask({ type: 'table', date: addDays(today, 5), time: '12:00', persons: 2 })).json().error.fields.time).toContain('17:00');
    expect((await ask({ type: 'table', date: addDays(today, 5), time: '19:00', persons: 12 })).json().error.fields.persons).toBeTruthy();
    expect((await ask({ type: 'table', date: addDays(today, 5), time: '19:00', persons: 8 })).statusCode).toBe(200);
    await ok('PUT', '/settings/site', admin, cfg);
    await ok('PUT', '/settings/web-request', admin, { enabled: false, intro: '', privacy: '' });
    expect((await ask({ type: 'question', message: 'Noch offen?' })).statusCode).toBe(409);
    await ok('PUT', '/settings/site', admin, { ...base, enabled: false });
    clientIp = '127.0.0.1';
  });
});
