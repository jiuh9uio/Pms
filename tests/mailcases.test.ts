import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { setInboxFetcher, type RawMail } from '../src/server/modules/inbox.js';
import { setMailSender, threadCodesOf, threadMessageId } from '../src/server/modules/mail.js';

/**
 * E-Mail-Vorgänge: Zuordnung (technische Verweise vor Nummer im Betreff, Absenderprüfung), keine Duplikate, defekte Nachrichten,
 * Verschieben/Abtrennen/Zusammenführen, sichere Verarbeitung von HTML und Anhängen. Es wird nichts wirklich versendet oder abgerufen.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
let mailOnly: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });

/** Roh-E-Mail wie vom Postfach; headers = zusätzliche Kopfzeilen (In-Reply-To, References …) */
const raw = (uid: number, from: string, subject: string, text: string, o: { headers?: string[]; date?: string; id?: string; body?: string; internal?: Date } = {}): RawMail => {
  // Vorgabe: „jetzt“ plus ein paar Sekunden je Nachricht – so liegen spätere Nachrichten zeitlich nach unseren Antworten
  const date = o.date ?? new Date(Date.now() + uid * 1000).toUTCString();
  return { uid, internalDate: o.internal ?? new Date(date),
    source: Buffer.from([`From: ${from}`, 'To: info@example.org', `Subject: ${subject}`, `Date: ${date}`, `Message-ID: ${o.id ?? `<k${uid}@kunde.example>`}`, ...(o.headers ?? []), 'MIME-Version: 1.0',
      ...(o.body ? [o.body] : ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: 8bit', '', text]), ''].join('\r\n'), 'utf8') };
};
let box: RawMail[] = [];
let validity = '900';
let failWith: Error | null = null;
const sent: { to: string; subject: string; text: string; messageId?: string; inReplyTo?: string; references?: string[] }[] = [];
const fetchNow = () => ok('POST', '/inbox/fetch', admin);
const byUid = async (uid: number) => (await db.execute(sql`select id, case_id, subject, body, status, extract, received_at from inbox_mails where uid = ${uid} and uid_validity = ${validity}`))[0] as
  { id: string; case_id: string | null; subject: string; body: string; status: string; extract: { attachments?: { name: string }[] }; received_at: Date } | undefined;
const reply = (mailId: string, text = 'Unsere Antwort.') => ok('POST', `/inbox/${mailId}/mail?template=reply`, admin, { to: 'gast@kunde.example', subject: 'Re: Anfrage', text });

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'post', name: 'Nur Post', password: 'nur-post-12345', role: 'user', modules: ['email'] });
  mailOnly = session(await call('POST', '/auth/login', {}, { username: 'post', password: 'nur-post-12345' }));
  setInboxFetcher(async (_c, known) => {
    if (failWith) throw failWith;
    return { uidValidity: validity, mails: box.filter((m) => known.uidValidity !== validity || m.uid > known.lastUid) };
  });
  setMailSender(async (_c, mail) => { sent.push(mail); });
  await ok('PUT', '/settings/inbox', admin, { enabled: true, host: 'imap.example.org', port: 993, user: 'info@example.org', password: 'geheim-imap', folder: 'INBOX', autoMinutes: 0 });
  await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'smtp.example.org', port: 587, user: 'info@example.org', fromName: 'Testhaus', password: 'smtp-geheim' });
});
afterAll(async () => { await app.close(); await close(); });

describe('E-Mail-Vorgänge: Zuordnung', () => {
  let caseId = '', number = '', ourId = '';

  it('1) neue E-Mail → mit der ersten Antwort entsteht genau ein Vorgang; die Antwort trägt Nummer und eigene Message-ID', async () => {
    box = [raw(1, 'Gerda Gast <gast@kunde.example>', 'Anfrage', 'Haben Sie ein Zimmer frei?', { date: new Date(Date.now() - 3_600_000).toUTCString() })];
    expect(await fetchNow()).toEqual({ added: 1 });
    const m = (await byUid(1))!;
    expect(m.case_id).toBeNull(); // die Nummer entsteht erst mit der Antwort
    await reply(m.id);
    const d = await ok('GET', `/inbox/${m.id}`, admin);
    caseId = d.caseId; number = d.caseNumber;
    expect(number).toMatch(/^V-\d{4}-0001$/);
    expect(sent.at(-1)!.subject).toBe(`Re: Anfrage [${number}]`);
    ourId = sent.at(-1)!.messageId!;
    expect(threadCodesOf([ourId])).toEqual([number]);
    expect(sent.at(-1)).toMatchObject({ inReplyTo: '<k1@kunde.example>', references: ['<k1@kunde.example>'] });
    await reply(m.id, 'Noch eine Antwort.'); // zweite Antwort: derselbe Vorgang, keine neue Nummer
    expect((await db.execute(sql`select count(*)::int as n from mail_cases`))[0]!.n).toBe(1);
  });

  it('2) + 3) Antwort mit geändertem Betreff wird über den technischen Verweis dem richtigen Vorgang zugeordnet', async () => {
    box.push(raw(2, 'Gerda Gast <gast@kunde.example>', 'Ganz anderer Betreff ohne Nummer', 'Ja, bitte buchen.', { headers: [`In-Reply-To: ${ourId}`, `References: <k1@kunde.example> ${ourId}`] }));
    await fetchNow();
    expect((await byUid(2))!.case_id).toBe(caseId);
    // anderer Absender (z. B. Kollegin des Kunden), aber echter Verweis auf unsere E-Mail: gehört dazu
    box.push(raw(3, 'Kollegin <kollegin@kunde.example>', 'WG: Rückfrage', 'Ich übernehme.', { headers: [`References: ${ourId}`] }));
    await fetchNow();
    expect((await byUid(3))!.case_id).toBe(caseId);
    // der Kunde schreibt in seinem eigenen Faden weiter (Verweis auf seine erste Nachricht, kein Verweis auf uns)
    box.push(raw(4, 'Gerda Gast <gast@kunde.example>', 'Nachtrag', 'Noch etwas vergessen.', { headers: ['In-Reply-To: <k1@kunde.example>'] }));
    await fetchNow();
    expect((await byUid(4))!.case_id).toBe(caseId);
    const d = await ok('GET', `/mail-cases/${caseId}`, admin);
    expect(d.messages.map((x: { dir: string }) => x.dir)).toEqual(['in', 'out', 'out', 'in', 'in', 'in']); // zeitlich geordnet, auch bei längerem Verlauf
    expect(d.turn).toBe('ours');
  });

  it('Nummer im Betreff: nur vom bekannten Absender – ein Fremder wird nicht zugeordnet, sondern zur Prüfung vorgeschlagen', async () => {
    box.push(raw(5, 'Gerda Gast <gast@kunde.example>', `AW: Anfrage [${number.toLowerCase()}]`, 'Mit Nummer, ohne Verweis.'));
    box.push(raw(6, 'Fremder <irgendwer@anderswo.example>', `Betrifft ${number}`, 'Ich kenne nur die Nummer.'));
    box.push(raw(7, 'Gerda Gast <gast@kunde.example>', 'Weiterleitung', `Im Text steht ${number}, im Betreff nicht.`));
    await fetchNow();
    expect((await byUid(5))!.case_id).toBe(caseId);
    expect((await byUid(6))!.case_id).toBeNull();
    expect((await byUid(7))!.case_id).toBeNull(); // Nummer nur im Text genügt nicht (Zitate, Weiterleitungen)
    const d = await ok('GET', `/mail-cases/${caseId}`, admin);
    const cand = d.candidates.map((c: { subject: string }) => c.subject);
    expect(cand).toContain(`Betrifft ${number}`);
    expect(cand).toContain('Weiterleitung');
  });

  it('7) ungültige oder unbekannte Vorgangsnummer und gefälschter Verweis ordnen nichts zu', async () => {
    box.push(raw(8, 'Gerda Gast <gast@kunde.example>', 'AW [V-1999-0042]', 'Unbekannte Nummer.'));
    box.push(raw(9, 'Gerda Gast <gast@kunde.example>', 'AW [V-2026-1]', 'Zu kurze Nummer.'));
    box.push(raw(10, 'Angreifer <x@boese.example>', 'Hallo', 'Gefälschter Verweis.', { headers: [`In-Reply-To: <pms.${number}.kurz@example.org>`] })); // falsches Format (kein Zufallsteil)
    box.push(raw(11, 'Angreifer <x@boese.example>', 'Hallo', 'Verweis auf unbekannte Nummer.', { headers: [`In-Reply-To: ${threadMessageId('V-1999-0042', 'info@example.org')}`] }));
    await fetchNow();
    for (const uid of [8, 9, 10, 11]) expect((await byUid(uid))!.case_id, `uid ${uid}`).toBeNull();
    expect((await db.execute(sql`select count(*)::int as n from mail_cases`))[0]!.n).toBe(1); // es entsteht auch kein neuer Vorgang von selbst
  });

  it('6) Weiterleitung mit fremder Nummer im Betreff von unbekanntem Absender bleibt unzugeordnet', async () => {
    box.push(raw(12, 'Dritter <dritter@firma.example>', `WG: AW: Anfrage [${number}]`, 'Zur Info weitergeleitet.'));
    await fetchNow();
    expect((await byUid(12))!.case_id).toBeNull();
  });

  it('4) wiederholter Abruf und zurückgesetzte Postfach-Nummerierung erzeugen keine Duplikate', async () => {
    const before = (await db.execute(sql`select count(*)::int as n from inbox_mails`))[0]!.n as number;
    expect(await fetchNow()).toEqual({ added: 0 });
    await db.execute(sql`update settings set value = jsonb_set(value, '{lastUid}', '0') where key = 'inbox_state'`); // Abruf beginnt noch einmal von vorn
    expect(await fetchNow()).toEqual({ added: 0 });
    validity = '901'; // das Postfach hat seine Nummerierung zurückgesetzt: dieselben Nachrichten kommen mit neuer Kennung
    expect(await fetchNow()).toEqual({ added: 0 });
    expect((await db.execute(sql`select count(*)::int as n from inbox_mails`))[0]!.n).toBe(before);
    validity = '900';
    await db.execute(sql`update settings set value = jsonb_set(jsonb_set(value, '{uidValidity}', '"900"'), '{lastUid}', '12') where key = 'inbox_state'`);
  });

  it('5) gleichzeitige Antworten auf dieselbe Nachricht ergeben einen Vorgang mit einer Nummer; Nummern werden nie doppelt vergeben', async () => {
    box.push(raw(20, 'Paul Parallel <paul@kunde.example>', 'Tisch am Freitag', 'Bitte einen Tisch.'), raw(21, 'Petra Parallel <petra@kunde.example>', 'Tisch am Samstag', 'Bitte einen Tisch.'));
    await fetchNow();
    const a = (await byUid(20))!, b = (await byUid(21))!;
    const res = await Promise.all([call('POST', `/inbox/${a.id}/case`, admin, {}), call('POST', `/inbox/${a.id}/case`, admin, {}), call('POST', `/inbox/${a.id}/case`, admin, {}), call('POST', `/inbox/${b.id}/case`, admin, {})]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    const nums = res.map((r) => r.json().number as string);
    expect(new Set(nums.slice(0, 3)).size).toBe(1);
    expect(nums[3]).not.toBe(nums[0]);
    const all = (await db.execute(sql`select number from mail_cases order by number`)).map((r) => r.number);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(3);
    // der Abruf selbst läuft nie doppelt
    const both = await Promise.all([call('POST', '/inbox/fetch', admin), call('POST', '/inbox/fetch', admin)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('8) Verschieben, Abtrennen und Zusammenführen bleiben gespeichert; Nummern bleiben erhalten', async () => {
    const paul = await ok('GET', `/inbox/${(await byUid(20))!.id}`, admin), petra = await ok('GET', `/inbox/${(await byUid(21))!.id}`, admin);
    const m5 = (await byUid(5))!;
    // falsch zugeordnete Nachricht in einen anderen Vorgang verschieben
    expect((await call('POST', `/mail-cases/${caseId}/move`, admin, { inboxMailId: m5.id, number: 'V-2026-9999' })).statusCode).toBe(404);
    expect((await call('POST', `/mail-cases/${caseId}/move`, admin, { inboxMailId: m5.id, number: 'unsinn' })).statusCode).toBe(400);
    await ok('POST', `/mail-cases/${caseId}/move`, admin, { inboxMailId: m5.id, number: paul.caseNumber });
    expect((await byUid(5))!.case_id).toBe(paul.caseId);
    await fetchNow(); // ein späterer Abruf ändert die Handzuordnung nicht
    expect((await byUid(5))!.case_id).toBe(paul.caseId);
    // abtrennen: eigene, neue Nummer
    const split = await ok('POST', `/mail-cases/${paul.caseId}/split`, admin, { inboxMailId: m5.id });
    expect(split.number).not.toBe(paul.caseNumber);
    expect((await byUid(5))!.case_id).toBe(split.id);
    // zusammenführen: alles wandert in den Zielvorgang, der leere Vorgang bleibt archiviert mit seiner Nummer
    const merged = await ok('POST', `/mail-cases/${petra.caseId}/merge`, admin, { number: paul.caseNumber });
    expect(merged.number).toBe(paul.caseNumber);
    expect((await byUid(21))!.case_id).toBe(paul.caseId);
    const old = await ok('GET', `/mail-cases/${petra.caseId}`, admin);
    expect(old).toMatchObject({ number: petra.caseNumber, status: 'archived', messages: [] });
    expect(old.title).toContain(paul.caseNumber);
    expect((await call('POST', `/mail-cases/${paul.caseId}/merge`, admin, { number: paul.caseNumber })).statusCode).toBe(409);
    // eine neue Nummer überspringt keine vergebene und wiederholt keine
    const all = (await db.execute(sql`select number from mail_cases order by number`)).map((r) => r.number);
    expect(new Set(all).size).toBe(all.length);
  });

  it('9) Verbindungsabbruch und eine defekte Nachricht führen zu keinem Verlust; der Abruf läuft danach weiter', async () => {
    box.push(raw(30, 'Vor dem Abbruch <a@kunde.example>', 'Erste', 'kommt an'));
    failWith = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    expect((await call('POST', '/inbox/fetch', admin)).statusCode).toBe(502);
    expect(await byUid(30)).toBeUndefined();
    expect((await ok('GET', '/inbox/state', admin)).lastError).toContain('nicht erreichbar');
    failWith = null;
    // eine Nachricht, deren Verarbeitung scheitert, blockiert die folgenden nicht und geht nicht still verloren
    const broken = raw(31, 'Kaputt <b@kunde.example>', 'Zweite', 'x');
    (broken as { source: unknown }).source = null; // unbrauchbarer Inhalt vom Server
    box.push(broken, raw(32, 'Nach der defekten <c@kunde.example>', 'Dritte', 'kommt auch an'));
    expect(await fetchNow()).toEqual({ added: 3 });
    expect((await byUid(30))!.subject).toBe('Erste');
    expect((await byUid(31))!.subject).toBe('(Nachricht konnte nicht gelesen werden)');
    expect((await byUid(31))!.body).toContain('im E-Mail-Programm öffnen');
    expect((await byUid(32))!.subject).toBe('Dritte');
    expect(await fetchNow()).toEqual({ added: 0 });
    expect((await ok('GET', '/inbox/state', admin)).lastError).toBeNull();
  });

  it('10) HTML-E-Mails werden nur als Text gespeichert; Anhänge werden benannt, eingebettete Bilder nicht', async () => {
    const html = ['Content-Type: multipart/mixed; boundary="X"', '', '--X', 'Content-Type: text/html; charset=utf-8', '',
      '<html><body><p>Hallo <b>Team</b></p><script>alert("xss")</script><img src="x" onerror="alert(1)"><a href="javascript:alert(2)">Klick</a></body></html>',
      '--X', 'Content-Type: application/pdf; name="Katalog ausgefuellt.pdf"', 'Content-Disposition: attachment; filename="Katalog ausgefuellt.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-1.4 test').toString('base64'),
      '--X', 'Content-Type: image/png; name="logo.png"', 'Content-Disposition: inline; filename="logo.png"', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '--X--'].join('\r\n');
    box.push(raw(40, 'Html Absender <h@kunde.example>', 'Mit Anhang', '', { body: html }));
    await fetchNow();
    const m = (await byUid(40))!;
    expect(m.body).toContain('Hallo');
    expect(m.body).not.toMatch(/<script|<img|onerror|<a /i); // kein HTML im gespeicherten Text
    expect(m.extract.attachments!.map((a) => a.name)).toEqual(['Katalog ausgefuellt.pdf']);
    const c = await ok('POST', `/inbox/${m.id}/case`, admin, {});
    const d = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(d.messages[0].attachments).toMatchObject([{ name: 'Katalog ausgefuellt.pdf', type: 'application/pdf' }]);
  });

  it('Datum in der Zukunft (falsche Uhr beim Absender) verfälscht die Reihenfolge nicht', async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toUTCString();
    box.push(raw(50, 'Zeit Reisender <z@kunde.example>', 'Aus der Zukunft', 'x', { date: future, internal: new Date('2026-11-14T10:00:00Z') }));
    await fetchNow();
    expect(new Date((await byUid(50))!.received_at).toISOString()).toBe('2026-11-14T10:00:00.000Z');
  });
});

describe('E-Mail-Vorgänge: Liste, Stand und Berechtigungen', () => {
  it('Liste: Stand, Ungelesene, Filter nach Status, Datum und Suche; Statuswechsel', async () => {
    const all = await ok('GET', '/mail-cases?status=all', admin);
    const first = all.find((r: { number: string }) => r.number.endsWith('-0001'));
    expect(first).toMatchObject({ source: 'case', turn: 'ours', status: 'open' });
    expect(first.unread).toBeGreaterThan(0);
    expect(first.count).toBeGreaterThanOrEqual(5);
    expect((await ok('GET', `/mail-cases?status=open&q=${encodeURIComponent('gast@kunde')}`, admin)).map((r: { number: string }) => r.number)).toContain(first.number);
    expect(await ok('GET', '/mail-cases?status=open&to=2020-01-01', admin)).toEqual([]);
    expect((await ok('GET', '/mail-cases?status=archived', admin)).every((r: { status: string }) => r.status === 'archived')).toBe(true);
    // In Bearbeitung → bleibt in der offenen Liste; Erledigt → erledigt auch die ungelesenen Nachrichten; neue Antwort öffnet wieder
    expect((await ok('PATCH', `/mail-cases/${first.id}`, admin, { status: 'working' })).status).toBe('working');
    expect((await ok('GET', '/mail-cases?status=open', admin)).find((r: { id: string }) => r.id === first.id).status).toBe('working');
    await ok('PATCH', `/mail-cases/${first.id}`, admin, { status: 'done' });
    expect((await ok('GET', '/mail-cases?status=done', admin)).find((r: { id: string }) => r.id === first.id)).toMatchObject({ unread: 0 });
    box.push(raw(60, 'Gerda Gast <gast@kunde.example>', `AW [${first.number}]`, 'Doch noch eine Frage.'));
    await fetchNow();
    expect((await ok('GET', `/mail-cases/${first.id}`, admin)).status).toBe('open');
    expect((await call('PATCH', `/mail-cases/${first.id}`, admin, { status: 'gibtsnicht' })).statusCode).toBe(400);
  });

  it('Berechtigung: ohne Modul „E-Mail“ kein Zugriff; Angebots-Verläufe nur mit Freigabe für Hotel oder Restaurant', async () => {
    await ok('POST', '/users', admin, { username: 'ohne', name: 'Ohne Post', password: 'ohne-post-12345', role: 'user', modules: ['hotel'] });
    const none = session(await call('POST', '/auth/login', {}, { username: 'ohne', password: 'ohne-post-12345' }));
    expect((await call('GET', '/mail-cases', none)).statusCode).toBe(403);
    expect((await call('GET', '/mail-cases', {})).statusCode).toBe(401);
    // ein Angebot mit E-Mail-Verkehr
    const o = await ok('POST', '/offers', admin, { customerName: 'Angebots Kunde', email: 'ak@kunde.example', persons: 5 });
    const { logMailOut } = await import('../src/server/modules/offerthread.js');
    await logMailOut(db, o.id, 'offer', { userId: null, userName: 'Chefin' } as never, 'ak@kunde.example', `Angebot ${o.number}`, 'Unser Angebot.');
    expect((await ok('GET', '/mail-cases?status=all&kind=offer', admin)).map((r: { number: string }) => r.number)).toContain(o.number);
    expect(await ok('GET', '/mail-cases?status=all&kind=offer', mailOnly)).toEqual([]);
    expect((await ok('GET', '/mail-cases?status=all', mailOnly)).some((r: { source: string }) => r.source === 'offer')).toBe(false);
  });

  it('Zugangsdaten stehen verschlüsselt in der Datenbank; Suchbegriffe mit SQL-Zeichen sind harmlos', async () => {
    const stored = String((await db.execute(sql`select string_agg(value::text, ' ') as v from settings where key in ('inbox', 'mail')`))[0]!.v);
    expect(stored).not.toContain('geheim-imap');
    expect(stored).not.toContain('smtp-geheim');
    const res = await call('GET', `/mail-cases?status=all&q=${encodeURIComponent("'; drop table mail_cases; --")}`, admin);
    expect(res.statusCode).toBe(200);
    expect((await db.execute(sql`select count(*)::int as n from mail_cases`))[0]!.n).toBeGreaterThan(0);
  });
});
