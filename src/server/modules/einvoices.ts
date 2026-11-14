import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { computeEInvoice, countryCode, type EInvoiceArchive, type EInvoiceArchiveQuery, type EInvoiceData, type EInvoiceExtract, type EInvoiceRow } from '../../shared/einvoice.js';
import { extractInvoice } from '../../shared/invoiceextract.js';
import type { Db, Exec } from '../db/client.js';
import { einvoices } from '../db/schema.js';
import { embedXml, loadPdf } from '../einvoice/pdf.js';
import { buildXml } from '../einvoice/xml.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { zipStore } from '../lib/zip.js';
import { record, type Actor } from './audit.js';
import { getInvoice, invoicePdf } from './billing.js';
import { sendMail } from './mail.js';
import { getHotel } from './settings.js';

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const COLS = {
  id: einvoices.id, source: einvoices.source, invoiceId: einvoices.invoiceId, number: einvoices.number, issueDate: einvoices.issueDate, buyerName: einvoices.buyerName,
  buyerEmail: einvoices.buyerEmail, grossCents: einvoices.grossCents, originalName: einvoices.originalName, generatedPdf: einvoices.generatedPdf,
  createdBy: einvoices.createdBy, createdAt: einvoices.createdAt, sentAt: einvoices.sentAt, sentTo: einvoices.sentTo,
};
const toRow = (r: { createdAt: Date; sentAt: Date | null } & Omit<EInvoiceRow, 'createdAt' | 'sentAt'>): EInvoiceRow =>
  ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null });

export async function listEInvoices(db: Exec) {
  return (await db.select(COLS).from(einvoices).orderBy(desc(einvoices.createdAt)).limit(300)).map(toRow);
}

/** Vorbelegung für das Umwandeln einer hochgeladenen PDF: Angaben des eigenen Betriebs aus den Einstellungen. */
export async function defaults(db: Exec) {
  const h = await getHotel(db);
  return {
    seller: { name: h.name, street: h.street, zip: h.zip, city: h.city, country: countryCode(h.country) || 'DE', vatId: h.vatId, taxNumber: h.taxNumber, email: h.email, phone: h.phone, contactName: '' },
    iban: h.iban, bic: h.bic, paymentTermDays: h.paymentTermDays,
  };
}

async function store(db: Db, actor: Actor, v: { source: 'upload' | 'invoice'; invoiceId: string | null; data: EInvoiceData; xml: string; pdf: Uint8Array; originalName: string; generatedPdf: boolean }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(einvoices).values({
      source: v.source, invoiceId: v.invoiceId, number: v.data.number, issueDate: v.data.issueDate, buyerName: v.data.buyer.name, buyerEmail: v.data.buyer.email,
      grossCents: computeEInvoice(v.data).grossCents, originalName: v.originalName, generatedPdf: v.generatedPdf, data: v.data, xml: v.xml, pdf: Buffer.from(v.pdf), createdBy: actor.userName,
    }).returning({ id: einvoices.id });
    await record(tx, actor, { action: 'create', entity: 'einvoice', entityId: row!.id, after: { number: v.data.number, buyer: v.data.buyer.name, source: v.source, file: v.originalName } });
    return { id: row!.id };
  });
}

/** E-Rechnung aus einer im PMS ausgestellten Rechnung: Daten und PDF kommen vollständig aus dem System. */
/** Erzeugt Daten, XML und ZUGFeRD-PDF einer ausgestellten Rechnung, ohne etwas zu speichern. */
export async function buildFromInvoice(db: Exec, invoiceId: string) {
  const inv = await getInvoice(db, invoiceId);
  if (inv.kind !== 'invoice' || inv.status !== 'issued' || !inv.issuer || !inv.number)
    throw conflict('Eine E-Rechnung kann nur aus einer ausgestellten, nicht stornierten Rechnung erzeugt werden');
  const i = inv.issuer;
  const buyerCountry = countryCode(inv.recipientCountry);
  if (!buyerCountry) throw new AppError(409, 'country', `Das Land des Empfängers („${inv.recipientCountry}“) ist nicht bekannt – bitte in der E-Rechnung als hochgeladene PDF mit Länderauswahl erstellen`);
  const data: EInvoiceData = {
    number: inv.number, issueDate: inv.issueDate!, serviceFrom: inv.serviceFrom ?? inv.issueDate!, serviceTo: inv.serviceTo ?? inv.issueDate!, dueDate: inv.dueDate,
    seller: { name: i.name, street: i.street, zip: i.zip, city: i.city, country: countryCode(i.country) || 'DE', vatId: i.vatId, taxNumber: i.taxNumber, email: i.email, phone: i.phone, contactName: '' },
    buyer: {
      name: inv.recipientCompany || inv.recipientName, street: inv.recipientStreet, zip: inv.recipientZip, city: inv.recipientCity, country: buyerCountry,
      vatId: inv.recipientVatId, email: '', reference: '',
    },
    lines: inv.lines.map((l) => ({ name: [l.description, l.detail].filter(Boolean).join(', '), quantity: l.quantity, unitGrossCents: l.unitPriceCents, taxRate: l.taxRatePercent })),
    paidCents: Math.max(0, Math.min(inv.paidCents, inv.grossCents)), paymentMeans: i.iban ? '58' : '1', iban: i.iban, bic: i.bic,
    paymentTerms: inv.openCents > 0 && inv.dueDate ? `Zahlbar bis ${de(inv.dueDate)} ohne Abzug unter Angabe der Rechnungsnummer.` : '', note: inv.notes,
  };
  if (data.lines.some((l) => l.unitGrossCents < 0) || computeEInvoice(data).grossCents <= 0)
    throw conflict('Rechnungen mit Nachlass-Positionen oder ohne positiven Betrag werden als E-Rechnung noch nicht unterstützt');
  const xml = buildXml(data);
  // Träger der E-Rechnung ist das archivierte Rechnungs-PDF – dieselbe Datei wie für Druck und Download
  const pdf = await embedXml(await loadPdf((await invoicePdf(db as Db, invoiceId)).pdf), xml, { title: `Rechnung ${inv.number}`, author: i.name, generated: true });
  return { inv, data, xml, pdf };
}

export async function fromInvoice(db: Db, actor: Actor, invoiceId: string) {
  const { data, xml, pdf } = await buildFromInvoice(db, invoiceId);
  return store(db, actor, { source: 'invoice', invoiceId, data, xml, pdf, originalName: '', generatedPdf: true });
}

/** Hochgeladene PDF-Rechnung umwandeln: Die eingegebenen Rechnungsdaten werden als XML in die PDF-Datei eingebettet. */
export async function fromUpload(db: Db, actor: Actor, v: { fileName: string; pdfBase64: string; data: EInvoiceData }) {
  const bytes = Buffer.from(v.pdfBase64, 'base64');
  if (bytes.length > 10 * 1024 * 1024) throw new AppError(400, 'too_large', 'Die PDF-Datei ist zu groß (höchstens 10 MB)');
  let doc;
  try { doc = await loadPdf(bytes); } catch (e) { throw new AppError(400, 'bad_pdf', e instanceof Error ? e.message : 'PDF nicht lesbar'); }
  if (computeEInvoice(v.data).grossCents <= 0) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { lines: 'Der Rechnungsbetrag muss größer als 0 sein' });
  const xml = buildXml(v.data);
  const pdf = await embedXml(doc, xml, { title: `Rechnung ${v.data.number}`, author: v.data.seller.name, generated: false });
  return store(db, actor, { source: 'upload', invoiceId: null, data: v.data, xml, pdf, originalName: v.fileName, generatedPdf: false });
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'rechnung';

export async function getFile(db: Exec, id: string, kind: 'pdf' | 'xml') {
  const [r] = await db.select({ number: einvoices.number, xml: einvoices.xml, pdf: einvoices.pdf }).from(einvoices).where(eq(einvoices.id, id));
  if (!r) throw notFound('E-Rechnung');
  return kind === 'pdf'
    ? { filename: `${safe(r.number)}_zugferd.pdf`, type: 'application/pdf', content: r.pdf }
    : { filename: `${safe(r.number)}_factur-x.xml`, type: 'application/xml; charset=utf-8', content: Buffer.from(r.xml, 'utf8') };
}

export async function removeEInvoice(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [r] = await tx.delete(einvoices).where(eq(einvoices.id, id)).returning({ number: einvoices.number, sentAt: einvoices.sentAt });
    if (!r) throw notFound('E-Rechnung');
    if (r.sentAt) throw conflict('Bereits versendete E-Rechnungen werden nicht gelöscht');
    await record(tx, actor, { action: 'remove', entity: 'einvoice', entityId: id, before: { number: r.number } });
  });
}

export async function sendEInvoice(db: Db, actor: Actor, id: string, v: { to: string; subject: string; body: string; attach: 'pdf' | 'xml' | 'both' }) {
  const attachments = [];
  if (v.attach !== 'xml') { const f = await getFile(db, id, 'pdf'); attachments.push({ filename: f.filename, content: f.content, contentType: 'application/pdf' }); }
  if (v.attach !== 'pdf') { const f = await getFile(db, id, 'xml'); attachments.push({ filename: f.filename, content: f.content, contentType: 'application/xml' }); }
  await sendMail(db, actor, { to: v.to, subject: v.subject, text: v.body, attachments }, id);
  await db.update(einvoices).set({ sentAt: new Date(), sentTo: v.to }).where(eq(einvoices.id, id));
  await record(db, actor, { action: 'send', entity: 'einvoice', entityId: id, after: { to: v.to, attach: v.attach } });
}

// ---------- PDF auslesen ----------
/**
 * Liest den Text einer hochgeladenen Rechnungs-PDF (die Textschicht, die Programme beim Erzeugen hineinschreiben) und schlägt
 * daraus die Angaben für die E-Rechnung vor. Eingescannte Rechnungen haben keine Textschicht – dafür wäre Texterkennung (OCR) nötig,
 * die das Programm nicht enthält.
 */
export async function extractFromPdf(db: Exec, pdfBase64: string): Promise<EInvoiceExtract> {
  const bytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') throw new AppError(400, 'validation', 'Das ist keine PDF-Datei');
  let text = '', pages = 0;
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const doc = await getDocumentProxy(bytes);
    const r = await extractText(doc, { mergePages: false });
    pages = r.totalPages;
    text = (r.text as string[]).slice(0, 20).join('\n');
  } catch (e) {
    throw new AppError(422, 'pdf_unreadable', `Die PDF-Datei ließ sich nicht lesen (${e instanceof Error ? e.message.slice(0, 120) : 'unbekannter Fehler'}). Die Angaben bitte von Hand eintragen.`);
  }
  if (text.replace(/\s/g, '').length < 40) return { hasText: false, pages, suggestion: null };
  const h = await getHotel(db);
  return { hasText: true, pages, suggestion: extractInvoice(text, { name: h.name, zip: h.zip, vatId: h.vatId }) };
}

// ---------- Archiv ----------
const MAX_ARCHIVE = 1000, MAX_ZIP = 300;
function archiveWhere(f: EInvoiceArchiveQuery) {
  const like = `%${f.q.replace(/[%_\\]/g, '')}%`;
  const from = f.year ? `${f.year}-${String(f.month ?? 1).padStart(2, '0')}-01` : null;
  const to = f.year ? (f.month ? (f.month === 12 ? `${f.year + 1}-01-01` : `${f.year}-${String(f.month + 1).padStart(2, '0')}-01`) : `${f.year + 1}-01-01`) : null;
  return and(
    f.q ? or(ilike(einvoices.number, like), ilike(einvoices.buyerName, like), ilike(einvoices.originalName, like), ilike(einvoices.sentTo, like)) : undefined,
    from ? sql`${einvoices.issueDate} >= ${from}::date and ${einvoices.issueDate} < ${to}::date` : undefined,
    f.sent === 'yes' ? isNotNull(einvoices.sentAt) : f.sent === 'no' ? isNull(einvoices.sentAt) : undefined,
    f.source === 'all' ? undefined : eq(einvoices.source, f.source),
  );
}
/** Archiv der erzeugten E-Rechnungen: suchen und filtern nach Rechnungsdatum, Versand und Herkunft; mit Summen. */
export async function archive(db: Exec, f: EInvoiceArchiveQuery): Promise<EInvoiceArchive> {
  const where = archiveWhere(f);
  const rows = (await db.select(COLS).from(einvoices).where(where).orderBy(desc(einvoices.issueDate), desc(einvoices.createdAt)).limit(MAX_ARCHIVE + 1)).map(toRow);
  const [t] = await db.select({ count: sql<number>`count(*)::int`, gross: sql<number>`coalesce(sum(${einvoices.grossCents}), 0)::int`, sent: sql<number>`count(${einvoices.sentAt})::int` }).from(einvoices).where(where);
  const years = await db.execute(sql`select distinct extract(year from issue_date)::int as y from einvoices order by 1 desc`);
  return { rows: rows.slice(0, MAX_ARCHIVE), total: { count: t!.count, grossCents: t!.gross, sent: t!.sent }, years: Array.from(years).map((r) => Number(r.y)), truncated: rows.length > MAX_ARCHIVE };
}
const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;
function archiveCsvText(rows: EInvoiceRow[]) {
  const head = ['Rechnungsnummer', 'Rechnungsdatum', 'Empfänger', 'Betrag brutto', 'Herkunft', 'Ursprungsdatei', 'Erstellt am', 'Erstellt von', 'Versendet am', 'Versendet an'];
  const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) : '');
  const lines = rows.map((r) => [r.number, de(r.issueDate), r.buyerName, (r.grossCents / 100).toFixed(2).replace('.', ','), r.source === 'invoice' ? 'aus dem PMS' : 'hochgeladen', r.originalName, at(r.createdAt), r.createdBy, at(r.sentAt), r.sentTo].map(csvCell).join(';'));
  return '\uFEFF' + [head.map(csvCell).join(';'), ...lines].join('\r\n') + '\r\n'; // mit BOM, damit Excel die Umlaute richtig liest
}
/** Liste der gefilterten E-Rechnungen als CSV (für Excel). */
export const archiveCsv = async (db: Exec, f: EInvoiceArchiveQuery) => archiveCsvText((await archive(db, f)).rows);

/** Paket für die Steuerberatung: PDF (mit eingebetteter XML) und XML jeder gefilterten E-Rechnung plus die Liste als CSV. */
export async function archiveZip(db: Db, actor: Actor, f: EInvoiceArchiveQuery) {
  const a = await archive(db, f);
  if (a.total.count === 0) throw conflict('Für diese Auswahl gibt es keine E-Rechnungen');
  if (a.total.count > MAX_ZIP) throw conflict(`Die Auswahl enthält ${a.total.count} E-Rechnungen – ein Paket fasst höchstens ${MAX_ZIP}. Bitte auf einen Monat oder ein Jahr eingrenzen.`, 'too_many');
  const used = new Set<string>();
  const unique = (name: string) => { let n = name, i = 2; while (used.has(n)) n = name.replace(/(\.[a-z]+)$/, `_${i++}$1`); used.add(n); return n; };
  const files: { name: string; data: Buffer }[] = [{ name: 'E-Rechnungen.csv', data: Buffer.from(archiveCsvText(a.rows), 'utf8') }];
  for (const r of a.rows) {
    const [x] = await db.select({ xml: einvoices.xml, pdf: einvoices.pdf }).from(einvoices).where(eq(einvoices.id, r.id));
    if (!x) continue;
    files.push({ name: unique(`${safe(r.number)}_zugferd.pdf`), data: Buffer.from(x.pdf) }, { name: unique(`${safe(r.number)}_factur-x.xml`), data: Buffer.from(x.xml, 'utf8') });
  }
  await record(db, actor, { action: 'export', entity: 'einvoice', after: { count: a.rows.length, year: f.year ?? null, month: f.month ?? null } });
  return zipStore(files);
}
