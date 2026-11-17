import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

/** Angebote: Katalog, Vorlagen, AGB-Dokumente, Angebot, PDF, Annahme (von Hand und online), Anzahlung. */
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
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();
const GUEST = { salutation: 'Frau', firstName: 'Erika', lastName: 'Pruefung', company: '', email: '', phone: '', street: 'Weg 1', zip: '12345', city: 'Ort', country: 'Deutschland', birthdate: '', nationality: '', idNumber: 'X123', notes: '' };
let roomIds: string[] = [];

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 2, firstNumber: 101, floor: '1' });
  roomIds = (await ok('GET', '/rooms', admin)).map((r: { id: string }) => r.id);
});
afterAll(async () => { await app.close(); await close(); });

describe('Angebote', () => {
  let itemId = '', offerId = '';
  it('Katalog und Vorlagen: nur Administrator ändert; Mustervorlagen ohne Preise sind da', async () => {
    const tpls = await ok('GET', '/offer-templates', user);
    expect(tpls.map((t: { name: string }) => t.name)).toEqual(['Tagung', 'Familienfeier', 'Weihnachtsfeier', 'Gruppenübernachtung']);
    expect(tpls[0].items).toEqual([]);
    expect(tpls[0].questions.length).toBeGreaterThan(3);
    const item = { name: 'Tagungspauschale ganztags', description: 'Raum, Technik, 2 Kaffeepausen, Mittagessen', unit: 'person_day', priceCents: 4900, taxRatePercent: 19, area: 'both', sort: 1, active: true };
    expect((await call('POST', '/offer-items', user, item)).statusCode).toBe(403);
    itemId = (await ok('POST', '/offer-items', admin, item)).id;
    await ok('POST', '/offer-items', admin, { ...item, name: 'Übernachtung EZ', unit: 'night', priceCents: 7900, taxRatePercent: 7, sort: 2 });
    await ok('PUT', `/offer-templates/${tpls[0].id}`, admin, { ...tpls[0], items: [{ itemId, quantity: null }], depositPercent: 30 });
  });

  it('AGB als PDF hochladen; keine PDF wird abgelehnt', async () => {
    const up = (body: Buffer, who = admin) => app.inject({ method: 'POST', url: '/api/v1/offer-documents', headers: { 'content-type': 'application/octet-stream', cookie: `pms_session=${who.pms_session}`, 'x-file-name': encodeURIComponent('AGB Hotel.pdf'), 'x-doc-name': encodeURIComponent('AGB Hotel') }, payload: body });
    expect((await up(Buffer.from('kein pdf'))).statusCode).toBe(400);
    expect((await up(Buffer.from('%PDF-1.4 test'), user)).statusCode).toBe(403);
    const d = (await up(Buffer.from('%PDF-1.4\n%Test-AGB\n%%EOF'))).json();
    expect(d).toMatchObject({ name: 'AGB Hotel', fileName: 'AGB Hotel.pdf' });
    const tpls = await ok('GET', '/offer-templates', user);
    await ok('PUT', `/offer-templates/${tpls[0].id}`, admin, { ...tpls[0], documentIds: [d.id] });
  });

  it('Angebot aus Vorlage: Menge aus Personen × Tagen, PDF, Bearbeiten, E-Mail-Entwurf', async () => {
    const tpl = (await ok('GET', '/offer-templates', user))[0];
    expect((await call('POST', '/offers', user, { templateId: tpl.id, persons: 20 })).statusCode).toBe(400); // ohne Namen
    const o = await ok('POST', '/offers', user, { templateId: tpl.id, customerCompany: 'Muster GmbH', customerName: 'Erika Muster', email: 'erika@example.org', persons: 20, eventDate: addDays(today, 30), eventEnd: addDays(today, 31) });
    expect(o.number).toMatch(/^AN-\d{4}-0001$/);
    offerId = o.id;
    const d = await ok('GET', `/offers/${offerId}`, user);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ quantity: 40, unitPriceCents: 4900, totalCents: 196000 });
    expect(d.depositPercent).toBe(30);
    expect(d.state).toBe('draft');
    const pdf = await call('GET', `/offers/${offerId}/pdf`, user);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    await ok('PUT', `/offers/${offerId}`, user, { ...d, lines: [...d.lines, { itemId: null, description: 'Getränkepauschale', detail: '', unit: 'person', quantity: 20, unitPriceCents: 1500, taxRatePercent: 19 }], version: d.version });
    const d2 = await ok('GET', `/offers/${offerId}`, user);
    expect(d2.totalCents).toBe(196000 + 30000);
    const m = await ok('GET', `/offers/${offerId}/mail`, user);
    expect(m.to).toBe('erika@example.org');
    expect(m.text).toMatch(/Angebot AN-.*20 Personen/);
    expect(m.text).toMatch(/Genaue Teilnehmerzahl/);
    // Versand ohne Postfach: Fehler, Angebot bleibt Entwurf
    expect((await call('POST', `/offers/${offerId}/mail`, user, { to: m.to, subject: m.subject, text: m.text })).statusCode).toBe(409);
    expect((await ok('GET', `/offers/${offerId}`, user)).status).toBe('draft');
  });

  it('Online annehmen über den Link: nur versendete, gültige Angebote; Prüfwert und Aufgabe im Übergabebuch', async () => {
    // Versand nachbilden (ohne E-Mail-Postfach)
    await db.execute(sql`update offers set status = 'sent', sent_pdf = '\x255044462d'::bytea, sent_hash = 'abc123', sent_at = now() where id = ${offerId}`);
    const link = await ok('GET', `/offers/${offerId}/link`, user);
    const token = new URL(link.url).pathname.split('/')[2]!;
    const pub = await ok('GET', `/public/offer/${token}`, {});
    expect(pub).toMatchObject({ state: 'sent', persons: 20, totalCents: 226000 });
    expect(pub.documents).toHaveLength(1);
    expect((await call('GET', `/public/offer/${token}/doc/${pub.documents[0].id}`, {})).statusCode).toBe(200);
    expect((await call('GET', `/public/offer/${token.slice(0, -2)}xx`, {})).statusCode).toBe(404);
    expect((await call('POST', `/public/offer/${token}/accept`, {}, { name: 'Erika Muster', agree: false })).statusCode).toBe(400);
    const acc = await call('POST', `/public/offer/${token}/accept`, {}, { name: 'Erika Muster', agree: true });
    expect(acc.statusCode, acc.body).toBe(200);
    const d = await ok('GET', `/offers/${offerId}`, user);
    expect(d).toMatchObject({ status: 'accepted', acceptedBy: 'Erika Muster', acceptedMethod: 'online', acceptedHash: 'abc123' });
    expect((await call('POST', `/public/offer/${token}/accept`, {}, { name: 'X Y', agree: true })).statusCode).toBe(409);
    const [n] = await db.execute(sql`select text from team_notes order by created_at desc limit 1`);
    expect(String(n!.text)).toMatch(/online angenommen von Erika Muster/);
    // angenommen: Inhalt nicht mehr änderbar, die interne Notiz schon
    const body = { ...d, validUntil: d.validUntil, lines: d.lines.map((l: Record<string, unknown>) => ({ itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxRatePercent: l.taxRatePercent })) };
    expect((await call('PUT', `/offers/${offerId}`, user, { ...body, lines: [{ ...body.lines[0], unitPriceCents: 1 }], version: d.version })).statusCode).toBe(409);
    await ok('PUT', `/offers/${offerId}`, user, { ...body, notes: 'Rückruf Freitag', version: d.version });
    const d3 = await ok('GET', `/offers/${offerId}`, user);
    expect(d3).toMatchObject({ status: 'accepted', notes: 'Rückruf Freitag', acceptedHash: 'abc123' });
  });

  it('Anzahlung zum Angebot erst nach Annahme; Annahme von Hand; Ablehnen', async () => {
    await ok('POST', `/offers/${offerId}/deposits`, user, { amountCents: 67800, dueDate: addDays(today, 7), send: false });
    const dep = await ok('GET', `/offers/${offerId}/deposits`, user);
    expect(dep[0]).toMatchObject({ amountCents: 67800, state: 'open' });
    await ok('POST', `/offers/deposits/${dep[0].id}/paid`, user, { note: 'Überweisung' });
    const o2 = await ok('POST', '/offers', user, { templateId: null, customerName: 'Max Telefon', persons: 8 });
    expect((await call('POST', `/offers/${o2.id}/deposits`, user, { amountCents: 1000, dueDate: addDays(today, 7), send: false })).statusCode).toBe(409);
    // ohne Positionen keine Annahme
    expect((await call('POST', `/offers/${o2.id}/accept`, user, { method: 'telefon', name: 'Max Telefon', note: '' })).statusCode).toBe(409);
    const e2 = await ok('GET', `/offers/${o2.id}`, user);
    await ok('PUT', `/offers/${o2.id}`, user, { area: e2.area, customerCompany: '', customerName: 'Max Telefon', email: '', phone: '', street: '', zip: '', city: '', eventDate: null, eventEnd: null, persons: 8,
      title: '', intro: '', closing: '', questions: [], validUntil: e2.validUntil, depositPercent: 0, documentIds: [], notes: '', version: e2.version,
      lines: [{ itemId: null, description: 'Raummiete', detail: '', unit: 'flat', quantity: 1, unitPriceCents: 20000, taxRatePercent: 19 }] });
    // im Entwurf gibt es noch nichts anzunehmen
    expect((await call('POST', `/offers/${o2.id}/accept`, user, { method: 'telefon', name: 'Max Telefon', note: '' })).statusCode).toBe(409);
    await db.execute(sql`update offers set status = 'sent', sent_at = now() where id = ${o2.id}`);
    await ok('POST', `/offers/${o2.id}/accept`, user, { method: 'telefon', name: 'Max Telefon', note: 'am Telefon zugesagt' });
    const d2 = await ok('GET', `/offers/${o2.id}`, user);
    expect(d2).toMatchObject({ status: 'accepted', acceptedMethod: 'telefon' });
    expect(d2.acceptedHash).toMatch(/^[0-9a-f]{64}$/);
    const o3 = await ok('POST', '/offers', user, { templateId: null, customerName: 'Nein Danke', persons: 2 });
    expect((await call('POST', `/offers/${o3.id}/decline`, user)).statusCode).toBe(409); // Entwurf
    await db.execute(sql`update offers set status = 'sent', sent_at = now() where id = ${o3.id}`);
    await ok('POST', `/offers/${o3.id}/decline`, user);
    expect((await call('POST', `/offers/${o3.id}/decline`, user)).statusCode).toBe(409);
    expect((await ok('GET', '/offers?state=declined', user)).map((x: { id: string }) => x.id)).toEqual([o3.id]);
  });

  it('Links mit Punkt im Zugangscode liefern die Seite (nicht „Unbekannte Adresse“)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pms-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>PMS</title>');
    const web = await buildApp({ db, webDir: dir });
    for (const u of ['/buchung/0123456789abcdef0123456789abcdef.ABCdef123', '/angebot/0123456789abcdef0123456789abcdef.XyZ', '/reservierungen']) {
      const r = await web.inject({ method: 'GET', url: u });
      expect(r.statusCode, u).toBe(200);
      expect(r.body).toContain('<title>PMS</title>');
    }
    expect((await web.inject({ method: 'GET', url: '/fehlt.js' })).statusCode).toBe(404);
    await web.close();
  });
});

describe('Angebote – Korrekturen aus der Prüfung', () => {
  const base = (o: Record<string, any>) => ({ area: o.area, customerCompany: o.customerCompany, customerName: o.customerName, email: o.email, phone: o.phone, street: o.street, zip: o.zip, city: o.city,
    eventDate: o.eventDate, eventEnd: o.eventEnd, persons: o.persons, title: o.title, intro: o.intro, closing: o.closing, questions: o.questions, validUntil: o.validUntil, depositPercent: o.depositPercent,
    documentIds: o.documentIds, notes: o.notes, version: o.version,
    lines: o.lines.map((l: Record<string, unknown>) => ({ itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxRatePercent: l.taxRatePercent })) });
  let id = '';
  it('interne Notiz an einem versendeten Angebot: bleibt versendet, Link bleibt gültig; Inhaltsänderung → Entwurf', async () => {
    const o = await ok('POST', '/offers', user, { templateId: null, customerName: 'Notiz Test', persons: 4 });
    id = o.id;
    let d = await ok('GET', `/offers/${id}`, user);
    await ok('PUT', `/offers/${id}`, user, { ...base(d), lines: [{ itemId: null, description: 'Saal', detail: '', unit: 'flat', quantity: 0.125, unitPriceCents: 8000, taxRatePercent: 19 }] });
    d = await ok('GET', `/offers/${id}`, user);
    // Menge wird auf 2 Stellen gerundet, die Zeilensumme passt dazu
    expect(d.lines[0]).toMatchObject({ quantity: 0.13, totalCents: 1040 });
    await db.execute(sql`update offers set status = 'sent', sent_pdf = '\x255044462d'::bytea, sent_hash = 'h1', sent_at = now() where id = ${id}`);
    d = await ok('GET', `/offers/${id}`, user);
    const r = await ok('PUT', `/offers/${id}`, user, { ...base(d), notes: 'Kunde ruft Freitag zurück' });
    expect(r.backToDraft).toBe(false);
    d = await ok('GET', `/offers/${id}`, user);
    expect(d).toMatchObject({ status: 'sent', sentHash: 'h1', notes: 'Kunde ruft Freitag zurück' });
    const r2 = await ok('PUT', `/offers/${id}`, user, { ...base(d), persons: 5 });
    expect(r2.backToDraft).toBe(true);
  });
  it('abgelaufene Gültigkeit: kein E-Mail-Vorschlag und kein Versand', async () => {
    const d = await ok('GET', `/offers/${id}`, user);
    await ok('PUT', `/offers/${id}`, user, { ...base(d), validUntil: addDays(today, -1) });
    const res = await call('GET', `/offers/${id}/mail`, user);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatch(/nur bis zum/);
  });
  it('Statusfilter der Liste arbeitet in der Datenbank (abgelaufen / offen)', async () => {
    await db.execute(sql`update offers set status = 'sent' where id = ${id}`);
    const expired = await ok('GET', '/offers?state=expired', user);
    expect(expired.map((x: { id: string }) => x.id)).toContain(id);
    expect((await ok('GET', '/offers?state=sent', user)).map((x: { id: string }) => x.id)).not.toContain(id);
    expect((await ok('GET', '/offers?state=open', user)).map((x: { id: string }) => x.id)).toContain(id);
  });
  it('Anzahlungen nur im eigenen Bereich änderbar', async () => {
    const [dep] = await db.execute(sql`select value from settings where key = 'deposit_requests'`) as unknown as { value: { id: string; kind: string }[] }[];
    const offerDep = dep!.value.find((x) => x.kind === 'offer')!;
    expect((await call('POST', `/restaurant/deposits/${offerDep.id}/cancel`, admin, {})).statusCode).toBe(404);
    expect((await call('POST', `/deposits/${offerDep.id}/cancel`, admin, {})).statusCode).toBe(404);
  });
});

describe('Angebote: erst nur Fragen stellen', () => {
  it('Fragen senden (ohne PDF), online beantworten, dann daraus ein Angebot machen', async () => {
    const o = await ok('POST', '/offers', user, { templateId: null, mode: 'questions', customerName: 'Frage Kunde', email: 'frage@example.org', persons: 30 });
    let d = await ok('GET', `/offers/${o.id}`, user);
    expect(d).toMatchObject({ mode: 'questions', validUntil: null, state: 'draft' });
    // ohne Fragen kein Versand; kein PDF; keine Annahme
    expect((await call('GET', `/offers/${o.id}/mail`, user)).statusCode).toBe(409);
    expect((await call('GET', `/offers/${o.id}/pdf`, user)).statusCode).toBe(409);
    await ok('PUT', `/offers/${o.id}`, user, { area: d.area, mode: 'questions', customerCompany: '', customerName: 'Frage Kunde', email: 'frage@example.org', phone: '', street: '', zip: '', city: '',
      eventDate: null, eventEnd: null, persons: 30, title: 'Sommerfest', intro: '', closing: '', questions: ['Wie viele Kinder?', 'Buffet oder Menü?'], validUntil: null, depositPercent: 0, documentIds: [], notes: '', lines: [], version: d.version });
    const m = await ok('GET', `/offers/${o.id}/mail`, user);
    expect(m.text).toMatch(/Wie viele Kinder\?/);
    expect(m.attachment).toBe('');
    // Versand nachbilden
    await db.execute(sql`update offers set status = 'sent', sent_at = now() where id = ${o.id}`);
    d = await ok('GET', `/offers/${o.id}`, user);
    expect(d.state).toBe('asked');
    expect((await call('POST', `/offers/${o.id}/accept`, user, { method: 'telefon', name: 'X', note: '' })).statusCode).toBe(409);
    const token = new URL((await ok('GET', `/offers/${o.id}/link`, user)).url).pathname.split('/')[2]!;
    const pub = await ok('GET', `/public/offer/${token}`, {});
    expect(pub).toMatchObject({ mode: 'questions', questions: ['Wie viele Kinder?', 'Buffet oder Menü?'], totalCents: 0, documents: [] });
    expect((await call('POST', `/public/offer/${token}/accept`, {}, { name: 'Frage Kunde', agree: true })).statusCode).toBe(409);
    expect((await call('POST', `/public/offer/${token}/answer`, {}, { name: 'Frage Kunde', answers: ['', ''] })).statusCode).toBe(400);
    await ok('POST', `/public/offer/${token}/answer`, {}, { name: 'Frage Kunde', answers: ['5 Kinder', 'Buffet'] });
    expect((await call('POST', `/public/offer/${token}/answer`, {}, { name: 'Frage Kunde', answers: ['x', 'y'] })).statusCode).toBe(409); // nur einmal
    d = await ok('GET', `/offers/${o.id}`, user);
    expect(d.state).toBe('answered');
    expect(d.answers.items).toEqual([{ q: 'Wie viele Kinder?', a: '5 Kinder' }, { q: 'Buffet oder Menü?', a: 'Buffet' }]);
    const [n] = await db.execute(sql`select text from team_notes order by created_at desc limit 1`);
    expect(String(n!.text)).toMatch(/Antworten zu .* eingegangen/);
    expect((await ok('GET', '/offers?state=answered', user)).map((x: { id: string }) => x.id)).toContain(o.id);
    // daraus ein Angebot machen: Entwurf mit Gültigkeit, Antworten bleiben, alter Link gilt nicht mehr
    await ok('POST', `/offers/${o.id}/to-offer`, user);
    d = await ok('GET', `/offers/${o.id}`, user);
    expect(d).toMatchObject({ mode: 'offer', status: 'draft' });
    expect(d.validUntil).toBeTruthy();
    expect(d.answers.items).toHaveLength(2);
    expect((await call('GET', `/public/offer/${token}`, {})).statusCode).toBe(404);
  });
});

describe('Fragenkatalog zum Anklicken', () => {
  it('wird aus den Vorlagen zusammengestellt; alle dürfen ergänzen, nur der Administrator entfernt', async () => {
    const bank = await ok('GET', '/offer-questions', user);
    expect(bank.length).toBeGreaterThan(5);
    expect(bank).toContain('Genaue Teilnehmerzahl');
    const after = await ok('POST', '/offer-questions', user, { question: 'Wird ein Sektempfang gewünscht?' });
    expect(after).toContain('Wird ein Sektempfang gewünscht?');
    // doppelt (auch in anderer Schreibweise) wird nicht noch einmal aufgenommen
    expect((await ok('POST', '/offer-questions', user, { question: 'wird ein sektempfang gewünscht?' })).length).toBe(after.length);
    expect((await call('POST', '/offer-questions/remove', user, { question: 'Wird ein Sektempfang gewünscht?' })).statusCode).toBe(403);
    const removed = await ok('POST', '/offer-questions/remove', admin, { question: 'Wird ein Sektempfang gewünscht?' });
    expect(removed).not.toContain('Wird ein Sektempfang gewünscht?');
  });
});
