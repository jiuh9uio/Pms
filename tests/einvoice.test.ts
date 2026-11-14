import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.PMS_DATA_DIR = mkdtempSync(join(tmpdir(), 'pms-test-'));
const { buildApp } = await import('../src/server/app.js');
const { connect, runMigrations } = await import('../src/server/db/client.js');
const { buildXml } = await import('../src/server/einvoice/xml.js');
const { setMailSender } = await import('../src/server/modules/mail.js');
const { computeEInvoice, einvoiceData } = await import('../src/shared/einvoice.js');
const { addDays, todayBerlin } = await import('../src/shared/hotel.js');

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
const today = todayBerlin();
const sent: { to: string; subject: string; files: string[]; from: string; pass: string }[] = [];

const DATA = {
  number: 'R-4711', issueDate: today, serviceFrom: today, serviceTo: today, dueDate: addDays(today, 14),
  seller: { name: 'Hotel & Restaurant Schützenhaus', street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', country: 'DE', vatId: '', taxNumber: '12/345/67890', email: '', phone: '', contactName: '' },
  buyer: { name: 'Müller & Söhne <GmbH>', street: 'Hauptstr. 2', zip: '54321', city: 'Beispielstadt', country: 'DE', vatId: 'DE123456789', email: 'rechnung@example.com', reference: '' },
  lines: [{ name: 'Speisen laut Beleg', quantity: 3, unitGrossCents: 3333, taxRate: 7 }, { name: 'Getränke', quantity: 1, unitGrossCents: 4999, taxRate: 19 }],
  paidCents: 0, paymentMeans: '58', iban: 'DE00 1234 5678 9012 3456 78', bic: '', paymentTerms: 'Zahlbar binnen 14 Tagen.', note: '',
};
const num = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<ram:${tag}[^>]*>([-0-9.]+)</ram:${tag}>`, 'g'))].map((m) => Math.round(Number(m[1]) * 100));

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  setMailSender(async (c, m) => { sent.push({ to: m.to, subject: m.subject, files: (m.attachments ?? []).map((a) => a.filename), from: m.from.address, pass: c.pass }); });
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Rechnungsdaten nach EN 16931', () => {
  it('rechnet Brutto in Netto um und bleibt in sich stimmig', () => {
    const c = computeEInvoice(einvoiceData.parse(DATA));
    expect(c.grossCents).toBe(9999 + 4999);
    expect(c.lineTotalCents).toBe(c.lines.reduce((s, l) => s + l.netCents, 0));
    for (const t of c.taxes) expect(t.taxCents).toBe(Math.round(t.basisCents * t.rate / 100));
    expect(c.grandTotalCents).toBe(c.lineTotalCents + c.taxTotalCents);
    // Zahlbetrag entspricht immer dem Bruttobetrag der PDF-Rechnung; eine Cent-Abweichung trägt der Rundungsbetrag
    expect(c.dueCents).toBe(c.grossCents);
    expect(c.grandTotalCents + c.roundingCents).toBe(c.grossCents);
    expect(Math.abs(c.roundingCents)).toBeLessThanOrEqual(c.lines.length);
  });

  it('erzeugt wohlgeformtes XML mit den Pflichtangaben und stimmigen Summen', () => {
    const xml = buildXml(einvoiceData.parse(DATA));
    const file = join(process.env.PMS_DATA_DIR!, 'factur-x.xml');
    writeFileSync(file, xml);
    execFileSync('xmllint', ['--noout', file]); // wirft bei nicht wohlgeformtem XML
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>');
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml).toContain('<ram:Name>Müller &amp; Söhne &lt;GmbH&gt;</ram:Name>');
    expect(xml).toContain('<ram:ID schemeID="FC">12/345/67890</ram:ID>');
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(xml).toContain('<ram:IBANID>DE00123456789012345678</ram:IBANID>');
    expect(xml).toContain(`format="102">${today.replace(/-/g, '')}<`);
    const [lineTotal] = num(xml, 'LineTotalAmount').slice(-1);
    expect(num(xml, 'LineTotalAmount').slice(0, -1).reduce((s, n) => s + n, 0)).toBe(lineTotal);
    expect(num(xml, 'BasisAmount').reduce((s, n) => s + n, 0)).toBe(num(xml, 'TaxBasisTotalAmount')[0]);
    expect(num(xml, 'CalculatedAmount').reduce((s, n) => s + n, 0)).toBe(num(xml, 'TaxTotalAmount')[0]);
    expect(num(xml, 'GrandTotalAmount')[0]).toBe(num(xml, 'TaxBasisTotalAmount')[0]! + num(xml, 'TaxTotalAmount')[0]!);
    expect(num(xml, 'DuePayableAmount')[0]).toBe(14998);
  });

  it('lehnt unvollständige Angaben ab', () => {
    expect(einvoiceData.safeParse({ ...DATA, seller: { ...DATA.seller, taxNumber: '' } }).success).toBe(false);
    expect(einvoiceData.safeParse({ ...DATA, lines: [] }).success).toBe(false);
    expect(einvoiceData.safeParse({ ...DATA, buyer: { ...DATA.buyer, country: 'Deutschland' } }).success).toBe(false);
  });
});

describe('Umwandeln und Versenden', () => {
  let uploadId: string;

  it('bettet die XML-Datei in eine hochgeladene PDF ein', async () => {
    const src = await PDFDocument.create();
    src.addPage([595, 842]).drawText('Rechnung R-4711 vom Kassensystem', { x: 60, y: 760, size: 14 });
    const pdfBase64 = Buffer.from(await src.save()).toString('base64');
    expect((await call('POST', '/einvoices/upload', admin, { fileName: 'x.pdf', pdfBase64: Buffer.from('kein pdf '.repeat(40)).toString('base64'), data: DATA })).statusCode).toBe(400);
    uploadId = (await ok('POST', '/einvoices/upload', admin, { fileName: 'kasse-4711.pdf', pdfBase64, data: DATA })).id;

    const pdf = await call('GET', `/einvoices/${uploadId}/pdf`, admin);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('R-4711_zugferd.pdf');
    const raw = pdf.rawPayload;
    expect(raw.subarray(0, 5).toString()).toBe('%PDF-');
    const text = raw.toString('latin1');
    for (const marker of ['factur-x.xml', '/AFRelationship /Alternative', 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#', '<pdfaid:part>3</pdfaid:part>', 'EN 16931', '/OutputIntents'])
      expect(text, marker).toContain(marker);
    const doc = await PDFDocument.load(raw);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Rechnung R-4711');

    const xml = await call('GET', `/einvoices/${uploadId}/xml`, admin);
    expect(xml.body).toContain('<ram:ID>R-4711</ram:ID>');
    const [row] = await ok('GET', '/einvoices', admin);
    expect(row).toMatchObject({ source: 'upload', number: 'R-4711', buyerName: 'Müller & Söhne <GmbH>', grossCents: 14998, generatedPdf: false, originalName: 'kasse-4711.pdf', sentAt: null });
  });

  it('erzeugt die E-Rechnung aus einer Rechnung des PMS vollständig selbst', async () => {
    const hotel = await ok('GET', '/settings/hotel', admin);
    await ok('PUT', '/settings/hotel', admin, { ...hotel, street: 'Am Schützenplatz 1', zip: '12345', city: 'Musterstadt', taxNumber: '12/345/67890', iban: 'DE00 1234 5678 9012 3456 78' });
    const tax = (await ok('GET', '/tax-rates', admin)).find((t: { ratePercent: number }) => t.ratePercent === 7);
    const inv = (await ok('POST', '/invoices', admin, { include: 'none' })).id;
    await ok('POST', `/invoices/${inv}/lines`, admin, { description: 'Übernachtung', detail: 'Zimmer 1', quantity: 2, unitPriceCents: 9900, taxRatePercent: tax.ratePercent });
    let d = await ok('GET', `/invoices/${inv}`, admin);
    expect((await call('POST', `/einvoices/from-invoice/${inv}`, admin)).statusCode).toBe(409); // Entwurf
    d = await ok('PUT', `/invoices/${inv}`, admin, { recipientCompany: 'Beispiel AG', recipientName: '', recipientStreet: 'Weg 1', recipientZip: '11111', recipientCity: 'Ort', recipientCountry: 'Deutschland', recipientVatId: '', serviceFrom: today, serviceTo: today, notes: '', version: d.version });
    const issued = await ok('POST', `/invoices/${inv}/issue`, admin, { version: d.version });
    const { id } = await ok('POST', `/einvoices/from-invoice/${inv}`, admin);
    const xml = (await call('GET', `/einvoices/${id}/xml`, admin)).body;
    expect(xml).toContain(`<ram:ID>${issued.number}</ram:ID>`);
    expect(xml).toContain('<ram:Name>Beispiel AG</ram:Name>');
    expect(num(xml, 'DuePayableAmount')[0]).toBe(19800);
    const pdf = (await call('GET', `/einvoices/${id}/pdf`, admin)).rawPayload;
    const text = pdf.toString('latin1');
    expect(text).toContain('factur-x.xml');
    expect(text).toMatch(/FontFile2/); // Schrift ist eingebettet
    expect((await ok('GET', '/einvoices', admin))[0]).toMatchObject({ source: 'invoice', generatedPdf: true, number: issued.number });
  });

  it('versendet per E-Mail, speichert das Passwort verschlüsselt und protokolliert den Versand', async () => {
    const mail = { to: 'rechnung@example.com', subject: 'Ihre Rechnung R-4711', body: 'Guten Tag,\nanbei Ihre Rechnung.', attach: 'both' };
    const none = await call('POST', `/einvoices/${uploadId}/send`, admin, mail);
    expect(none.statusCode).toBe(409);
    expect(none.json().error.code).toBe('mail_not_configured');

    const saved = await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.gmx.net', port: 587, user: 'hotel@gmx.de', fromName: 'Schützenhaus', password: 'streng-geheim' });
    expect(saved).toEqual({ enabled: true, host: 'mail.gmx.net', port: 587, user: 'hotel@gmx.de', fromName: 'Schützenhaus', hasPassword: true });
    const stored = JSON.stringify(Array.from(await db.execute(sql`select value from settings where key = 'mail'`)));
    expect(stored).not.toContain('streng-geheim');
    expect(JSON.stringify((await ok('GET', '/audit?entity=settings&limit=20', admin)).items)).not.toContain('streng-geheim');
    // leeres Passwort beim Speichern behält das bisherige
    await ok('PUT', '/settings/mail', admin, { enabled: true, host: 'mail.gmx.net', port: 587, user: 'hotel@gmx.de', fromName: 'Schützenhaus', password: '' });

    await ok('POST', `/einvoices/${uploadId}/send`, admin, mail);
    expect(sent).toEqual([{ to: 'rechnung@example.com', subject: 'Ihre Rechnung R-4711', files: ['R-4711_zugferd.pdf', 'R-4711_factur-x.xml'], from: 'hotel@gmx.de', pass: 'streng-geheim' }]);
    const row = (await ok('GET', '/einvoices', admin)).find((r: { id: string }) => r.id === uploadId);
    expect(row.sentTo).toBe('rechnung@example.com');
    expect(row.sentAt).not.toBeNull();
    expect((await call('POST', `/einvoices/${uploadId}/remove`, admin)).statusCode).toBe(409); // versendet → bleibt
    expect((await call('POST', `/einvoices/${uploadId}/send`, admin, { ...mail, to: 'keine-adresse' })).statusCode).toBe(400);

    // fehlgeschlagener Versand wird gemeldet und protokolliert
    setMailSender(async () => { throw Object.assign(new Error('Invalid login'), { responseCode: 535 }); });
    const fail = await call('POST', `/einvoices/${uploadId}/send`, admin, mail);
    expect(fail.statusCode).toBe(502);
    expect(fail.json().error.message).toMatch(/Anmeldung am E-Mail-Server abgelehnt/);
    const log = Array.from(await db.execute(sql`select status from mail_log order by id`)).map((r) => (r as { status: string }).status);
    expect(log).toEqual(['sent', 'failed']);
  });

  it('ist nur mit Freigabe des Bereichs erreichbar; E-Mail-Zugang nur für Administratoren', async () => {
    await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user', modules: ['hotel'] });
    const r = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
    expect((await call('GET', '/einvoices', r)).statusCode).toBe(403);
    await ok('POST', '/users', admin, { username: 'buero', name: 'Büro', password: 'buero-1234567', role: 'user', modules: ['erechnung'] });
    const b = session(await call('POST', '/auth/login', {}, { username: 'buero', password: 'buero-1234567' }));
    expect((await call('GET', '/einvoices', b)).statusCode).toBe(200);
    expect((await call('GET', '/settings/mail', b)).statusCode).toBe(403);
    expect((await ok('GET', '/mail/status', b))).toEqual({ ready: true, from: 'hotel@gmx.de' });
  });

  it('liest eine hochgeladene PDF aus und erkennt Dateien ohne Text', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const make = async (rows: string[]) => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]);
      const font = await doc.embedFont(StandardFonts.Helvetica);
      rows.forEach((t, i) => page.drawText(t, { x: 50, y: 780 - i * 18, size: 11, font }));
      return Buffer.from(await doc.save()).toString('base64');
    };
    const withText = await make(['Muster Bau GmbH', 'Industriestr. 5', '54321 Beispielstadt', 'Rechnungsnummer RE-2031-0042', 'Rechnungsdatum 02.05.2031', 'Leistungszeitraum 28.04.2031 - 30.04.2031',
      'Netto 19 %: 100,00', 'USt 19 % 19,00', 'Gesamtbetrag 119,00 EUR']);
    const r = await ok('POST', '/einvoices/extract', admin, { pdfBase64: withText });
    expect(r).toMatchObject({ hasText: true, pages: 1 });
    expect(r.suggestion).toMatchObject({ number: 'RE-2031-0042', issueDate: '2031-05-02', serviceFrom: '2031-04-28', serviceTo: '2031-04-30', grossCents: 11900,
      buyer: { name: 'Muster Bau GmbH', zip: '54321', city: 'Beispielstadt' }, lines: [{ quantity: 1, unitGrossCents: 11900, taxRate: 19 }] });
    expect(await ok('POST', '/einvoices/extract', admin, { pdfBase64: await make([]) })).toEqual({ hasText: false, pages: 1, suggestion: null }); // leere Seite = wie ein Scan
    expect((await call('POST', '/einvoices/extract', admin, { pdfBase64: Buffer.from('x'.repeat(200)).toString('base64') })).statusCode).toBe(400);
  });

  it('führt ein Archiv mit Suche, Filtern, Summen sowie Liste und Paket zum Herunterladen', async () => {
    const all = await ok('GET', '/einvoices/archive', admin);
    expect(all.total.count).toBe(all.rows.length);
    expect(all.total.count).toBeGreaterThan(0);
    expect(all.total.grossCents).toBe(all.rows.reduce((s: number, r: { grossCents: number }) => s + r.grossCents, 0));
    const first = all.rows[0];
    const year = Number(first.issueDate.slice(0, 4)), month = Number(first.issueDate.slice(5, 7));
    expect(all.years).toContain(year);
    // Filter: Suchtext, Jahr/Monat, Versand
    expect((await ok('GET', `/einvoices/archive?q=${encodeURIComponent(first.number)}`, admin)).rows.map((r: { id: string }) => r.id)).toContain(first.id);
    expect((await ok('GET', '/einvoices/archive?q=gibt-es-nicht-xyz', admin)).total.count).toBe(0);
    expect((await ok('GET', `/einvoices/archive?year=${year}&month=${month}`, admin)).rows.some((r: { id: string }) => r.id === first.id)).toBe(true);
    expect((await ok('GET', `/einvoices/archive?year=${year - 5}`, admin)).total.count).toBe(0);
    const sent = await ok('GET', '/einvoices/archive?sent=yes', admin), unsent = await ok('GET', '/einvoices/archive?sent=no', admin);
    expect(sent.total.count + unsent.total.count).toBe(all.total.count);
    expect(sent.rows.every((r: { sentAt: string | null }) => r.sentAt)).toBe(true);
    expect((await call('GET', '/einvoices/archive?year=abc', admin)).statusCode).toBe(400);
    // Liste für Excel
    const csv = await call('GET', '/einvoices/archive.csv', admin);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.charCodeAt(0)).toBe(0xfeff);
    expect(csv.body).toContain('"Rechnungsnummer";"Rechnungsdatum"');
    expect(csv.body).toContain(`"${first.number}"`);
    // Paket: gültige ZIP-Datei mit Liste, PDF und XML je Rechnung
    const zip = await call('GET', `/einvoices/archive.zip?year=${year}`, admin);
    expect(zip.statusCode).toBe(200);
    const buf = zip.rawPayload;
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    const end = buf.subarray(buf.length - 22);
    expect(end.readUInt32LE(0)).toBe(0x06054b50);
    const inYear = (await ok('GET', `/einvoices/archive?year=${year}`, admin)).total.count;
    expect(end.readUInt16LE(10)).toBe(1 + 2 * inYear);
    const names = buf.toString('latin1');
    expect(names).toContain('E-Rechnungen.csv');
    expect(names).toContain('_zugferd.pdf');
    expect(names).toContain('_factur-x.xml');
    expect((await call('GET', `/einvoices/archive.zip?year=${year - 5}`, admin)).statusCode).toBe(409); // nichts in der Auswahl
  });
});
