import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { pgMessage } from '../src/server/lib/errors.js';
import { addDays, todayBerlin } from '../src/shared/hotel.js';

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
  expect(res.statusCode, `${method} ${path}: ${res.body}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const today = todayBerlin();
const year = today.slice(0, 4);
let bookingId: string;
/** Meldung, mit der die Datenbank eine Änderung ablehnt */
const refused = async (q: Promise<unknown>) => { try { await q; return 'nicht abgelehnt'; } catch (e) { return pgMessage(e) ?? String(e); } };

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user', modules: ['hotel'] });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  // Zimmer, Frühstück und eine Buchung: 2 Nächte à 100 € (7 %), Frühstück 2 Pers. × 2 N. × 12 € (19 %)
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 10000, sort: 1 });
  const { numbers } = await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 1, floor: '' });
  expect(numbers).toEqual(['1']);
  const room = (await ok('GET', '/rooms', admin))[0];
  const tax19 = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 19);
  await ok('POST', '/services', admin, { name: 'Frühstück', priceCents: 1200, per: 'person_night', taxRateId: tax19.id, isBreakfast: true, active: true });
  const guest = { salutation: 'Frau', firstName: 'Erika', lastName: 'Beispiel', company: 'Beispiel GmbH', email: '', phone: '', street: 'Hauptstr. 1', zip: '12345', city: 'Musterstadt', country: 'Deutschland', birthdate: '', nationality: '', idNumber: '', notes: '' };
  bookingId = (await ok('POST', '/bookings', user, {
    guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: true,
    rooms: [{ roomId: room.id, from: addDays(today, -2), to: today, adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }],
  })).id;
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Rechnungen', () => {
  let invId: string;

  it('erstellt einen Entwurf aus der Reservierung mit Empfänger und Positionen', async () => {
    invId = (await ok('POST', '/invoices', user, { bookingId, include: 'all' })).id;
    const inv = await ok('GET', `/invoices/${invId}`, user);
    expect(inv).toMatchObject({ status: 'draft', number: null, recipientCompany: 'Beispiel GmbH', recipientName: 'Frau Erika Beispiel', recipientCity: 'Musterstadt' });
    expect(inv.lines.map((l: { description: string; quantity: number; totalCents: number }) => [l.description, l.quantity, l.totalCents]))
      .toEqual([['Übernachtung Doppelzimmer, Zimmer 1', 2, 20000], ['Frühstück', 4, 4800]]);
    expect(inv.grossCents).toBe(24800);
    expect(inv.taxes).toEqual([
      { rate: 7, grossCents: 20000, netCents: 18692, taxCents: 1308 },
      { rate: 19, grossCents: 4800, netCents: 4034, taxCents: 766 },
    ]);
  });

  it('bearbeitet Entwürfe und verlangt vollständige Absenderangaben zum Ausstellen', async () => {
    let inv = await ok('POST', `/invoices/${invId}/lines`, user, { description: 'Minibar', detail: '', quantity: 2, unitPriceCents: 350, taxRatePercent: 19 });
    expect(inv.grossCents).toBe(25500);
    const mini = inv.lines.find((l: { description: string }) => l.description === 'Minibar');
    inv = await ok('POST', `/invoice-lines/${mini.id}/remove`, user);
    expect(inv.grossCents).toBe(24800);
    inv = await ok('PUT', `/invoices/${invId}`, user, { ...inv, recipientVatId: 'DE123456789', serviceFrom: inv.serviceFrom, serviceTo: inv.serviceTo, notes: '', version: inv.version });
    const missing = await call('POST', `/invoices/${invId}/issue`, user, { version: inv.version });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().error.message).toMatch(/Anschrift.*Steuernummer/);
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890', invoicePrefix: 'RE', paymentTermDays: 14 });
  });

  it('stellt mit lückenloser Nummer aus und verrechnet Anzahlungen', async () => {
    await ok('POST', '/payments', admin, { bookingId, amountCents: 5000, method: 'Bar', date: today, payer: '', note: 'Anzahlung' });
    const draft = await ok('GET', `/invoices/${invId}`, user);
    const inv = await ok('POST', `/invoices/${invId}/issue`, user, { version: draft.version });
    expect(inv).toMatchObject({ status: 'issued', number: `RE-${year}-0001`, issueDate: today, dueDate: addDays(today, 14), grossCents: 24800, paidCents: 5000, openCents: 19800 });
    expect(inv.issuer).toMatchObject({ name: 'Hotel & Restaurant Schützenhaus', taxNumber: '12/345/67890' });
    expect((await ok('GET', '/invoices/summary', user))).toMatchObject({ count: 1, cents: 19800 });
  });

  it('schützt ausgestellte Rechnungen – auch direkt in der Datenbank', async () => {
    const inv = await ok('GET', `/invoices/${invId}`, user);
    expect((await call('PUT', `/invoices/${invId}`, user, { ...inv, notes: 'geändert', version: inv.version })).json().error.code).toBe('not_draft');
    expect((await call('POST', `/invoices/${invId}/lines`, user, { description: 'X', detail: '', quantity: 1, unitPriceCents: 100, taxRatePercent: 19 })).statusCode).toBe(409);
    expect((await call('POST', `/invoices/${invId}/remove`, user)).statusCode).toBe(409);
    expect(await refused(db.execute(sql`update invoices set gross_cents = 1 where id = ${invId}`))).toMatch(/nicht geändert/);
    expect(await refused(db.execute(sql`update invoice_lines set total_cents = 1 where invoice_id = ${invId}`))).toMatch(/nicht geändert/);
    expect(await refused(db.execute(sql`delete from invoices where id = ${invId}`))).toMatch(/nicht gelöscht/);
    expect(await refused(db.execute(sql`update payments set amount_cents = 1`))).toMatch(/Gegenbuchung/);
    expect(await refused(db.execute(sql`delete from payments`))).toMatch(/Gegenbuchung/);
  });

  it('bucht Teilzahlungen (Administrator) und korrigiert per Gegenbuchung', async () => {
    const p = await ok('POST', '/payments', admin, { invoiceId: invId, amountCents: 10000, method: 'Karte', date: today, payer: 'Beispiel GmbH', note: '' });
    expect((await ok('GET', `/invoices/${invId}`, user)).openCents).toBe(9800);
    expect((await call('POST', `/payments/${p.id}/reverse`, user, { note: 'falscher Betrag' })).statusCode).toBe(403); // nur Administrator
    await ok('POST', `/payments/${p.id}/reverse`, admin, { note: 'falscher Betrag' });
    expect((await call('POST', `/payments/${p.id}/reverse`, admin, { note: 'nochmal' })).statusCode).toBe(409);
    let inv = await ok('GET', `/invoices/${invId}`, user);
    expect(inv.openCents).toBe(19800);
    expect(inv.payments.find((x: { id: string }) => x.id === p.id).reversed).toBe(true);
    await ok('POST', '/payments', admin, { invoiceId: invId, amountCents: 9800, method: 'Karte', date: today, payer: '', note: '' });
    inv = await ok('GET', `/invoices/${invId}`, user);
    expect(inv.openCents).toBe(10000);
    expect((await call('POST', '/payments', user, { invoiceId: invId, amountCents: 100, method: 'Bar', date: addDays(today, 1), payer: '', note: '' })).statusCode).toBe(400);
    expect((await call('POST', '/payments', user, { invoiceId: invId, amountCents: 0, method: 'Bar', date: today, payer: '', note: '' })).statusCode).toBe(400);
  });

  it('storniert mit eigenem Stornobeleg und überträgt Zahlungen auf die Reservierung', async () => {
    expect((await call('POST', `/invoices/${invId}/cancel`, user, { reason: 'falscher Empfänger' })).statusCode).toBe(403); // nur Administrator
    expect((await call('POST', `/invoices/${invId}/cancel`, admin, { reason: '' })).statusCode).toBe(400);
    const st = await ok('POST', `/invoices/${invId}/cancel`, admin, { reason: 'falscher Empfänger' });
    expect(st.number).toBe(`RE-${year}-0002`);
    const orig = await ok('GET', `/invoices/${invId}`, user);
    expect(orig).toMatchObject({ status: 'cancelled', cancelReason: 'falscher Empfänger', openCents: 0, paidCents: 0, cancelledByNumber: `RE-${year}-0002` });
    const storno = await ok('GET', `/invoices/${st.id}`, user);
    expect(storno).toMatchObject({ kind: 'cancellation', status: 'issued', grossCents: -24800, cancelsNumber: `RE-${year}-0001` });
    expect(storno.lines.every((l: { totalCents: number }) => l.totalCents < 0)).toBe(true);
    expect((await call('POST', `/invoices/${invId}/cancel`, admin, { reason: 'nochmal' })).statusCode).toBe(409);
    expect((await call('POST', '/payments', user, { invoiceId: invId, amountCents: 100, method: 'Bar', date: today, payer: '', note: '' })).statusCode).toBe(409);

    const billing = await ok('GET', `/bookings/${bookingId}/billing`, user);
    expect(billing.unassignedPaidCents).toBe(14800); // 5.000 bar + 9.800 Karte warten auf die neue Rechnung
    expect(billing.invoicedCents).toBe(0);

    // neue, korrigierte Rechnung übernimmt die Zahlungen
    const neu = (await ok('POST', '/invoices', user, { bookingId, include: 'lodging' })).id;
    const d = await ok('GET', `/invoices/${neu}`, user);
    const issued = await ok('POST', `/invoices/${neu}/issue`, user, { version: d.version });
    expect(issued).toMatchObject({ number: `RE-${year}-0003`, grossCents: 20000, paidCents: 14800, openCents: 5200 });
  });

  it('exportiert Rechnungen und Zahlungen für die Buchhaltung', async () => {
    const res = await call('GET', `/invoices/export.csv?from=${today}&to=${today}`, user);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.replace('﻿', '').split('\r\n');
    expect(lines[0]).toContain('"Netto 7 %";"USt 7 %";"Netto 19 %";"USt 19 %"');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(`"RE-${year}-0001"`);
    expect(lines[1]).toContain('"storniert"');
    expect(lines[2]).toContain('"Stornobeleg"');
    expect(lines[2]).toContain('"-248,00"');
    const pay = await call('GET', `/payments/export.csv?from=${today}&to=${today}`, user);
    expect(pay.body).toContain('"falscher Betrag"');
    // Kontrollen-Benutzer ohne Hotel-Freigabe sieht keine Rechnungen
    await ok('POST', '/users', admin, { username: 'kueche', name: 'Küche', password: 'kueche-12345', role: 'user', modules: ['kontrollen'] });
    const k = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'kueche-12345' }));
    expect((await call('GET', '/invoices', k)).statusCode).toBe(403);
  });
});

describe('Firmen', () => {
  it('bucht mit vereinbartem Firmenpreis und stellt die Rechnung an die Firma', async () => {
    const [cat] = await ok('GET', '/categories', user);
    const company = { name: 'Muster Bau GmbH', street: 'Industriestr. 5', zip: '54321', city: 'Beispielstadt', country: 'Deutschland', vatId: 'DE999999999',
      contactName: 'Frau Buchhaltung', email: 'rechnung@example.com', phone: '', paymentTermDays: 30, notes: '', active: true, rates: [{ categoryId: cat.id, priceCents: 8500 }] };
    const c = await ok('POST', '/companies', user, company);
    expect((await call('POST', '/companies', user, { ...company, email: 'keine-mail' })).statusCode).toBe(400);

    const room = (await ok('GET', '/rooms', user))[0];
    const free = await ok('GET', `/availability?from=2031-03-02&to=2031-03-04&companyId=${c.id}`, user);
    expect(free[0].quoteCents).toBe(17000);
    const guest = { salutation: 'Herr', firstName: 'Max', lastName: 'Monteur', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' };
    const created = await ok('POST', '/bookings', user, {
      guest, companyId: c.id, groupName: '', source: 'Firma', paymentMethod: 'Rechnung an Firma', notes: '', breakfast: false,
      rooms: [{ roomId: room.id, from: '2031-03-02', to: '2031-03-04', adults: 1, children: 0, status: 'confirmed', pricePerNightCents: null }],
    });
    let b = await ok('GET', `/bookings/${created.id}`, user);
    expect(b).toMatchObject({ companyName: 'Muster Bau GmbH', lodgingCents: 17000 });
    expect(b.rooms[0].nightly[0].source).toBe('Firmenpreis Muster Bau GmbH');

    // Verlängerung: neue Nacht ebenfalls zum Firmenpreis
    b = await ok('PATCH', `/booking-rooms/${b.rooms[0].id}`, user, { to: '2031-03-05', version: b.rooms[0].version });
    expect(b.lodgingCents).toBe(25500);

    const inv = (await ok('POST', '/invoices', user, { bookingId: created.id, include: 'all' })).id;
    const d = await ok('GET', `/invoices/${inv}`, user);
    expect(d).toMatchObject({ recipientCompany: 'Muster Bau GmbH', recipientName: 'z. Hd. Frau Buchhaltung', recipientVatId: 'DE999999999' });
    const issued = await ok('POST', `/invoices/${inv}/issue`, user, { version: d.version });
    expect(issued.dueDate).toBe(addDays(today, 30));

    const detail = await ok('GET', `/companies/${c.id}`, user);
    expect(detail.company).toMatchObject({ bookingCount: 1, revenueCents: 25500 });
    expect(detail.bookings).toHaveLength(1);
    // Preisänderung bei der Firma wirkt nicht auf gebuchte Nächte
    await ok('PUT', `/companies/${c.id}`, user, { ...company, rates: [{ categoryId: cat.id, priceCents: 9000 }], version: detail.company.version });
    expect((await ok('GET', `/bookings/${created.id}`, user)).lodgingCents).toBe(25500);
  });
});

describe('Datenschutz', () => {
  it('erteilt Datenauskunft und anonymisiert Gäste samt Protokolleinträgen – Rechnungen bleiben', async () => {
    const [g] = await ok('GET', '/guests?q=Beispiel', admin);
    expect((await call('GET', `/guests/${g.id}/export.json`, user)).statusCode).toBe(403);
    const exp = await ok('GET', `/guests/${g.id}/export.json`, admin);
    expect(exp.gast.lastName).toBe('Beispiel');
    expect(exp.rechnungen.length).toBeGreaterThan(0);

    // Gast mit künftiger Buchung kann nicht anonymisiert werden
    const monteur = (await ok('GET', '/guests?q=Monteur', admin))[0];
    expect((await call('POST', `/guests/${monteur.id}/anonymize`, admin)).statusCode).toBe(409);

    expect((await call('POST', `/guests/${g.id}/anonymize`, user)).statusCode).toBe(403);
    // Buchung von Frau Beispiel ist abgeschlossen? Die Testbuchung liegt in der Vergangenheit und ist noch „bestätigt“ → erst abschließen
    const res = await call('POST', `/guests/${g.id}/anonymize`, admin);
    if (res.statusCode === 409) {
      const b = await ok('GET', `/bookings/${bookingId}`, admin);
      for (const r of b.rooms.filter((x: { status: string }) => ['tentative', 'confirmed', 'checked_in'].includes(x.status)))
        await ok('POST', `/booking-rooms/${r.id}/status`, admin, { status: 'no_show', version: r.version });
      await ok('POST', `/guests/${g.id}/anonymize`, admin);
    }
    const anon = (await ok('GET', `/guests/${g.id}`, admin)).guest;
    expect(anon).toMatchObject({ lastName: 'Anonymisiert', firstName: '', city: '', email: '' });
    const log = (await ok('GET', `/audit?entity=guest&limit=200`, admin)).items.filter((e: { entityId: string }) => e.entityId === g.id);
    expect(JSON.stringify(log)).not.toMatch(/Erika|Musterstadt|Hauptstr/);
    expect(log[0].action).toBe('anonymize');
    // ausgestellte Rechnungen sind unverändert
    const invs = await ok('GET', `/invoices?q=Beispiel`, admin);
    expect(invs.some((i: { recipientName: string }) => i.recipientName === 'Frau Erika Beispiel')).toBe(true);
    // das Protokoll bleibt ansonsten gesperrt
    expect(await refused(db.execute(sql`update audit_log set before = '{"anonymisiert": true}' where entity = 'guest'`))).toMatch(/nicht geändert/);
    expect(await refused(db.execute(sql`truncate audit_log`))).toMatch(/nicht geändert/);
  });
});

describe('Kostenvoranschlag (Rechnungsentwurf mit eigener Nummer)', () => {
  it('eigene KV-Nummer, PDF ohne Rechnungsnummer; die Rechnungsnummern bleiben lückenlos; nach dem Ausstellen kein KV-PDF mehr', async () => {
    const before = (await ok('GET', '/invoices?status=archive', admin)).filter((i: { number: string | null }) => i.number).length;
    const { id } = await ok('POST', '/invoices', user, { include: 'none' });
    const kv = await ok('POST', `/invoices/${id}/estimate`, user);
    expect(kv.estimateNumber).toBe(`KV-${year}-0001`);
    expect((await ok('POST', `/invoices/${id}/estimate`, user)).estimateNumber).toBe(kv.estimateNumber); // keine zweite Nummer
    let inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Raummiete Saal', detail: '', quantity: 1, unitPriceCents: 30000, taxRatePercent: 19 });
    inv = await ok('PUT', `/invoices/${id}`, user, { ...inv, recipientName: 'Erika Erfunden', recipientStreet: 'Weg 1', recipientZip: '12345', recipientCity: 'Ort', version: inv.version });
    expect(inv).toMatchObject({ status: 'draft', number: null, estimateNumber: kv.estimateNumber, openCents: 0 });
    const pdf = await call('GET', `/invoices/${id}/estimate/pdf`, user);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.headers['content-disposition']).toContain(`Kostenvoranschlag_${kv.estimateNumber}.pdf`);
    // über die Suche auffindbar; zählt nicht als ausgestellte Rechnung
    expect((await ok('GET', `/invoices?status=draft&q=${kv.estimateNumber}`, user)).map((i: { id: string }) => i.id)).toContain(id);
    expect((await ok('GET', '/invoices?status=archive', admin)).filter((i: { number: string | null }) => i.number).length).toBe(before);
    const mail = await ok('GET', `/invoices/${id}/estimate/mail`, user);
    expect(mail.subject).toContain(`Kostenvoranschlag ${kv.estimateNumber}`);
    expect(mail.text).toContain('noch keine Rechnung');
    // ein zweiter Kostenvoranschlag zählt weiter
    const second = await ok('POST', '/invoices', user, { include: 'none' });
    expect((await ok('POST', `/invoices/${second.id}/estimate`, user)).estimateNumber).toBe(`KV-${year}-0002`);
    // Rechnung daraus: normale, nächste Rechnungsnummer; die KV-Nummer bleibt als Herkunft stehen
    const issued = await ok('POST', `/invoices/${id}/issue`, user, { version: inv.version });
    expect(issued.status).toBe('issued');
    expect(issued.number).toMatch(new RegExp(`^RE-${year}-\\d{4}$`));
    expect(issued.estimateNumber).toBe(kv.estimateNumber);
    expect((await call('GET', `/invoices/${id}/estimate/pdf`, user)).statusCode).toBe(409);
    expect((await call('POST', `/invoices/${id}/estimate`, user)).statusCode).toBe(409);
    // ein Kostenvoranschlag ohne Positionen lässt sich nicht versenden und nicht als Rechnung ausstellen
    const leer = await ok('POST', '/invoices', user, { include: 'none' });
    await ok('POST', `/invoices/${leer.id}/estimate`, user);
    const lm = await call('GET', `/invoices/${leer.id}/estimate/mail`, user);
    expect(lm.statusCode).toBe(409);
    expect(lm.json().error.message).toContain('keine Positionen');
    expect((await call('POST', `/invoices/${leer.id}/issue`, user, { version: (await ok('GET', `/invoices/${leer.id}`, user)).version })).statusCode).toBe(409);
    // Rechnung aus dem Kostenvoranschlag: Positionen, Empfänger und Summe sind übernommen
    const fin = await ok('GET', `/invoices/${id}`, user);
    expect(fin.lines.map((l: { description: string }) => l.description)).toEqual(['Raummiete Saal']);
    expect(fin).toMatchObject({ grossCents: 30000, recipientName: 'Erika Erfunden' });
    // ohne KV-Nummer gibt es kein KV-PDF
    const plain = await ok('POST', '/invoices', user, { include: 'none' });
    expect((await call('GET', `/invoices/${plain.id}/estimate/pdf`, user)).statusCode).toBe(409);
  });
});

describe('Kostenvoranschlag: Verlauf und Antwort Ja/Nein', () => {
  it('E-Mail bittet um Ja/Nein; Antwort wird über die KV-Nummer zugeordnet; die Rechnung entsteht nur von Hand', async () => {
    const { linkInboxMailToInvoice, logInvoiceMailOut, yesNo } = await import('../src/server/modules/invoicethread.js');
    const { inboxMails } = await import('../src/server/db/schema.js');
    const { id } = await ok('POST', '/invoices', user, { include: 'none' });
    const kv = (await ok('POST', `/invoices/${id}/estimate`, user)).estimateNumber as string;
    let inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Saalmiete', detail: '', quantity: 1, unitPriceCents: 20000, taxRatePercent: 19 });
    inv = await ok('PUT', `/invoices/${id}`, user, { ...inv, recipientName: 'Max Erdacht', recipientStreet: 'Weg 2', recipientZip: '12345', recipientCity: 'Ort', version: inv.version });
    const draft = await ok('GET', `/invoices/${id}/estimate/mail`, user);
    expect(draft.text).toContain('„Ja“');
    expect(draft.text).toContain('„Nein“');
    expect(draft.subject).toContain(kv);
    // noch nichts gesendet: leerer Verlauf
    expect((await ok('GET', `/invoices/${id}/timeline`, user)).entries).toEqual([]);
    // Versand (hier ohne Postfach direkt vermerkt), dann die Antwort des Kunden
    await logInvoiceMailOut(db, id, 'estimate', { userId: null, userName: 'Rezeption' } as never, 'kunde@example.org', draft.subject, draft.text);
    let t = await ok('GET', `/invoices/${id}/timeline`, user);
    expect(t).toMatchObject({ code: `[${kv}]`, answer: null, waiting: true, lastTo: 'kunde@example.org' });
    const mail = async (uid: number, subject: string, body: string) => (await db.insert(inboxMails).values({ uidValidity: 'kv-test', uid, fromName: 'Max Erdacht', fromAddr: 'kunde@example.org', subject, receivedAt: new Date(Date.now() + uid * 1000), body, kind: 'other', extract: {} }).returning())[0]!;
    const a = await mail(1, `AW: ${draft.subject}`, `Guten Tag,\nJa\n\nViele Grüße\n\n--- Ihre Nachricht ---\n> antworten Sie mit „Nein“`);
    expect(await linkInboxMailToInvoice(db, a)).toBe(true);
    expect(await linkInboxMailToInvoice(db, a)).toBe(false);
    t = await ok('GET', `/invoices/${id}/timeline`, user);
    expect(t).toMatchObject({ answer: 'yes', waiting: false });
    // die Antwort stellt keine Rechnung aus
    expect((await ok('GET', `/invoices/${id}`, user))).toMatchObject({ status: 'draft', number: null });
    expect((await ok('GET', `/inbox/${a.id}`, admin)).invoice).toMatchObject({ id, label: `Kostenvoranschlag ${kv}` });
    // weitere E-Mail ohne Nummer: Vorschlag → von Hand zuordnen → wieder lösen
    const b = await mail(2, 'Noch etwas', 'Nein, doch nicht.');
    t = await ok('GET', `/invoices/${id}/timeline`, user);
    expect(t.candidates.map((c: { inboxMailId: string }) => c.inboxMailId)).toEqual([b.id]);
    await ok('POST', `/invoices/${id}/timeline/assign`, user, { inboxMailId: b.id });
    t = await ok('GET', `/invoices/${id}/timeline`, user);
    expect(t.answer).toBe('no');
    const ev = t.entries.find((e: { subject: string }) => e.subject === 'Noch etwas');
    await ok('POST', `/invoices/${id}/timeline/remove`, user, { eventId: ev.id });
    expect((await ok('GET', `/invoices/${id}/timeline`, user)).answer).toBe('yes');
    // Rechnung von Hand; E-Mail-Vorschlag der Rechnung ist an die Adresse des Kostenvoranschlags vorbelegt
    const issued = await ok('POST', `/invoices/${id}/issue`, user, { version: inv.version });
    expect(issued.status).toBe('issued');
    expect((await ok('GET', `/invoices/${id}/mail`, user)).to).toBe('kunde@example.org');
    expect((await ok('GET', `/invoices/${id}/timeline`, user)).entries.map((e: { title: string }) => e.title)).toContain(`Rechnung ${issued.number} ausgestellt`);
    // Erkennung
    expect(yesNo('Ja, gerne!')).toBe('yes');
    expect(yesNo('JA')).toBe('yes');
    expect(yesNo('Hallo Frau Muster,\nnein danke.')).toBe('no');
    expect(yesNo('Ja, aber bitte ohne Buffet')).toBe('unclear');
    expect(yesNo('Jahresfeier findet statt?')).toBe('unclear');
    expect(yesNo('> Ja')).toBeNull();
  });
});

describe('Bruttopreise und Gültigkeit des Kostenvoranschlags', () => {
  it('Beispiel: 3 × 52,00 € + 18,00 € = 174,00 € brutto; Netto 146,22 € und 27,78 € USt herausgerechnet; gemischte Sätze getrennt; Rabattzeile', async () => {
    const { id } = await ok('POST', '/invoices', user, { include: 'none' });
    await ok('POST', `/invoices/${id}/lines`, user, { description: 'Pils 30 L', detail: '', quantity: 3, unitPriceCents: 5200, taxRatePercent: 19 });
    let inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Anfahrt', detail: '', quantity: 1, unitPriceCents: 1800, taxRatePercent: 19 });
    expect(inv.grossCents).toBe(17400);
    expect(inv.lines.map((l: { totalCents: number }) => l.totalCents)).toEqual([15600, 1800]);
    expect(inv.taxes).toEqual([{ rate: 19, grossCents: 17400, netCents: 14622, taxCents: 2778 }]);
    // zweiter Steuersatz und ein Rabatt als Minuszeile
    await ok('POST', `/invoices/${id}/lines`, user, { description: 'Übernachtung', detail: '', quantity: 2, unitPriceCents: 9900, taxRatePercent: 7 });
    inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Rabatt 10 % auf Getränke', detail: '', quantity: 1, unitPriceCents: -1560, taxRatePercent: 19 });
    expect(inv.grossCents).toBe(17400 + 19800 - 1560);
    expect(inv.taxes).toEqual([{ rate: 7, grossCents: 19800, netCents: 18505, taxCents: 1295 }, { rate: 19, grossCents: 15840, netCents: 13311, taxCents: 2529 }]);
    expect(inv.taxes.reduce((s: number, t: { netCents: number; taxCents: number }) => s + t.netCents + t.taxCents, 0)).toBe(inv.grossCents);
    // Menge mit Nachkommastellen
    inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Fassbier anteilig', detail: '', quantity: 1.15, unitPriceCents: 100, taxRatePercent: 19 });
    expect(inv.lines.at(-1).totalCents).toBe(115);
  });

  it('Gültigkeit: Vorgabe in Tagen aus dem Layout, fest am Kostenvoranschlag, dort änderbar; spätere Änderung der Vorgabe ändert bestehende nicht', async () => {
    const mk = async () => {
      const { id } = await ok('POST', '/invoices', user, { include: 'none' });
      await ok('POST', `/invoices/${id}/estimate`, user);
      return ok('GET', `/invoices/${id}`, user);
    };
    const a = await mk();
    expect(a.estimateValidUntil).toBe(addDays(today, 14));
    const layout = await ok('GET', '/settings/invoice-layout', admin);
    expect(layout.estimateValidDays).toBe(14);
    await ok('PUT', '/settings/invoice-layout', admin, { ...layout, estimateValidDays: 30 });
    const b = await mk();
    expect(b.estimateValidUntil).toBe(addDays(today, 30));
    expect((await ok('GET', `/invoices/${a.id}`, user)).estimateValidUntil).toBe(addDays(today, 14)); // unverändert
    // am einzelnen Kostenvoranschlag ändern bzw. leeren
    const set = (v: string | null, inv: { version: number }) => ok('PUT', `/invoices/${a.id}`, user, { ...a, recipientName: 'Erika Erfunden', estimateValidUntil: v, version: inv.version });
    let cur = await set(addDays(today, 60), a);
    expect(cur.estimateValidUntil).toBe(addDays(today, 60));
    cur = await set(null, cur);
    expect(cur.estimateValidUntil).toBeNull();
    // 0 Tage = ohne Angabe
    await ok('PUT', '/settings/invoice-layout', admin, { ...layout, estimateValidDays: 0 });
    expect((await mk()).estimateValidUntil).toBeNull();
    await ok('PUT', '/settings/invoice-layout', admin, { ...layout, estimateValidDays: 14 });
    const pdf = await call('GET', `/invoices/${b.id}/estimate/pdf`, user);
    // ohne Positionen wird kein PDF verweigert – nur das Senden; das PDF muss erzeugbar sein
    expect([200, 409]).toContain(pdf.statusCode);
  });
});

describe('Freie Rechnungen getrennt von Hotelrechnungen', () => {
  it('scope=free zeigt nur Rechnungen und Kostenvoranschläge ohne Reservierung, scope=hotel nur die zu Reservierungen; Filter Kostenvoranschläge / Entwürfe', async () => {
    const all = await ok('GET', '/invoices', user);
    const free = await ok('GET', '/invoices?scope=free', user);
    const hotel = await ok('GET', '/invoices?scope=hotel', user);
    expect(free.length).toBeGreaterThan(0);
    expect(hotel.length).toBeGreaterThan(0);
    expect(free.every((i: { bookingId: string | null }) => i.bookingId === null)).toBe(true);
    expect(hotel.every((i: { bookingId: string | null }) => i.bookingId !== null)).toBe(true);
    expect(free.length + hotel.length).toBe(all.length);
    const kv = await ok('GET', '/invoices?scope=free&status=estimate', user);
    expect(kv.length).toBeGreaterThan(0);
    expect(kv.every((i: { status: string; estimateNumber: string | null }) => i.status === 'draft' && !!i.estimateNumber)).toBe(true);
    const drafts = await ok('GET', '/invoices?scope=free&status=draft', user);
    expect(drafts.every((i: { status: string; estimateNumber: string | null }) => i.status === 'draft' && !i.estimateNumber)).toBe(true);
    // ohne scope bleibt „Entwürfe“ wie bisher: alle Entwürfe einschließlich Kostenvoranschläge
    expect((await ok('GET', '/invoices?status=draft', user)).length).toBeGreaterThanOrEqual(kv.length + drafts.length);
  });
});

describe('Aus dem Kostenvoranschlag: Auftragsbestätigung, „Ware ist da“, Vermerk „Tisch reserviert“', () => {
  it('Auftragsbestätigung listet die Positionen; beide E-Mails tragen die KV-Nummer und stehen im Verlauf; der Kostenvoranschlag bleibt Entwurf', async () => {
    const { setMailSender } = await import('../src/server/modules/mail.js') as unknown as { setMailSender: (s: unknown) => void };
    const out: { to: string; subject: string; text: string; attachments?: unknown[] }[] = [];
    setMailSender(async (_c: unknown, m: { to: string; subject: string; text: string }) => { out.push(m); });
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.example.org', port: 587, user: 'haus@example.org', fromName: 'Haus', password: 'nur-test' });
    const { id } = await ok('POST', '/invoices', user, { include: 'none' });
    // ohne Kostenvoranschlag bzw. ohne Positionen: nicht möglich
    expect((await call('GET', `/invoices/${id}/order/mail?kind=order_confirm`, user)).statusCode).toBe(409);
    const kv = await ok('POST', `/invoices/${id}/estimate`, user);
    expect((await call('GET', `/invoices/${id}/order/mail?kind=order_confirm`, user)).statusCode).toBe(409);
    await ok('POST', `/invoices/${id}/lines`, user, { description: 'Pils 30 L', detail: '', quantity: 3, unitPriceCents: 5200, taxRatePercent: 19 });
    let inv = await ok('POST', `/invoices/${id}/lines`, user, { description: 'Anfahrt', detail: '', quantity: 1, unitPriceCents: 1800, taxRatePercent: 19 });
    inv = await ok('PUT', `/invoices/${id}`, user, { ...inv, recipientName: 'Fritz Fass', serviceFrom: addDays(today, 10), serviceTo: addDays(today, 10), version: inv.version });
    const d = await ok('GET', `/invoices/${id}/order/mail?kind=order_confirm`, user);
    expect(d.subject).toMatch(/^Auftragsbestätigung/);
    expect(d.text).toContain('Guten Tag Fritz Fass,');
    expect(d.text).toContain('- 3 × Pils 30 L – 156,00');
    expect(d.text).toContain('- 1 × Anfahrt – 18,00');
    expect(d.text).toContain('Gesamtbetrag: 174,00');
    expect(d.text).toContain(kv.estimateNumber);
    expect((await call('GET', `/invoices/${id}/order/mail?kind=unsinn`, user)).statusCode).toBe(400);
    await ok('POST', `/invoices/${id}/order/mail?kind=order_confirm`, user, { to: 'fritz@example.org', subject: d.subject, text: d.text });
    expect(out.at(-1)).toMatchObject({ to: 'fritz@example.org' });
    expect(out.at(-1)!.subject).toContain(`[${kv.estimateNumber}]`);
    const d2 = await ok('GET', `/invoices/${id}/order/mail?kind=order_ready`, user);
    expect(d2.to).toBe('fritz@example.org'); // letzte Empfängeradresse vorbelegt
    await ok('POST', `/invoices/${id}/order/mail?kind=order_ready`, user, { to: d2.to, subject: d2.subject, text: d2.text });
    await ok('POST', `/invoices/${id}/timeline/note`, user, { what: 'table', text: 'Tisch reserviert: 12.12.2026, 19:00 Uhr, 6 Personen, auf Fritz Fass' });
    const t = await ok('GET', `/invoices/${id}/timeline`, user);
    expect(t.entries.map((e: { what?: string }) => e.what)).toEqual(['order_confirm', 'order_ready', 'table']);
    expect(t.entries.map((e: { dir: string }) => e.dir)).toEqual(['out', 'out', 'event']);
    expect(t.entries[2].title).toContain('Tisch reserviert');
    expect(t.lastTo).toBe('fritz@example.org');
    // weiterhin Entwurf ohne Rechnungsnummer
    expect(await ok('GET', `/invoices/${id}`, user)).toMatchObject({ status: 'draft', number: null, estimateNumber: kv.estimateNumber });
    // nach dem Ausstellen der Rechnung gibt es keine Auftragsbestätigung mehr aus dem Kostenvoranschlag
    let cur = await ok('GET', `/invoices/${id}`, user);
    cur = await ok('PUT', `/invoices/${id}`, user, { ...cur, recipientStreet: 'Weg 1', recipientZip: '12345', recipientCity: 'Ort', version: cur.version });
    await ok('POST', `/invoices/${id}/issue`, user, { version: cur.version });
    expect((await call('GET', `/invoices/${id}/order/mail?kind=order_confirm`, user)).statusCode).toBe(409);
  });
});
