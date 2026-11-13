import { desc, eq } from 'drizzle-orm';
import { computeEInvoice, countryCode, type EInvoiceData, type EInvoiceRow } from '../../shared/einvoice.js';
import type { Db, Exec } from '../db/client.js';
import { einvoices } from '../db/schema.js';
import { embedXml, loadPdf, renderInvoicePdf } from '../einvoice/pdf.js';
import { buildXml } from '../einvoice/xml.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getInvoice } from './billing.js';
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
  const footer = [i.footer, [i.taxNumber && `Steuernummer: ${i.taxNumber}`, i.vatId && `USt-IdNr.: ${i.vatId}`].filter(Boolean).join(' · '), [i.bankName, i.iban && `IBAN ${i.iban}`, i.bic && `BIC ${i.bic}`].filter(Boolean).join(' · ')];
  const pdf = await embedXml(await renderInvoicePdf(data, footer), xml, { title: `Rechnung ${inv.number}`, author: i.name, generated: true });
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
