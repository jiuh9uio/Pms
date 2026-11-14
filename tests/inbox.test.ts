import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { autoFetchTick, setInboxFetcher, type RawMail } from '../src/server/modules/inbox.js';
import { setMailSender } from '../src/server/modules/mail.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });


const raw = (uid: number, from: string, subject: string, text: string, date = 'Sat, 14 Nov 2026 09:00:00 +0100'): RawMail => ({
  uid, internalDate: new Date(date),
  source: Buffer.from(`From: ${from}\r\nTo: info@example.org\r\nSubject: ${subject}\r\nDate: ${date}\r\nMessage-ID: <m${uid}@example.org>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${text}\r\n`, 'utf8'),
});
let box: RawMail[] = [];
let asked: { uidValidity: string; lastUid: number }[] = [];
let failWith: Error | null = null;
let user: Record<string, string>;

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  setInboxFetcher(async (c, known) => {
    asked.push(known);
    if (failWith) throw failWith;
    expect(c).toMatchObject({ host: 'imap.gmx.net', port: 993, user: 'info@example.org', pass: 'geheim-imap', folder: 'INBOX' });
    return { uidValidity: '77', mails: box.filter((m) => known.uidValidity !== '77' || m.uid > known.lastUid) };
  });
});
afterAll(async () => { await app.close(); await close(); });

describe('E-Mail-Posteingang', () => {
  const cfg = { enabled: true, host: 'imap.gmx.net', port: 993, user: 'info@example.org', password: 'geheim-imap', folder: 'INBOX', autoMinutes: 0 };

  it('ist ein eigenes Modul und ohne Einrichtung gesperrt', async () => {
    expect((await call('GET', '/inbox', user)).statusCode).toBe(403); // Modul „E-Mail“ nicht freigegeben
    expect((await call('PUT', '/settings/inbox', user, cfg)).statusCode).toBe(403);
    expect((await call('POST', '/inbox/fetch', admin)).statusCode).toBe(409);
    const saved = await ok('PUT', '/settings/inbox', admin, cfg);
    expect(saved).toEqual({ enabled: true, host: 'imap.gmx.net', port: 993, user: 'info@example.org', folder: 'INBOX', autoMinutes: 0, keepDays: 0, hasPassword: true });
    const stored = await db.execute(sql`select value::text as v from settings where key = 'inbox'`);
    expect(String(stored[0]!.v)).not.toContain('geheim-imap'); // Passwort nur verschlüsselt
    const log = await db.execute(sql`select coalesce(before::text, '') || after::text as t from audit_log where entity_id = 'inbox'`);
    expect(String(log[0]!.t)).not.toContain('geheim-imap');
  });

  it('holt neue Nachrichten ab, ordnet sie ein und lädt nichts doppelt', async () => {
    box = [
      raw(1, '"Erika Beispiel" <erika@example.com>', 'Zimmeranfrage', 'Guten Tag,\nhaben Sie vom 3. bis 5. Dezember ein Doppelzimmer für 2 Erwachsene frei?\nTel. 0171 1234567\nViele Grüße\nErika Beispiel'),
      raw(2, 'Max Muster <max@example.com>', '=?utf-8?Q?Tisch_f=C3=BCr_Heiligabend?=', 'Hallo,\nbitte einen Tisch am 24.12. um 18.30 Uhr für 6 Personen reservieren.\nDanke!'),
      raw(3, 'Lieferant <rechnung@example.net>', 'Ihre Rechnung 4711', 'Anbei Ihre Rechnung.'),
    ];
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 3 });
    expect(asked.at(-1)).toEqual({ uidValidity: '', lastUid: 0 });
    const list = await ok('GET', '/inbox', admin);
    expect(new Set(list.map((m: { subject: string; kind: string }) => `${m.subject}|${m.kind}`))).toEqual(new Set(['Zimmeranfrage|hotel', 'Tisch für Heiligabend|table', 'Ihre Rechnung 4711|other']));
    const hotel = list.find((m: { kind: string }) => m.kind === 'hotel');
    expect(hotel).toMatchObject({ fromName: 'Erika Beispiel', fromAddr: 'erika@example.com', status: 'new', extract: { from: '2026-12-03', to: '2026-12-05', persons: 2, phone: '0171 1234567' } });
    expect(hotel.body).toBeUndefined();
    const table = (await ok('GET', '/inbox?kind=table', admin))[0];
    expect(table).toMatchObject({ subject: 'Tisch für Heiligabend', extract: { dates: ['2026-12-24'], time: '18:30', persons: 6 } });
    expect((await ok('GET', `/inbox/${table.id}`, admin)).body).toContain('18.30 Uhr');
    expect(await ok('GET', '/inbox?q=lieferant', admin)).toHaveLength(1);

    // zweiter Abruf: nur Neues, nichts doppelt
    box.push(raw(4, 'Neu <neu@example.com>', 'Frage', 'Wann haben Sie geöffnet?'));
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 1 });
    expect(asked.at(-1)).toEqual({ uidValidity: '77', lastUid: 3 });
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 0 });
    expect(await ok('GET', '/inbox/state', admin)).toMatchObject({ ready: true, newCount: 4, lastError: null });
  });

  it('merkt Bearbeitung, Verknüpfung und Entfernen', async () => {
    const [mail] = await ok('GET', '/inbox?kind=table', admin);
    const linkId = '11111111-1111-4111-8111-111111111111';
    const done = await ok('PATCH', `/inbox/${mail.id}`, admin, { status: 'done', linkKind: 'table', linkId });
    expect(done).toMatchObject({ status: 'done', linkKind: 'table', linkId, handledBy: 'Chefin' });
    expect(await ok('GET', '/inbox?kind=table', admin)).toHaveLength(0); // Standard: nur neue
    expect(await ok('GET', '/inbox?kind=table&status=done', admin)).toHaveLength(1);
    const [other] = await ok('GET', '/inbox?kind=other&q=Frage', admin);
    expect((await ok('PATCH', `/inbox/${other.id}`, admin, { kind: 'hotel' })).kind).toBe('hotel');
    await ok('DELETE', `/inbox/${other.id}`, admin);
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 0 }); // Entferntes kommt nicht wieder
  });

  it('meldet Fehler verständlich und ruft auf Wunsch selbst ab', async () => {
    failWith = Object.assign(new Error('Command failed'), { authenticationFailed: true });
    const res = await call('POST', '/inbox/fetch', admin);
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('Anmeldung am Postfach abgelehnt');
    expect((await ok('GET', '/inbox/state', admin)).lastError).toContain('Anmeldung');
    failWith = null;
    expect(await autoFetchTick(db)).toBe('idle'); // automatischer Abruf ist aus
    await ok('PUT', '/settings/inbox', admin, { ...cfg, password: '', autoMinutes: 5 }); // leeres Passwort = behalten
    box.push(raw(5, 'Spät <spaet@example.com>', 'Zimmer frei?', 'Haben Sie morgen ein Einzelzimmer frei?'));
    expect(await autoFetchTick(db, new Date(Date.now() + 6 * 60_000))).toBe('fetched');
    expect(await autoFetchTick(db, new Date(Date.now() + 60_000))).toBe('idle'); // erst nach 5 Minuten wieder
    const [late] = await ok('GET', '/inbox?q=spaet', admin);
    expect(late.extract).toMatchObject({ kind: 'hotel', from: '2026-11-15', persons: 1 });
  });

  it('antwortet aus dem Programm und bestätigt eine übernommene Tischreservierung', async () => {
    const sent: { to: string; subject: string; text: string; inReplyTo?: string }[] = [];
    setMailSender(async (_c, mail) => { sent.push(mail); });
    const [mail] = await ok('GET', '/inbox?kind=table&status=done', admin);
    // ohne eingerichteten Versand: Vorschlag ja, Senden nein
    const draft = await ok('GET', `/inbox/${mail.id}/mail`, admin);
    expect(draft).toMatchObject({ to: 'max@example.com', subject: 'Re: Tisch für Heiligabend', ready: false });
    expect(draft.text).toContain('Guten Tag Max Muster,');
    expect(draft.text).toContain('> bitte einen Tisch am 24.12.');
    expect((await call('POST', `/inbox/${mail.id}/mail`, admin, { to: draft.to, subject: draft.subject, text: draft.text })).statusCode).toBe(409);
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.gmx.net', port: 587, user: 'info@example.org', fromName: 'Schützenhaus', password: 'smtp-geheim' });

    // Bestätigung nur, wenn die Reservierung existiert
    expect((await call('GET', `/inbox/${mail.id}/mail?template=confirm`, admin)).statusCode).toBe(409); // Verknüpfung zeigt ins Leere
    const res = await ok('POST', '/restaurant/reservations', admin, { date: '2026-12-24', time: '18:30', durationMin: 120, persons: 6, name: 'Max Muster', phone: '', note: '', tableId: null });
    await ok('PATCH', `/inbox/${mail.id}`, admin, { linkKind: 'table', linkId: res.id });
    const confirm = await ok('GET', `/inbox/${mail.id}/mail?template=confirm`, admin);
    expect(confirm.subject).toContain('Ihre Tischreservierung am 24.12.2026');
    expect(confirm.text).toContain('Donnerstag, 24.12.2026 um 18:30 Uhr');
    expect(confirm.text).toContain('6 Personen');
    await ok('POST', `/inbox/${mail.id}/mail`, admin, { to: confirm.to, subject: confirm.subject, text: confirm.text });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'max@example.com', inReplyTo: '<m2@example.org>' });
    expect(await ok('GET', `/inbox/${mail.id}`, admin)).toMatchObject({ repliedBy: 'Chefin' });
    expect((await ok('GET', `/inbox/${mail.id}`, admin)).repliedAt).toBeTruthy();
    const [hotel] = await ok('GET', '/inbox?kind=hotel&q=erika', admin);
    expect((await ok('GET', `/inbox/${hotel.id}/mail?template=decline`, admin)).text).toContain('leider kein Zimmer mehr frei');
    expect((await call('GET', `/inbox/${hotel.id}/mail?template=confirm`, admin)).statusCode).toBe(409); // noch nichts angelegt
  });

  it('wendet die E-Mail-Regeln an: nur Anfragen zeigen, eigene Stichwörter, Absender ausschließen', async () => {
    expect((await call('PUT', '/settings/mail-rules', user, {})).statusCode).toBe(403);
    await ok('PUT', '/settings/mail-rules', admin, { hideOther: true, hotelWords: [], tableWords: ['Stammtisch'], ignoreSenders: ['newsletter@'] });
    box.push(
      raw(6, 'Werbung <newsletter@example.com>', 'Zimmer frei? Jetzt buchen', 'Haben Sie ein Zimmer frei? Buchen Sie unsere Software.'),
      raw(7, 'Verein <verein@example.com>', 'Stammtisch', 'Wir möchten am 10.12. um 19 Uhr mit 12 Personen kommen.'),
      raw(8, 'Bank <bank@example.com>', 'Kontoauszug', 'Ihr Kontoauszug liegt bereit.'),
    );
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 3 });
    const fresh = await ok('GET', '/inbox?status=new', admin);
    expect(fresh.find((m: { subject: string }) => m.subject === 'Stammtisch')).toMatchObject({ kind: 'table', extract: { dates: ['2026-12-10'], time: '19:00', persons: 12 } });
    expect(fresh.some((m: { subject: string }) => m.subject === 'Kontoauszug' || m.subject.startsWith('Zimmer frei? Jetzt'))).toBe(false);
    const hidden = await ok('GET', '/inbox?status=ignored', admin);
    expect(hidden.filter((m: { handledBy: string }) => m.handledBy === 'Regel').map((m: { subject: string }) => m.subject).sort()).toEqual(['Kontoauszug', 'Zimmer frei? Jetzt buchen']);

    // Regeln ändern und auf Vorhandenes anwenden: Verstecktes kommt zurück, die alte Rechnungsmail wird versteckt
    await ok('PUT', '/settings/mail-rules', admin, { hideOther: false, hotelWords: [], tableWords: [], ignoreSenders: [] });
    const re = await ok('POST', '/inbox/reclassify', admin);
    expect(re.changed).toBeGreaterThanOrEqual(3);
    const back = await ok('GET', '/inbox?status=new', admin);
    expect(back.find((m: { subject: string }) => m.subject === 'Zimmer frei? Jetzt buchen').kind).toBe('hotel');
    expect(back.find((m: { subject: string }) => m.subject === 'Stammtisch').kind).toBe('other');
    expect(back.some((m: { subject: string }) => m.subject === 'Kontoauszug')).toBe(true);
  });

  it('entfernt Erledigtes nach der eingestellten Frist und leert den Posteingang über „Daten löschen“', async () => {
    const before = (await ok('GET', '/inbox?status=all', admin)).length;
    await db.execute(sql`update inbox_mails set received_at = now() - interval '40 days' where status = 'done'`);
    await db.execute(sql`update inbox_mails set received_at = now() - interval '40 days' where subject = 'Zimmeranfrage'`); // noch offen
    await ok('PUT', '/settings/inbox', admin, { ...cfg, password: '', keepDays: 30 });
    await ok('POST', '/inbox/fetch', admin);
    const after = await ok('GET', '/inbox?status=all', admin);
    expect(after.length).toBe(before - 1); // nur die erledigte, alte Nachricht
    expect(after.some((m: { subject: string }) => m.subject === 'Zimmeranfrage')).toBe(true); // Offenes bleibt, egal wie alt
    const purge = { billing: false, bookings: 'none', guests: false, resetNumbers: false, inbox: true, password: 'sehr-geheim-123', confirm: 'LÖSCHEN' };
    expect((await ok('POST', '/settings/purge', admin, { ...purge, dryRun: true })).mails).toBe(after.length);
    expect((await ok('POST', '/settings/purge', admin, { ...purge, dryRun: false })).mails).toBe(after.length);
    expect(await ok('GET', '/inbox?status=all', admin)).toHaveLength(0);
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 0 }); // wird nicht erneut abgeholt
  });

  it('nimmt Online-Anfragen nur an, wenn eingeschaltet, und legt sie in den Posteingang', async () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const req = { name: 'Web Gast', email: 'web@example.com', phone: '0170 5556677', from: day(20), to: day(22), adults: 2, children: 1, message: 'Gern ruhig gelegen.', consent: true, website: '' };
    expect(await ok('GET', '/public/booking-request', {})).toMatchObject({ enabled: false });
    expect((await call('POST', '/public/booking-request', {}, req)).statusCode).toBe(409);
    expect((await call('PUT', '/settings/web-request', user, { enabled: true, intro: '', privacy: '' })).statusCode).toBe(403);
    await ok('PUT', '/settings/web-request', admin, { enabled: true, intro: 'Schön, dass Sie da sind.', privacy: 'Wir verwenden Ihre Angaben nur für diese Anfrage.' });
    expect(await ok('GET', '/public/booking-request', {})).toMatchObject({ enabled: true, intro: 'Schön, dass Sie da sind.' });
    expect((await call('POST', '/public/booking-request', {}, { ...req, consent: false })).statusCode).toBe(400);
    expect((await call('POST', '/public/booking-request', {}, { ...req, to: req.from })).statusCode).toBe(400);
    expect((await call('POST', '/public/booking-request', {}, { ...req, from: day(-3), to: day(-1) })).statusCode).toBe(400);
    await ok('POST', '/public/booking-request', {}, { ...req, website: 'http://spam.example' }); // Köder ausgefüllt: still verworfen
    expect(await ok('GET', '/inbox?status=all', admin)).toHaveLength(0);
    await ok('POST', '/public/booking-request', {}, req);
    await ok('POST', '/public/booking-request', {}, { ...req, name: 'Zweiter Gast' });
    const list = await ok('GET', '/inbox?status=new', admin);
    expect(list).toHaveLength(2);
    const first = list.find((m: { fromName: string }) => m.fromName === 'Web Gast');
    expect(first).toMatchObject({ kind: 'hotel', fromAddr: 'web@example.com', extract: { from: req.from, to: req.to, persons: 2, children: 1, phone: '0170 5556677' } });
    expect((await ok('GET', `/inbox/${first.id}`, admin)).body).toContain('Gern ruhig gelegen.');
    expect(await ok('POST', '/inbox/fetch', admin)).toEqual({ added: 0 }); // der Abruf des Postfachs stört die Online-Anfragen nicht
  });
});
