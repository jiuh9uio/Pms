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

describe('Anhänge, Löschregeln, Rechnung aus Angebot', () => {
  const b64 = (buf: Buffer) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
  const withPdf = (name: string, pdf: Buffer) => ['Content-Type: multipart/mixed; boundary="Y"', '', '--Y', 'Content-Type: text/plain; charset=utf-8', '', 'Anbei der ausgefüllte Katalog.',
    '--Y', `Content-Type: application/pdf; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', b64(pdf), '--Y--'].join('\r\n');

  it('Anhang wird gespeichert und nur als Download ausgeliefert; ohne Modul „E-Mail“ kein Zugriff', async () => {
    const pdf = Buffer.from('%PDF-1.4\n%Testdatei\n%%EOF');
    box.push(raw(70, 'Anna Anhang <anna@kunde.example>', 'Mit Datei', '', { body: withPdf('Mein Dokument.pdf', pdf) }), raw(71, 'Html Anhang <html@kunde.example>', 'Böse Datei', '', {
      body: ['Content-Type: multipart/mixed; boundary="Z"', '', '--Z', 'Content-Type: text/plain', '', 'siehe Anhang', '--Z', 'Content-Type: text/html; name="seite.html"', 'Content-Disposition: attachment; filename="seite.html"', '', '<script>alert(1)</script>', '--Z--'].join('\r\n') }));
    await fetchNow();
    const m = (await byUid(70))! as unknown as { id: string; extract: { attachments: { id?: string; name: string; size: number }[] } };
    const a = m.extract.attachments[0]!;
    expect(a).toMatchObject({ name: 'Mein Dokument.pdf', size: pdf.length });
    expect(a.id).toBeTruthy();
    const dl = await call('GET', `/inbox/attachments/${a.id}`, admin);
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(pdf)).toBe(true);
    expect(dl.headers['content-disposition']).toMatch(/^attachment; filename="Mein Dokument\.pdf"/);
    expect(dl.headers['content-type']).toBe('application/octet-stream');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    // ein HTML-Anhang wird ebenfalls nur als Datei ausgeliefert, nie als Seite
    const h = ((await byUid(71))! as unknown as { extract: { attachments: { id: string }[] } }).extract.attachments[0]!;
    const hd = await call('GET', `/inbox/attachments/${h.id}`, admin);
    expect(hd.headers['content-type']).toBe('application/octet-stream');
    expect(hd.headers['content-disposition']).toContain('attachment');
    const none = session(await call('POST', '/auth/login', {}, { username: 'ohne', password: 'ohne-post-12345' }));
    expect((await call('GET', `/inbox/attachments/${a.id}`, none)).statusCode).toBe(403);
    expect((await call('GET', '/inbox/attachments/00000000-0000-4000-8000-000000000000', admin)).statusCode).toBe(404);
    // die Liste der Nachrichten lädt keine Dateiinhalte mit
    expect(JSON.stringify(await ok('GET', '/inbox?status=all', admin))).not.toContain('Testdatei');
  });

  it('ausgefüllter Katalog aus der E-Mail: direkt im Angebot einlesen – nur Anhänge aus dem Verlauf dieses Angebots', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const item = (await ok('POST', '/offer-items', admin, { name: 'Beamer Anhangtest', description: '', unit: 'day', priceCents: 4000, taxRatePercent: 19, area: 'both', group: '', sort: 1, active: true })).id;
    const tpl = await ok('POST', '/offer-templates', admin, { name: 'Anhang-Katalog', area: 'both', title: '', intro: '', closing: '', questions: [], validDays: 14, depositPercent: 0, items: [{ itemId: item, quantity: null, preselect: false }] });
    const o = await ok('POST', '/offers', admin, { templateId: tpl.id, customerName: 'Karl Katalog', email: 'karl@kunde.example', persons: 8 });
    await ok('POST', `/offers/${o.id}/catalog/mail`, admin, { to: 'karl@kunde.example', subject: 'Leistungskatalog', text: 'Bitte ankreuzen.' });
    const our = sent.at(-1)!;
    expect(our.subject).toContain(`[${o.number}]`);
    expect(threadCodesOf([our.messageId!])).toEqual([o.number]);
    const doc = await PDFDocument.load((await call('GET', `/offers/${o.id}/catalog/pdf`, admin)).rawPayload);
    doc.getForm().getCheckBox(`pos_${item}`).check();
    doc.getForm().getTextField('personen').setText('11');
    const filled = Buffer.from(await doc.save());
    // Antwort mit geändertem Betreff, aber technischem Verweis auf unsere E-Mail
    box.push(raw(80, 'Karl Katalog <karl@kunde.example>', 'hier das Formular', '', { body: withPdf('Katalog.pdf', filled), headers: [`In-Reply-To: ${our.messageId}`] }));
    await fetchNow();
    const t = await ok('GET', `/offers/${o.id}/timeline`, admin);
    const entry = t.entries.find((e: { dir: string; attachments: unknown[] }) => e.dir === 'in' && e.attachments.length);
    expect(entry.attachments[0]).toMatchObject({ name: 'Katalog.pdf' });
    const read = await ok('POST', `/offers/${o.id}/catalog/read-attachment`, admin, { attachmentId: entry.attachments[0].id });
    expect(read).toMatchObject({ itemIds: [item], persons: 11, offerNumber: o.number });
    expect((await call('GET', `/offers/${o.id}/attachments/${entry.attachments[0].id}`, admin)).headers['content-disposition']).toContain('attachment');
    // ein Anhang aus einer fremden E-Mail lässt sich über das Angebot nicht lesen
    const foreign = ((await byUid(70))! as unknown as { extract: { attachments: { id: string }[] } }).extract.attachments[0]!.id;
    expect((await call('POST', `/offers/${o.id}/catalog/read-attachment`, admin, { attachmentId: foreign })).statusCode).toBe(404);
    expect((await call('GET', `/offers/${o.id}/attachments/${foreign}`, admin)).statusCode).toBe(404);
  });

  it('Rechnungsentwurf aus angenommenem Angebot: Empfänger und Positionen übernommen; vorher nicht möglich', async () => {
    const o = await ok('POST', '/offers', admin, { customerCompany: 'Rechnung GmbH', customerName: 'Rita Rechnung', email: 'rita@kunde.example', persons: 4 });
    const d = await ok('GET', `/offers/${o.id}`, admin);
    await ok('PUT', `/offers/${o.id}`, admin, { ...d, street: 'Weg 3', zip: '12345', city: 'Ort', lines: [
      { itemId: null, description: 'Raummiete', detail: 'Saal', unit: 'flat', quantity: 1, unitPriceCents: 25000, taxRatePercent: 19 },
      { itemId: null, description: 'Menü', detail: '', unit: 'person', quantity: 4, unitPriceCents: 3500, taxRatePercent: 19 }], version: d.version });
    expect((await call('POST', `/offers/${o.id}/invoice`, admin, {})).statusCode).toBe(409); // noch nicht angenommen
    await ok('POST', `/offers/${o.id}/mail`, admin, { to: 'rita@kunde.example', subject: `Angebot ${o.number}`, text: 'Unser Angebot.' });
    await ok('POST', `/offers/${o.id}/accept`, admin, { method: 'telefon', name: 'Rita Rechnung', note: '' });
    const { invoiceId } = await ok('POST', `/offers/${o.id}/invoice`, admin, {});
    const inv = await ok('GET', `/invoices/${invoiceId}`, admin);
    expect(inv).toMatchObject({ status: 'draft', number: null, recipientCompany: 'Rechnung GmbH', recipientName: 'Rita Rechnung', recipientStreet: 'Weg 3', grossCents: 39000 });
    expect(inv.lines.map((l: { description: string; quantity: number; unitPriceCents: number }) => [l.description, l.quantity, l.unitPriceCents])).toEqual([['Raummiete', 1, 25000], ['Menü', 4, 3500]]);
    expect(inv.notes).toContain(o.number);
  });

  it('Löschregeln: erledigte Vorgänge gehen nach der Frist mit, offene bleiben; „Daten löschen → Posteingang“ entfernt auch die Vorgänge; Nummern werden nicht neu vergeben', async () => {
    const cases = await ok('GET', '/mail-cases?status=all&kind=hotel', admin);
    const all = (await db.execute(sql`select id, number, status from mail_cases order by number`)) as unknown as { id: string; number: string; status: string }[];
    expect(cases.length + all.length).toBeGreaterThan(0);
    const open = all.find((c) => c.status === 'open')!, other = all.find((c) => c.id !== open.id && c.status !== 'archived') ?? all.find((c) => c.id !== open.id)!;
    await ok('PATCH', `/mail-cases/${other.id}`, admin, { status: 'done' });
    // beide Vorgänge „alt“ machen; nur der erledigte darf verschwinden
    await db.execute(sql`update mail_cases set updated_at = now() - interval '40 days' where id in (${open.id}, ${other.id})`);
    await db.execute(sql`update inbox_mails set received_at = now() - interval '40 days' where case_id = ${other.id}`);
    await ok('PUT', '/settings/inbox', admin, { enabled: true, host: 'imap.example.org', port: 993, user: 'info@example.org', password: '', folder: 'INBOX', autoMinutes: 0, keepDays: 30 });
    await fetchNow();
    const left = (await db.execute(sql`select id from mail_cases`)).map((r) => r.id);
    expect(left).toContain(open.id);
    expect(left).not.toContain(other.id);
    expect((await db.execute(sql`select count(*)::int as n from mail_case_out where case_id = ${other.id}`))[0]!.n).toBe(0);
    // Daten löschen → Posteingang
    const highest = all.at(-1)!.number;
    const purge = { billing: false, bookings: 'none', guests: false, resetNumbers: false, inbox: true, companies: false, password: 'sehr-geheim-123', confirm: 'LÖSCHEN', dryRun: false };
    await ok('POST', '/settings/purge', admin, purge);
    expect((await db.execute(sql`select (select count(*) from mail_cases)::int + (select count(*) from inbox_mails)::int + (select count(*) from inbox_attachments)::int + (select count(*) from mail_case_out)::int as n`))[0]!.n).toBe(0);
    // ein neuer Vorgang bekommt eine höhere Nummer als alle früheren
    await db.execute(sql`insert into inbox_mails (uid_validity, uid, from_addr, subject, received_at, kind, extract) values ('nach', 1, 'neu@kunde.example', 'Neu', now(), 'other', '{}')`);
    const [fresh] = await db.execute(sql`select id from inbox_mails where uid_validity = 'nach'`);
    const c = await ok('POST', `/inbox/${fresh!.id}/case`, admin, {});
    expect(c.number > highest).toBe(true);
  });
});

describe('Hotelbereich, Zuständigkeit, einstellbare Hinweise', () => {
  let bookingId = '';
  beforeAll(async () => {
    const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
    await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 101, floor: '1' });
    const room = (await ok('GET', '/rooms', admin))[0];
    const guest = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: '', email: 'erika@example.com', phone: '', street: 'Weg 1', zip: '11111', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
    bookingId = (await ok('POST', '/bookings', admin, { guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: room.id, from: '2031-05-08', to: '2031-05-10', adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] })).id;
  });

  it('Bestätigung aus dem Hotelbereich: ein Vorgang zur Reservierung (erledigt), Nummer im Betreff; die Antwort des Gastes landet dort und öffnet ihn wieder', async () => {
    const before = sent.length;
    const draft = await ok('GET', `/bookings/${bookingId}/mail`, admin);
    await ok('POST', `/bookings/${bookingId}/mail`, admin, { to: draft.to, subject: draft.subject, text: draft.text });
    const [c] = await db.execute(sql`select id, number, status, kind, contact_addr, booking_id from mail_cases where booking_id = ${bookingId}`) as unknown as { id: string; number: string; status: string; kind: string; contact_addr: string; booking_id: string }[];
    expect(c).toMatchObject({ status: 'done', kind: 'hotel', contact_addr: 'erika@example.com' });
    expect(sent.length).toBe(before + 1);
    expect(sent.at(-1)!.subject).toContain(`[${c!.number}]`);
    expect(threadCodesOf([sent.at(-1)!.messageId!])).toEqual([c!.number]);
    // zweite E-Mail (Rückfrage): derselbe Vorgang, jetzt offen
    await ok('POST', `/bookings/${bookingId}/mail?as=question`, admin, { to: draft.to, subject: 'Rückfrage', text: 'Wann reisen Sie an?' });
    expect((await db.execute(sql`select count(*)::int as n from mail_cases where booking_id = ${bookingId}`))[0]!.n).toBe(1);
    const dto = await ok('GET', `/mail-cases/${c!.id}`, admin);
    expect(dto).toMatchObject({ status: 'open', bookingId, turn: 'theirs', latestInboxMailId: null });
    expect(dto.bookingNumber).toBeTruthy();
    expect(dto.messages).toHaveLength(2);
    // Antwort des Gastes mit geändertem Betreff: über den technischen Verweis in denselben Vorgang
    validity = 'hotel1';
    box = [raw(1, 'Erika Beispiel <erika@example.com>', 'Ankunft', 'Wir kommen gegen 18 Uhr.', { headers: [`In-Reply-To: ${sent.at(-1)!.messageId}`] })];
    await fetchNow();
    expect((await byUid(1))!.case_id).toBe(c!.id);
    expect((await ok('GET', `/mail-cases/${c!.id}`, admin)).turn).toBe('ours');
  });

  it('schlägt der Versand fehl, bleibt kein leerer Vorgang zurück', async () => {
    const room = (await ok('GET', '/rooms', admin))[0];
    const guest = { salutation: 'Herr', firstName: 'Paul', lastName: 'Fehler', company: '', email: 'paul@example.com', phone: '', street: '', zip: '', city: '', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
    const id = (await ok('POST', '/bookings', admin, { guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
      rooms: [{ roomId: room.id, from: '2031-06-08', to: '2031-06-10', adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] })).id;
    setMailSender(async () => { throw new Error('SMTP nicht erreichbar'); });
    const res = await call('POST', `/bookings/${id}/mail`, admin, { to: 'paul@example.com', subject: 'Bestätigung', text: 'Text' });
    setMailSender(async (_c, mail) => { sent.push(mail); });
    expect(res.statusCode).not.toBe(200);
    expect((await db.execute(sql`select count(*)::int as n from mail_cases where booking_id = ${id}`))[0]!.n).toBe(0);
  });

  it('Zuständigkeit: nur Mitarbeiter mit Zugriff wählbar; Filter „nur dieser Mitarbeiter“', async () => {
    expect(await ok('GET', '/mail-cases/assignees', mailOnly)).toEqual(['Chefin', 'Nur Post']);
    const [c] = await db.execute(sql`select id from mail_cases where booking_id = ${bookingId}`) as unknown as { id: string }[];
    expect((await ok('PATCH', `/mail-cases/${c!.id}`, mailOnly, { assignee: 'Nur Post' })).assignee).toBe('Nur Post');
    expect((await call('PATCH', `/mail-cases/${c!.id}`, admin, { assignee: 'Gibt Esnicht' })).statusCode).toBe(409);
    const mine = await ok('GET', `/mail-cases?status=all&assignee=${encodeURIComponent('Nur Post')}`, admin);
    expect(mine.map((r: { id: string }) => r.id)).toEqual([c!.id]);
    expect(mine[0].assignee).toBe('Nur Post');
    expect(await ok('GET', `/mail-cases?status=all&assignee=Chefin`, admin)).toEqual([]);
    expect((await ok('PATCH', `/mail-cases/${c!.id}`, admin, { assignee: '' })).assignee).toBe('');
  });

  it('Hinweis „Als Nächstes“: Vorgabe, Speichern nur durch den Administrator', async () => {
    const d = await ok('GET', '/case-next-texts', mailOnly);
    expect(d.hotel).toContain('Verfügbarkeit');
    expect((await call('PUT', '/case-next-texts', mailOnly, { ...d, hotel: 'Erst anrufen.' })).statusCode).toBe(403);
    await ok('PUT', '/case-next-texts', admin, { ...d, hotel: 'Erst anrufen.' });
    expect((await ok('GET', '/case-next-texts', mailOnly)).hotel).toBe('Erst anrufen.');
    expect((await call('PUT', '/case-next-texts', admin, { ...d, hotel: '' })).statusCode).toBe(400);
  });

  it('Posteingang einsortieren: Art wählen → offener Vorgang mit dieser Art; die Nachricht bleibt unbearbeitet (wir sind dran); zweimal ergibt keinen zweiten Vorgang', async () => {
    validity = 'sort1';
    box = [raw(1, 'Tina Tisch <tina@kunde.example>', 'Frage', 'Haben Sie am Samstag um 19 Uhr einen Tisch für 4 Personen?', { id: '<sortieren1@kunde.example>' })];
    await fetchNow();
    const m = (await byUid(1))!;
    expect(m.case_id).toBeNull();
    expect((await call('POST', `/inbox/${m.id}/case`, admin, { kind: 'unsinn' })).statusCode).toBe(400);
    const c = await ok('POST', `/inbox/${m.id}/case`, mailOnly, { kind: 'table' });
    const dto = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(dto).toMatchObject({ kind: 'table', status: 'open', turn: 'ours', contactAddr: 'tina@kunde.example', latestInboxMailId: m.id });
    expect((await ok('GET', `/inbox/${m.id}`, admin))).toMatchObject({ kind: 'table', status: 'new', caseId: c.id });
    const row = (await ok('GET', '/mail-cases?status=open&kind=table', admin)).find((r: { id: string }) => r.id === c.id);
    expect(row).toMatchObject({ unread: 1, turn: 'ours' });
    // noch einmal einsortieren (anderer Mitarbeiter, andere Art): derselbe Vorgang, Art bleibt
    expect((await ok('POST', `/inbox/${m.id}/case`, admin, { kind: 'hotel' })).id).toBe(c.id);
    expect((await ok('GET', `/mail-cases/${c.id}`, admin)).kind).toBe('table');
  });


  it('Absender ausfiltern: offene Nachrichten wandern nach „Ignoriert“, neue beim Abruf gleich mit; Vorgänge bleiben; Sammel-Anbieter nur je Adresse; aufheben holt zurück', async () => {
    validity = 'filter1';
    box = [raw(1, 'Lidl Plus <info@mail.lidlplus.example>', 'Angebote der Woche', 'Werbung', { id: '<f1@x.example>' }),
      raw(2, 'Lidl Plus <info@mail.lidlplus.example>', 'Noch mehr Angebote', 'Werbung', { id: '<f2@x.example>' }),
      raw(3, 'Gast <gast9@gmx.de>', 'Zimmer', 'Haben Sie ein Zimmer frei?', { id: '<f3@x.example>' })];
    await fetchNow();
    const m1 = (await byUid(1))!, m3 = (await byUid(3))!;
    // ganze Domain eines Sammel-Anbieters: abgelehnt; einzelne Adresse dort geht
    expect((await call('POST', `/inbox/${m3.id}/block-sender`, admin, { scope: 'domain' })).statusCode).toBe(409);
    expect((await ok('POST', `/inbox/${m1.id}/block-sender`, mailOnly, { scope: 'address' }))).toEqual({ entry: 'info@mail.lidlplus.example', hidden: 2 });
    expect((await byUid(2))!.status).toBe('ignored');
    expect((await byUid(3))!.status).toBe('new');
    expect((await ok('GET', `/inbox/${m1.id}`, admin)).blockedBy).toBe('info@mail.lidlplus.example');
    // nächster Abruf: gleich ausgefiltert; andere Adresse derselben Domain noch nicht
    box.push(raw(4, 'Lidl Plus <info@mail.lidlplus.example>', 'Neu', 'Werbung', { id: '<f4@x.example>' }), raw(5, 'Lidl <news@lidlplus.example>', 'Neu', 'Werbung', { id: '<f5@x.example>' }));
    await fetchNow();
    expect((await byUid(4))!.status).toBe('ignored');
    expect((await byUid(5))!.status).toBe('new');
    // Domain: gilt auch für Unterdomains
    expect((await ok('POST', `/inbox/${(await byUid(5))!.id}/block-sender`, admin, { scope: 'domain' })).entry).toBe('lidlplus.example');
    box.push(raw(6, 'X <angebote@mail.lidlplus.example>', 'Neu', 'Werbung', { id: '<f6@x.example>' }), raw(7, 'Y <chef@nichtlidlplus.example>', 'Frage', 'Hallo', { id: '<f7@x.example>' }));
    await fetchNow();
    expect((await byUid(6))!.status).toBe('ignored');
    expect((await byUid(7))!.status).toBe('new');
    // Nachricht mit Vorgang bleibt beim Ausfiltern, wo sie ist
    const c = await ok('POST', `/inbox/${m3.id}/case`, admin, { kind: 'hotel' });
    expect((await ok('POST', `/inbox/${m3.id}/block-sender`, admin, { scope: 'address' })).hidden).toBe(0);
    expect((await byUid(3))!).toMatchObject({ status: 'new', case_id: c.id });
    expect((await ok('GET', '/inbox/blocked-senders', admin)).sort()).toEqual(['gast9@gmx.de', 'info@mail.lidlplus.example', 'lidlplus.example']);
    // aufheben: was nur wegen des Filters ignoriert war, ist wieder neu
    expect((await ok('POST', '/inbox/blocked-senders/remove', admin, { entry: 'info@mail.lidlplus.example' })).restored).toBe(0); // die Domain ist weiter ausgefiltert – nichts kommt zurück
    expect((await ok('POST', '/inbox/blocked-senders/remove', admin, { entry: 'lidlplus.example' })).restored).toBeGreaterThan(0);
    expect((await call('POST', '/inbox/blocked-senders/remove', admin, { entry: 'gibtesnicht.example' })).statusCode).toBe(404);
  });


  it('Bestellung (z. B. ein Fass): einsortieren → Auftragsbestätigung → „Ware ist da“; der Stand wird am Vorgang geführt und überlebt „Regeln neu anwenden“', async () => {
    validity = 'order1';
    box = [raw(1, 'Fritz Fass <fritz@kunde.example>', 'Bestellung', 'Hallo, ich möchte für den 12.12. ein Fass Pils 30 L bestellen.', { id: '<order1@kunde.example>' })];
    await fetchNow();
    const m = (await byUid(1))!;
    const c = await ok('POST', `/inbox/${m.id}/case`, admin, { kind: 'order' });
    let dto = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(dto).toMatchObject({ kind: 'order', status: 'open', orderConfirmedAt: null, orderReadyAt: null });
    expect((await ok('GET', '/case-next-texts', admin)).order).toContain('Auftragsbestätigung');
    // Auftragsbestätigung: Entwurf mit Lücken für Artikel, Preis, Termin
    const d1 = await ok('GET', `/inbox/${m.id}/mail?template=order_confirm`, admin);
    expect(d1.subject).toMatch(/^Auftragsbestätigung/);
    expect(d1.text).toContain('Artikel und Menge');
    expect(d1.to).toBe('fritz@kunde.example');
    const n = sent.length;
    await ok('POST', `/inbox/${m.id}/mail?template=order_confirm`, admin, { to: d1.to, subject: d1.subject, text: d1.text.replace('Artikel und Menge: ', 'Artikel und Menge: 1 × Pils 30 L') });
    expect(sent.length).toBe(n + 1);
    expect(sent.at(-1)!.subject).toContain(`[${c.number}]`);
    dto = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(dto.orderConfirmedAt).toBeTruthy();
    expect(dto.orderReadyAt).toBeNull();
    // Regeln neu anwenden darf weder die Art noch den Stand zurücksetzen
    await ok('POST', '/inbox/reclassify', admin, {});
    expect((await ok('GET', `/inbox/${m.id}`, admin)).kind).toBe('order');
    expect((await ok('GET', `/mail-cases/${c.id}`, admin)).orderConfirmedAt).toBe(dto.orderConfirmedAt);
    // Ware ist da
    const d2 = await ok('GET', `/inbox/${m.id}/mail?template=order_ready`, admin);
    expect(d2.subject).toMatch(/^Ihre Bestellung ist da/);
    await ok('POST', `/inbox/${m.id}/mail?template=order_ready`, admin, { to: d2.to, subject: d2.subject, text: d2.text });
    dto = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(dto.orderReadyAt).toBeTruthy();
    expect(dto.messages.filter((x: { dir: string }) => x.dir === 'out')).toHaveLength(2);
    expect((await call('GET', `/inbox/${m.id}/mail?template=gibtesnicht`, admin)).statusCode).toBe(400);
    // Filter nach Art in der Liste
    expect((await ok('GET', '/mail-cases?status=all&kind=order', admin)).map((r: { id: string }) => r.id)).toEqual([c.id]);
  });


  it('Kontaktformular: Kontakt, Anrede und Antwortadresse kommen aus dem Text – nicht „MyWebsite <no-reply@…>“; Ausfiltern ist gesperrt; alter Vorgang wird berichtigt', async () => {
    validity = 'form1';
    const text = 'Sie haben eine Formularnachricht über https://www.haus.example/kontakt/ erhalten.\r\n\r\nName: Erika Mustermann\r\nE-Mail-Adresse: erika.form@kunde.example\r\nTelefon: 01234 56789\r\nNachricht: Haben Sie am Samstag um 19 Uhr einen Tisch für 4 Personen?';
    box = [raw(1, 'MyWebsite <no-reply@mywebsite-editor.example>', 'Neue Formularnachricht', text, { id: '<form1@x.example>' }),
      raw(2, 'MyWebsite <no-reply@mywebsite-editor.example>', 'Neue Formularnachricht', text.replace('Erika Mustermann', 'Max Muster').replace('erika.form', 'max.form'), { id: '<form2@x.example>' })];
    await fetchNow();
    const m = (await byUid(1))!, m2 = (await byUid(2))!;
    expect(await ok('GET', `/inbox/${m.id}`, admin)).toMatchObject({ contactName: 'Erika Mustermann', contactAddr: 'erika.form@kunde.example', viaForm: true, fromName: 'MyWebsite' });
    expect((await call('POST', `/inbox/${m.id}/block-sender`, admin, { scope: 'address' })).statusCode).toBe(409);
    const c = await ok('POST', `/inbox/${m.id}/case`, admin, { kind: 'table' });
    expect(await ok('GET', `/mail-cases/${c.id}`, admin)).toMatchObject({ contactName: 'Erika Mustermann', contactAddr: 'erika.form@kunde.example' });
    const d = await ok('GET', `/inbox/${m.id}/mail?template=reply`, admin);
    expect(d.to).toBe('erika.form@kunde.example');
    expect(d.text.startsWith('Guten Tag Erika Mustermann,')).toBe(true);
    await ok('POST', `/inbox/${m.id}/mail?template=reply`, admin, { to: d.to, subject: d.subject, text: d.text });
    // die Antwort der Kundin von ihrer eigenen Adresse landet im Vorgang
    box.push(raw(3, 'Erika Mustermann <erika.form@kunde.example>', `Re: Neue Formularnachricht [${c.number}]`, 'Ja, gern.', { id: '<form3@x.example>' }));
    await fetchNow();
    expect((await byUid(3))!.case_id).toBe(c.id);
    // älterer Vorgang, der noch „MyWebsite“ als Kontakt gespeichert hat: wird beim Öffnen berichtigt
    const c2 = await ok('POST', `/inbox/${m2.id}/case`, admin, { kind: 'table' });
    await db.execute(sql`update mail_cases set contact_name = 'MyWebsite', contact_addr = 'no-reply@mywebsite-editor.example' where id = ${c2.id}`);
    expect(await ok('GET', `/mail-cases/${c2.id}`, admin)).toMatchObject({ contactName: 'Max Muster', contactAddr: 'max.form@kunde.example' });
    expect((await db.execute(sql`select contact_name from mail_cases where id = ${c2.id}`))[0]!.contact_name).toBe('Max Muster');
  });


  it('Absage: wird am Vorgang vermerkt (kein „reserviert“ oder „bestätigt“); freie Antworten vermerken nichts', async () => {
    validity = 'absage1';
    box = [raw(1, 'Hans Eschbach <hans@kunde.example>', 'Tisch', 'Haben Sie am 24.12. um 18 Uhr einen Tisch für 6 Personen?', { id: '<absage1@x.example>' })];
    await fetchNow();
    const m = (await byUid(1))!;
    const c = await ok('POST', `/inbox/${m.id}/case`, admin, { kind: 'table' });
    await ok('POST', `/inbox/${m.id}/mail?template=reply`, admin, { to: 'hans@kunde.example', subject: 'Re: Tisch', text: 'Wir prüfen das.' });
    expect((await ok('GET', `/mail-cases/${c.id}`, admin))).toMatchObject({ declinedAt: null, confirmedAt: null });
    const d = await ok('GET', `/inbox/${m.id}/mail?template=decline`, admin);
    await ok('POST', `/inbox/${m.id}/mail?template=decline`, admin, { to: d.to, subject: d.subject, text: d.text });
    const dto = await ok('GET', `/mail-cases/${c.id}`, admin);
    expect(dto.declinedAt).toBeTruthy();
    expect(dto).toMatchObject({ confirmedAt: null, latestLinkKind: null });
  });


  it('Vorgang nachträglich bearbeiten: Name und E-Mail-Adresse; bei Formular-E-Mails geht die Antwort an die berichtigte Adresse', async () => {
    validity = 'edit1';
    box = [raw(1, 'MyWebsite <no-reply@mywebsite-editor.example>', 'Neue Formularnachricht', 'Hallo,\r\n\r\nName:\r\nWolfram Eschbach\r\n\r\nE-Mail-Adresse:\r\nwolfram@kunde.example\r\n\r\nIhre Nachricht:\r\nBitte um Reservierung für 10 Personen.', { id: '<edit1@x.example>' })];
    await fetchNow();
    const m = (await byUid(1))!;
    const c = await ok('POST', `/inbox/${m.id}/case`, admin, { kind: 'table' });
    expect(await ok('GET', `/mail-cases/${c.id}`, admin)).toMatchObject({ contactName: 'Wolfram Eschbach', contactAddr: 'wolfram@kunde.example' });
    expect((await call('PATCH', `/mail-cases/${c.id}`, admin, { contactAddr: 'keine-adresse' })).statusCode).toBe(400);
    const dto = await ok('PATCH', `/mail-cases/${c.id}`, mailOnly, { contactName: 'Wolfgang Eschbach', contactAddr: 'Wolfgang@Kunde.example' });
    expect(dto).toMatchObject({ contactName: 'Wolfgang Eschbach', contactAddr: 'wolfgang@kunde.example' });
    // bleibt nach erneutem Öffnen so (wird nicht wieder aus dem Formular überschrieben)
    expect(await ok('GET', `/mail-cases/${c.id}`, admin)).toMatchObject({ contactName: 'Wolfgang Eschbach', contactAddr: 'wolfgang@kunde.example' });
    const d = await ok('GET', `/inbox/${m.id}/mail?template=reply`, admin);
    expect(d.to).toBe('wolfgang@kunde.example');
    expect(d.text.startsWith('Guten Tag Wolfgang Eschbach,')).toBe(true);
  });

});
