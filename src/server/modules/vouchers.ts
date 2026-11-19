import { desc, eq, sql } from 'drizzle-orm';
import {
  VOUCHER_NUMBERING_DEFAULT, type TextPos, type VoucherDesignDto, type VoucherDto, type VoucherInput, type VoucherNumbering, type VoucherOverviewDto, type VoucherStatus,
} from '../../shared/vouchers.js';
import type { Db, Exec } from '../db/client.js';
import { invoices, settings, voucherDesigns, vouchers } from '../db/schema.js';
import { accentRgb } from '../einvoice/invoicepdf.js';
import { renderVoucher } from '../einvoice/voucherpdf.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import * as billing from './billing.js';
import { decrypt, encrypt, sendMail } from './mail.js';
import { ready } from './hotelmail.js';
import { getHotel } from './settings.js';

/**
 * Gutscheine: Geschenkkarten aus dem Kassenprogramm im Programm festhalten – interne Nummer (Kürzel + fortlaufende Zahl),
 * PIN der Kasse (verschlüsselt gespeichert), Wert, Käufer, Beschenkter und Gruß; Gutschein als PDF mit eigenem Motiv,
 * Versand per E-Mail und Rechnungsentwurf (Gutscheinwert + Porto). Gutscheine werden nie gelöscht, nur storniert.
 * Eingelöst wird weiterhin an der Kasse; hier lässt sich der Gutschein danach als „eingelöst“ markieren.
 */

const NUM_KEY = 'voucher_numbering';
export async function getNumbering(db: Exec): Promise<VoucherNumbering> {
  const [row] = await db.select().from(settings).where(eq(settings.key, NUM_KEY));
  return { ...VOUCHER_NUMBERING_DEFAULT, ...((row?.value as Partial<VoucherNumbering>) ?? {}) };
}
export async function saveNumbering(db: Db, actor: Actor, v: VoucherNumbering) {
  await db.insert(settings).values({ key: NUM_KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: NUM_KEY, after: v });
  return v;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** nächste freie Nummer: höchste vergebene Zahl mit diesem Kürzel + 1, mindestens der Startwert */
export async function nextNumber(db: Exec): Promise<string> {
  const n = await getNumbering(db);
  const rows = await db.select({ number: vouchers.number }).from(vouchers);
  const re = new RegExp(`^${escapeRe(n.prefix)}(\\d+)$`);
  const max = rows.reduce((m, r) => { const x = re.exec(r.number); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `${n.prefix}${String(Math.max(n.start, max + 1)).padStart(n.digits, '0')}`;
}
/** Vorschlag „gültig bis“: Ende des Jahres der Ausstellung + n Jahre (n = 0: kein Vorschlag) */
export const suggestValidUntil = (issuedOn: string, years: number) => (years > 0 ? `${Number(issuedOn.slice(0, 4)) + years}-12-31` : '');

type Row = typeof vouchers.$inferSelect;
function dto(r: Row, inv?: { number: string | null; status: string } | null): VoucherDto {
  return {
    id: r.id, number: r.number, hasPin: !!r.pinEnc, pinHint: r.pinHint, posCardNo: r.posCardNo, valueCents: r.valueCents, issuedOn: r.issuedOn, validUntil: r.validUntil,
    buyerName: r.buyerName, buyerCompany: r.buyerCompany, buyerStreet: r.buyerStreet, buyerZip: r.buyerZip, buyerCity: r.buyerCity, buyerCountry: r.buyerCountry, buyerEmail: r.buyerEmail,
    recipientName: r.recipientName, message: r.message, designId: r.designId, status: r.status as VoucherStatus, invoiceId: r.invoiceId,
    invoiceNumber: inv?.number ?? null, invoiceStatus: inv?.status ?? null, sentAt: r.sentAt?.toISOString() ?? null, sentTo: r.sentTo, note: r.note,
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), version: r.version,
  };
}

export async function overview(db: Exec, today: string): Promise<VoucherOverviewDto> {
  const rows = await db.select({ v: vouchers, invNumber: invoices.number, invStatus: invoices.status }).from(vouchers)
    .leftJoin(invoices, eq(invoices.id, vouchers.invoiceId)).orderBy(desc(vouchers.createdAt)).limit(500);
  const designs = await db.select({ id: voucherDesigns.id, name: voucherDesigns.name, textPos: voucherDesigns.textPos, createdAt: voucherDesigns.createdAt }).from(voucherDesigns).orderBy(voucherDesigns.createdAt);
  const numbering = await getNumbering(db);
  return {
    vouchers: rows.map((r) => dto(r.v, r.invNumber !== undefined && r.v.invoiceId ? { number: r.invNumber, status: r.invStatus ?? '' } : null)),
    designs: designs.map((d): VoucherDesignDto => ({ id: d.id, name: d.name, textPos: d.textPos as TextPos, createdAt: d.createdAt.toISOString() })),
    numbering, nextNumber: await nextNumber(db), suggestedValidUntil: suggestValidUntil(today, numbering.validYears),
  };
}

const fields = (v: VoucherInput) => ({
  number: v.number.trim(), posCardNo: v.posCardNo, valueCents: v.valueCents, issuedOn: v.issuedOn, validUntil: v.validUntil || null,
  buyerName: v.buyerName, buyerCompany: v.buyerCompany, buyerStreet: v.buyerStreet, buyerZip: v.buyerZip, buyerCity: v.buyerCity, buyerCountry: v.buyerCountry || 'Deutschland',
  buyerEmail: v.buyerEmail, recipientName: v.recipientName, message: v.message, designId: v.designId || null, note: v.note,
});
const pinFields = (pin: string) => (pin.trim() ? { pinEnc: encrypt(pin.trim()), pinHint: pin.trim().slice(-2) } : {});
/** fürs Protokoll: ohne PIN */
const safe = (v: VoucherInput) => ({ ...v, pin: v.pin ? '(eingegeben)' : '' });
const duplicate = (e: unknown) => e instanceof Error && /vouchers_number_idx|duplicate key/.test(e.message + String((e as { cause?: unknown }).cause ?? ''));

export async function create(db: Db, actor: Actor, v: VoucherInput) {
  try {
    const [row] = await db.insert(vouchers).values({ ...fields(v), ...pinFields(v.pin), createdBy: actor.userName }).returning();
    await record(db, actor, { action: 'create', entity: 'voucher', entityId: row!.id, after: safe(v) });
    return { id: row!.id, number: row!.number };
  } catch (e) {
    if (duplicate(e)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { number: 'Diese Gutscheinnummer ist bereits vergeben' });
    throw e;
  }
}

async function lock(tx: Exec, id: string) {
  const [row] = await tx.select().from(vouchers).where(eq(vouchers.id, id)).for('update');
  if (!row) throw notFound('Gutschein');
  return row;
}

export async function update(db: Db, actor: Actor, id: string, v: VoucherInput, version: number) {
  try {
    return await db.transaction(async (tx) => {
      const before = await lock(tx, id);
      if (before.version !== version) throw stale();
      if (before.status === 'cancelled') throw conflict('Der Gutschein ist storniert und kann nicht mehr geändert werden.', 'voucher_cancelled');
      if (before.invoiceId && before.valueCents !== v.valueCents) {
        const [inv] = await tx.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, before.invoiceId));
        if (inv && inv.status !== 'draft' && inv.status !== 'cancelled') throw conflict('Zu diesem Gutschein ist bereits eine Rechnung ausgestellt – der Wert lässt sich nicht mehr ändern.', 'voucher_invoiced');
      }
      await tx.update(vouchers).set({ ...fields(v), ...pinFields(v.pin), version: before.version + 1, updatedAt: new Date() }).where(eq(vouchers.id, id));
      await record(tx, actor, { action: 'update', entity: 'voucher', entityId: id, after: safe(v) });
      return { id };
    });
  } catch (e) {
    if (duplicate(e)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { number: 'Diese Gutscheinnummer ist bereits vergeben' });
    throw e;
  }
}

export async function setStatus(db: Db, actor: Actor, id: string, status: VoucherStatus, version: number) {
  return db.transaction(async (tx) => {
    const before = await lock(tx, id);
    if (before.version !== version) throw stale();
    if (before.status === 'cancelled' && status !== 'cancelled') throw conflict('Ein stornierter Gutschein lässt sich nicht wieder aktivieren. Bitte einen neuen anlegen.', 'voucher_cancelled');
    await tx.update(vouchers).set({ status, version: before.version + 1, updatedAt: new Date() }).where(eq(vouchers.id, id));
    await record(tx, actor, { action: 'status', entity: 'voucher', entityId: id, before: { status: before.status }, after: { status } });
    return { ok: true };
  });
}

/** PIN im Klartext – nur für Administratoren, jedes Anzeigen wird protokolliert */
export async function revealPin(db: Db, actor: Actor, id: string) {
  const [row] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!row) throw notFound('Gutschein');
  if (!row.pinEnc) return { pin: '' };
  await record(db, actor, { action: 'reveal_pin', entity: 'voucher', entityId: id });
  return { pin: decrypt(row.pinEnc) };
}

// ---------- Motive ----------
const MAX_IMG = 5 * 1024 * 1024;
export async function addDesign(db: Db, actor: Actor, v: { name: string; mime: 'image/png' | 'image/jpeg'; dataBase64: string; textPos: TextPos }) {
  const data = Buffer.from(v.dataBase64, 'base64');
  if (data.length > MAX_IMG) throw new AppError(400, 'validation', 'Das Bild ist zu groß (höchstens 5 MB)');
  const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = data[0] === 0xff && data[1] === 0xd8;
  if ((v.mime === 'image/png' && !png) || (v.mime === 'image/jpeg' && !jpg)) throw new AppError(400, 'validation', 'Bitte ein PNG- oder JPG-Bild wählen');
  const [row] = await db.insert(voucherDesigns).values({ name: v.name, mime: v.mime, data, textPos: v.textPos }).returning({ id: voucherDesigns.id });
  await record(db, actor, { action: 'create', entity: 'voucher_design', entityId: row!.id, after: { name: v.name, textPos: v.textPos, bytes: data.length } });
  return { id: row!.id };
}
export async function setDesignPos(db: Db, actor: Actor, id: string, textPos: TextPos) {
  const [row] = await db.update(voucherDesigns).set({ textPos }).where(eq(voucherDesigns.id, id)).returning({ id: voucherDesigns.id });
  if (!row) throw notFound('Motiv');
  await record(db, actor, { action: 'update', entity: 'voucher_design', entityId: id, after: { textPos } });
  return { ok: true };
}
export async function removeDesign(db: Db, actor: Actor, id: string) {
  const [row] = await db.delete(voucherDesigns).where(eq(voucherDesigns.id, id)).returning({ name: voucherDesigns.name });
  if (!row) throw notFound('Motiv');
  await record(db, actor, { action: 'remove', entity: 'voucher_design', entityId: id, before: row });
  return { ok: true };
}
export async function designImage(db: Exec, id: string) {
  const [row] = await db.select({ mime: voucherDesigns.mime, data: voucherDesigns.data }).from(voucherDesigns).where(eq(voucherDesigns.id, id));
  if (!row) throw notFound('Motiv');
  return row;
}

// ---------- PDF, E-Mail ----------
async function render(db: Exec, r: Row, designOverride?: string | null) {
  const h = await getHotel(db);
  const did = designOverride === undefined ? r.designId : designOverride;
  const [d] = did ? await db.select().from(voucherDesigns).where(eq(voucherDesigns.id, did)) : [];
  const layout = await billing.getLayout(db);
  const pdf = await renderVoucher(
    { number: r.number, pin: r.pinEnc ? decrypt(r.pinEnc) : null, posCardNo: r.posCardNo, valueCents: r.valueCents, issuedOn: r.issuedOn, validUntil: r.validUntil, recipientName: r.recipientName, message: r.message },
    h, d ? { mime: d.mime, data: d.data, textPos: d.textPos as TextPos } : null, await billing.getLogo(db), accentRgb(layout));
  return { filename: `Gutschein-${r.number.replace(/[^\w-]/g, '_')}.pdf`, pdf: Buffer.from(pdf) };
}
export async function pdf(db: Db, actor: Actor, id: string) {
  const [r] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!r) throw notFound('Gutschein');
  if (r.status === 'cancelled') throw conflict('Der Gutschein ist storniert.', 'voucher_cancelled');
  await record(db, actor, { action: 'print', entity: 'voucher', entityId: id });
  return render(db, r);
}
/** Vorschau eines Motivs mit Beispieltext (ohne echte Daten) */
export async function designPreview(db: Exec, designId: string) {
  const sample = { number: 'SH-0000', pinEnc: null, posCardNo: '', valueCents: 5000, issuedOn: new Date().toISOString().slice(0, 10), validUntil: null, recipientName: 'Erika Beispiel', message: 'Alles Gute zum Geburtstag!', designId } as unknown as Row;
  return render(db, sample, designId);
}

const money = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
export async function mailDraft(db: Exec, id: string) {
  const [r] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!r) throw notFound('Gutschein');
  const h = await getHotel(db);
  const hello = r.buyerName ? `Guten Tag ${r.buyerName},` : 'Guten Tag,';
  const text = [
    hello, '',
    `vielen Dank für Ihren Gutschein${r.recipientName ? ` für ${r.recipientName}` : ''} über ${money(r.valueCents)}. Sie finden ihn als PDF im Anhang – zum Ausdrucken oder Weiterleiten.`, '',
    `Gutschein-Nr.: ${r.number}`, ...(r.validUntil ? [`Gültig bis: ${r.validUntil.slice(8, 10)}.${r.validUntil.slice(5, 7)}.${r.validUntil.slice(0, 4)}`] : []), '',
    ...(r.posCardNo ? ['Bitte bewahren Sie den Gutschein sorgfältig auf: Zum Einlösen wird die Kartennummer darauf benötigt.', ''] : []),
    'Herzliche Grüße', h.name,
  ].join('\n');
  return { to: r.buyerEmail, subject: `Ihr Gutschein ${r.number} – ${h.name}`, text, attachment: `Gutschein-${r.number.replace(/[^\w-]/g, '_')}.pdf`, ready: await ready(db) };
}
export async function sendVoucherMail(db: Db, actor: Actor, id: string, m: { to: string; subject: string; text: string }) {
  const [r] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!r) throw notFound('Gutschein');
  if (r.status === 'cancelled') throw conflict('Der Gutschein ist storniert.', 'voucher_cancelled');
  const file = await render(db, r);
  await sendMail(db, actor, { to: m.to, subject: m.subject, text: m.text, attachments: [{ filename: file.filename, content: file.pdf, contentType: 'application/pdf' }] });
  await db.update(vouchers).set({ sentAt: new Date(), sentTo: m.to, updatedAt: new Date(), version: sql`${vouchers.version} + 1` }).where(eq(vouchers.id, id));
  await record(db, actor, { action: 'mail', entity: 'voucher', entityId: id, after: { to: m.to } });
  return { ok: true };
}

// ---------- Rechnung ----------
/**
 * Rechnungsentwurf über die vorhandene Rechnungsfunktion: Gutscheinwert (Steuersatz wählbar, Vorgabe 0 %) und Porto.
 * Ausgestellt wird erst unter Rechnungen mit „Ausstellen“ – vorher lässt sich alles ändern.
 */
export async function createInvoice(db: Db, actor: Actor, id: string, v: { valueTaxPercent: number; postageCents: number; postageTaxPercent: number }) {
  const [r] = await db.select().from(vouchers).where(eq(vouchers.id, id));
  if (!r) throw notFound('Gutschein');
  if (r.status === 'cancelled') throw conflict('Der Gutschein ist storniert.', 'voucher_cancelled');
  if (r.invoiceId) {
    const [inv] = await db.select({ status: invoices.status }).from(invoices).where(eq(invoices.id, r.invoiceId));
    if (inv && inv.status !== 'cancelled') throw conflict('Zu diesem Gutschein gibt es bereits eine Rechnung (bzw. einen Entwurf).', 'voucher_invoiced');
  }
  if (!r.buyerName && !r.buyerCompany) throw new AppError(400, 'validation', 'Für die Rechnung bitte zuerst den Käufer (Name oder Firma) beim Gutschein eintragen.');
  const { id: invoiceId } = await billing.createInvoice(db, actor, { include: 'none' });
  try {
    await billing.updateDraft(db, actor, invoiceId, {
      recipientCompany: r.buyerCompany, recipientName: r.buyerName, recipientStreet: r.buyerStreet, recipientZip: r.buyerZip, recipientCity: r.buyerCity, recipientCountry: r.buyerCountry,
      serviceFrom: r.issuedOn, serviceTo: r.issuedOn, version: 1,
    });
    await billing.addLine(db, actor, invoiceId, {
      description: `Gutschein Nr. ${r.number}`, detail: v.valueTaxPercent === 0 ? 'Mehrzweckgutschein – Umsatzsteuer fällt bei Einlösung an' : '',
      quantity: 1, unitPriceCents: r.valueCents, taxRatePercent: v.valueTaxPercent,
    });
    if (v.postageCents > 0) await billing.addLine(db, actor, invoiceId, { description: 'Porto und Versand', detail: '', quantity: 1, unitPriceCents: v.postageCents, taxRatePercent: v.postageTaxPercent });
  } catch (e) {
    await billing.deleteDraft(db, actor, invoiceId).catch(() => {});
    throw e;
  }
  await db.update(vouchers).set({ invoiceId, updatedAt: new Date(), version: sql`${vouchers.version} + 1` }).where(eq(vouchers.id, id));
  await record(db, actor, { action: 'invoice', entity: 'voucher', entityId: id, after: { invoiceId, ...v } });
  return { invoiceId };
}
