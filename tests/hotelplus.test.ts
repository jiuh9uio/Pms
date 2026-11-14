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
});
