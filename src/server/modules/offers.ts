import { createHash, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { taxBreakdown } from '../../shared/billing.js';
import { formatMoney, todayBerlin } from '../../shared/hotel.js';
import {
  type CatalogReturn, OFFER_LAYOUT_DEFAULT, type OfferAnswers, type OfferTalk, type TalkInput, lineTotal, offerLayoutInput, quantityFor, type OfferLayout, type OfferCreateInputT, type OfferDocumentDto, type OfferDto, type OfferItemDto, type OfferItemInput, type OfferLineInput, type OfferListRow,
  type OfferState, type OfferTemplateDto, type OfferTemplateInput, type OfferUpdateInput, type PublicOffer,
} from '../../shared/offers.js';
import type { Db, Exec } from '../db/client.js';
import { numberSequences, offerDocuments, offerItems, offerLines, offers, offerTemplates, settings, teamNotes } from '../db/schema.js';
import { readCatalogPdf, renderCatalog } from '../einvoice/catalogpdf.js';
import { renderOffer } from '../einvoice/offerpdf.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getLayout, getLogo } from './billing.js';
import { getPolicy } from './guestlink.js';
import { ready, signature } from './hotelmail.js';
import { sendMail, sign } from './mail.js';
import { logMailOut, withCode } from './offerthread.js';
import { getHotel } from './settings.js';

/**
 * Angebote für Tagungen, Feiern und Gruppen. Ein versendetes Angebot wird als PDF gespeichert (mit Prüfwert SHA-256);
 * angenommen wird genau diese Fassung – per Vermerk (E-Mail, Telefon …) oder online über den Link (Name + Bestätigung).
 * Die Online-Annahme ist eine einfache elektronische Erklärung, keine qualifizierte elektronische Signatur.
 */
type Row = typeof offers.$inferSelect;
const de = (s: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const stateOf = (r: { status: Row['status']; validUntil: string | null; mode?: string; answers?: unknown }): OfferState =>
  r.mode === 'questions' && r.status === 'sent' ? (r.answers ? 'answered' : 'asked')
  : r.status === 'sent' && r.validUntil && r.validUntil < todayBerlin() ? 'expired' : r.status;

// ---------- Katalog ----------
const itemDto = (r: typeof offerItems.$inferSelect): OfferItemDto => ({ id: r.id, name: r.name, description: r.description, unit: r.unit, priceCents: r.priceCents, taxRatePercent: Number(r.taxRatePercent), area: r.area, group: r.itemGroup, sort: r.sort, active: r.active, version: r.version });
export const listItems = async (db: Exec) => (await db.select().from(offerItems).orderBy(asc(offerItems.sort), asc(offerItems.name))).map(itemDto);
export async function saveItem(db: Db, actor: Actor, id: string | null, input: OfferItemInput, version?: number) {
  const { group, ...rest } = input;
  const v = { ...rest, itemGroup: group };
  return db.transaction(async (tx) => {
    if (!id) {
      const [r] = await tx.insert(offerItems).values(v).returning();
      await record(tx, actor, { action: 'create', entity: 'offer_item', entityId: r!.id, after: v });
      return itemDto(r!);
    }
    const [b] = await tx.select().from(offerItems).where(eq(offerItems.id, id)).for('update');
    if (!b) throw notFound('Leistung');
    if (b.version !== version) throw stale();
    const [r] = await tx.update(offerItems).set({ ...v, version: b.version + 1, updatedAt: new Date() }).where(eq(offerItems.id, id)).returning();
    await record(tx, actor, { action: 'update', entity: 'offer_item', entityId: id, before: itemDto(b), after: v });
    return itemDto(r!);
  });
}

// ---------- Dokumente (AGB als PDF) ----------
const docDto = (r: typeof offerDocuments.$inferSelect): OfferDocumentDto => ({ id: r.id, name: r.name, fileName: r.fileName, sizeBytes: r.sizeBytes, active: r.active, uploadedBy: r.uploadedBy, createdAt: r.createdAt.toISOString() });
export const listDocuments = async (db: Exec) => (await db.select({ id: offerDocuments.id, name: offerDocuments.name, fileName: offerDocuments.fileName, sizeBytes: offerDocuments.sizeBytes, active: offerDocuments.active, uploadedBy: offerDocuments.uploadedBy, createdAt: offerDocuments.createdAt, data: sql<Buffer>`''::bytea` })
  .from(offerDocuments).orderBy(desc(offerDocuments.createdAt))).map((r) => docDto(r as typeof offerDocuments.$inferSelect));
export async function uploadDocument(db: Db, actor: Actor, v: { name: string; fileName: string; data: Buffer }) {
  if (v.data.length > 10 * 1024 * 1024) throw new AppError(400, 'too_large', 'Die Datei ist zu groß (höchstens 10 MB).');
  if (v.data.subarray(0, 5).toString('latin1') !== '%PDF-') throw new AppError(400, 'bad_file', 'Bitte eine PDF-Datei wählen.');
  const name = v.name.trim().slice(0, 120) || v.fileName.replace(/\.pdf$/i, '');
  const [r] = await db.insert(offerDocuments).values({ name, fileName: v.fileName.slice(0, 160) || 'dokument.pdf', data: v.data, sizeBytes: v.data.length, uploadedBy: actor.userName }).returning();
  await record(db, actor, { action: 'upload', entity: 'offer_document', entityId: r!.id, after: { name, size: v.data.length } });
  return docDto(r!);
}
export async function setDocumentActive(db: Db, actor: Actor, id: string, active: boolean) {
  const [r] = await db.update(offerDocuments).set({ active }).where(eq(offerDocuments.id, id)).returning({ id: offerDocuments.id });
  if (!r) throw notFound('Dokument');
  await record(db, actor, { action: active ? 'activate' : 'deactivate', entity: 'offer_document', entityId: id });
  return { ok: true };
}
export async function documentFile(db: Exec, id: string) {
  const [r] = await db.select().from(offerDocuments).where(eq(offerDocuments.id, id));
  if (!r) throw notFound('Dokument');
  return { fileName: r.fileName, data: r.data };
}

// ---------- Vorlagen ----------
const tplDto = (r: typeof offerTemplates.$inferSelect, prices: Record<string, boolean> = {}): OfferTemplateDto => ({
  catalogPrices: prices[r.id] === true,
  id: r.id, name: r.name, area: r.area, title: r.title, intro: r.intro, closing: r.closing, questions: r.questions as string[],
  items: r.items as OfferTemplateDto['items'], talkSteps: (r.talkSteps as OfferTemplateDto['talkSteps']) ?? [], validDays: r.validDays, depositPercent: r.depositPercent, documentIds: r.documentIds as string[], sort: r.sort, active: r.active, version: r.version,
});
/** Beim ersten Aufruf neutrale Mustervorlagen anlegen (ohne Preise – die Leistungen und Preise legt das Haus selbst an). */
async function ensureDefaults(db: Db) {
  const [seeded] = await db.select().from(settings).where(eq(settings.key, 'offer_defaults'));
  if (seeded) return;
  // Merker zuerst setzen: nur wer ihn tatsächlich anlegt, legt die Vorlagen an (zwei gleichzeitige Aufrufe → keine doppelten Vorlagen)
  const mine = await db.insert(settings).values({ key: 'offer_defaults', value: { seeded: new Date().toISOString() } }).onConflictDoNothing().returning({ key: settings.key });
  if (!mine.length) return;
  const [any] = await db.select({ id: offerTemplates.id }).from(offerTemplates).limit(1);
  if (!any) {
    const intro = 'vielen Dank für Ihre Anfrage. Gern unterbreiten wir Ihnen folgendes Angebot:';
    const closing = 'Wir freuen uns, Sie bei uns begrüßen zu dürfen. Bei Fragen sind wir gern für Sie da.';
    await db.insert(offerTemplates).values([
      { name: 'Tagung', area: 'both', title: 'Tagung', intro, closing, sort: 1, validDays: 14, depositPercent: 0,
        questions: ['Genaue Teilnehmerzahl', 'Beginn und Ende der Tagung', 'Gewünschte Bestuhlung (z. B. Parlament, U-Form, Block)', 'Benötigte Technik (Beamer, Leinwand, Flipchart, Mikrofon)', 'Pausenzeiten und Mittagessen', 'Besondere Ernährungswünsche oder Allergien', 'Übernachtungen benötigt? Wenn ja: Anzahl Einzel-/Doppelzimmer', 'Rechnungsanschrift'] },
      { name: 'Familienfeier', area: 'restaurant', title: 'Ihre Familienfeier', intro, closing, sort: 2, validDays: 14, depositPercent: 0,
        questions: ['Genaue Personenzahl (davon Kinder)', 'Beginn und voraussichtliches Ende', 'Anlass (z. B. Geburtstag, Taufe, Hochzeit)', 'Menü oder Buffet?', 'Getränke: Pauschale oder nach Verbrauch?', 'Besondere Ernährungswünsche oder Allergien', 'Dekoration, Torte oder Musik mitgebracht?', 'Übernachtungen für Gäste benötigt?'] },
      { name: 'Weihnachtsfeier', area: 'restaurant', title: 'Ihre Weihnachtsfeier', intro, closing, sort: 3, validDays: 10, depositPercent: 0,
        questions: ['Genaue Personenzahl', 'Wunschdatum und Uhrzeit', 'Menü oder Buffet?', 'Getränke: Pauschale oder nach Verbrauch?', 'Besondere Ernährungswünsche oder Allergien', 'Rechnungsanschrift (Firma)'] },
      { name: 'Gruppenübernachtung', area: 'hotel', title: 'Übernachtung für Ihre Gruppe', intro, closing, sort: 4, validDays: 14, depositPercent: 0,
        questions: ['Anreise- und Abreisetag', 'Anzahl Einzel- und Doppelzimmer', 'Frühstück gewünscht?', 'Abendessen gewünscht?', 'Voraussichtliche Ankunftszeit', 'Rechnungsanschrift'] },
    ]);
  }
}
export async function listTemplates(db: Db) {
  await ensureDefaults(db);
  const prices = await catalogPrices(db);
  return (await db.select().from(offerTemplates).orderBy(asc(offerTemplates.sort), asc(offerTemplates.name))).map((r) => tplDto(r, prices));
}
/** Je Vorlage: Preise im Katalog-PDF zeigen? (Einstellung „offer_catalog_prices“: { [Vorlagen-ID]: true }) */
async function catalogPrices(db: Exec): Promise<Record<string, boolean>> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'offer_catalog_prices'));
  const v = row?.value;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
}
async function setCatalogPrices(db: Exec, id: string, on: boolean) {
  const cur = await catalogPrices(db);
  const next = { ...cur, [id]: on };
  if (!on) delete next[id];
  await db.insert(settings).values({ key: 'offer_catalog_prices', value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
}
export async function saveTemplate(db: Db, actor: Actor, id: string | null, input: OfferTemplateInput, version?: number) {
  const { catalogPrices: prices, ...v } = input;
  return db.transaction(async (tx) => {
    if (!id) {
      const [r] = await tx.insert(offerTemplates).values(v).returning();
      await setCatalogPrices(tx, r!.id, prices);
      await record(tx, actor, { action: 'create', entity: 'offer_template', entityId: r!.id, after: { name: v.name, catalogPrices: prices } });
      return tplDto(r!, { [r!.id]: prices });
    }
    const [b] = await tx.select().from(offerTemplates).where(eq(offerTemplates.id, id)).for('update');
    if (!b) throw notFound('Vorlage');
    if (b.version !== version) throw stale();
    const [r] = await tx.update(offerTemplates).set({ ...v, version: b.version + 1, updatedAt: new Date() }).where(eq(offerTemplates.id, id)).returning();
    await setCatalogPrices(tx, id, prices);
    await record(tx, actor, { action: 'update', entity: 'offer_template', entityId: id, after: { name: v.name, catalogPrices: prices } });
    return tplDto(r!, { [id]: prices });
  });
}

// ---------- Angebote ----------
async function nextNumber(tx: Exec, year: number) {
  const [row] = await tx.insert(numberSequences).values({ key: 'offer', year, last: 1 })
    .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
  return `AN-${year}-${String(row!.last).padStart(4, '0')}`;
}
const customerOf = (r: { customerCompany: string; customerName: string }) => [r.customerCompany, r.customerName].filter(Boolean).join(', ');

export async function listOffers(db: Exec, f: { state?: string; q?: string }): Promise<OfferListRow[]> {
  const like = f.q ? `%${f.q.replace(/[%_\\]/g, '')}%` : null;
  const today = todayBerlin();
  const expired = sql`(o.status = 'sent' and o.mode = 'offer' and o.valid_until is not null and o.valid_until < ${today})`;
  const byState = !f.state || f.state === 'all' ? sql``
    : f.state === 'open' ? sql`and o.status in ('draft', 'sent')`
    : f.state === 'expired' ? sql`and ${expired}`
    : f.state === 'sent' ? sql`and o.status = 'sent' and o.mode = 'offer' and not ${expired}`
    : f.state === 'asked' ? sql`and o.status = 'sent' and o.mode = 'questions' and o.answers is null`
    : f.state === 'answered' ? sql`and o.status = 'sent' and o.mode = 'questions' and o.answers is not null`
    : f.state === 'draft' || f.state === 'accepted' || f.state === 'declined' ? sql`and o.status = ${f.state}` : sql``;
  const rows = await db.execute(sql`
    select o.*, coalesce((select sum(l.total_cents) from offer_lines l where l.offer_id = o.id), 0)::int as total
    from offers o where true ${like ? sql`and (o.number ilike ${like} or o.customer_name ilike ${like} or o.customer_company ilike ${like} or o.title ilike ${like})` : sql``} ${byState}
    order by o.created_at desc limit 300`) as unknown as Record<string, unknown>[];
  const list = rows.map((x): OfferListRow => {
    const r = { status: x.status as Row['status'], validUntil: (x.valid_until as string | null) ?? null, mode: x.mode as OfferListRow['mode'], answers: x.answers };
    return {
      id: String(x.id), number: String(x.number), status: r.status, state: stateOf(r), mode: r.mode, area: x.area as OfferListRow['area'], title: String(x.title), customer: customerOf({ customerCompany: String(x.customer_company), customerName: String(x.customer_name) }),
      email: String(x.email), eventDate: (x.event_date as string | null) ?? null, eventEnd: (x.event_end as string | null) ?? null, persons: Number(x.persons), totalCents: Number(x.total),
      validUntil: r.validUntil, sentAt: x.sent_at ? new Date(x.sent_at as string).toISOString() : null, acceptedAt: x.accepted_at ? new Date(x.accepted_at as string).toISOString() : null,
      bookingId: (x.booking_id as string | null) ?? null, tableReservationId: (x.table_reservation_id as string | null) ?? null, createdAt: new Date(x.created_at as string).toISOString(),
    };
  });
  return list;
}

export async function getOffer(db: Exec, id: string): Promise<OfferDto> {
  const [r] = await db.select().from(offers).where(eq(offers.id, id));
  if (!r) throw notFound('Angebot');
  const lines = (await db.select().from(offerLines).where(eq(offerLines.offerId, id)).orderBy(asc(offerLines.pos)))
    .map((l) => ({ id: l.id, pos: l.pos, itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit as OfferDto['lines'][number]['unit'], quantity: Number(l.quantity), unitPriceCents: l.unitPriceCents, taxRatePercent: Number(l.taxRatePercent), totalCents: l.totalCents }));
  const totalCents = lines.reduce((s, l) => s + l.totalCents, 0);
  return {
    id: r.id, number: r.number, status: r.status, state: stateOf(r), area: r.area, title: r.title, customer: customerOf(r), email: r.email,
    eventDate: r.eventDate, eventEnd: r.eventEnd, persons: r.persons, totalCents, validUntil: r.validUntil, sentAt: r.sentAt?.toISOString() ?? null, acceptedAt: r.acceptedAt?.toISOString() ?? null,
    bookingId: r.bookingId, tableReservationId: r.tableReservationId, createdAt: r.createdAt.toISOString(),
    templateId: r.templateId, customerCompany: r.customerCompany, customerName: r.customerName, phone: r.phone, street: r.street, zip: r.zip, city: r.city,
    intro: r.intro, closing: r.closing, questions: r.questions as string[], depositPercent: r.depositPercent, documentIds: r.documentIds as string[], notes: r.notes,
    sentTo: r.sentTo, acceptedBy: r.acceptedBy, acceptedMethod: r.acceptedMethod, acceptedHash: r.acceptedHash, sentHash: r.sentHash, declinedAt: r.declinedAt?.toISOString() ?? null,
    lines, taxes: taxBreakdown(lines), version: r.version, mode: r.mode, answers: (r.answers as OfferAnswers | null) ?? null, talk: (r.talk as OfferTalk | null) ?? null,
  };
}

export async function createOffer(db: Db, actor: Actor, v: OfferCreateInputT) {
  const tpl = v.templateId ? (await db.select().from(offerTemplates).where(eq(offerTemplates.id, v.templateId)))[0] : undefined;
  if (v.templateId && !tpl) throw notFound('Vorlage');
  const today = todayBerlin();
  const items = tpl ? await db.select().from(offerItems) : [];
  // ausgeblendete Dokumente (z. B. alte AGB) nicht mehr übernehmen
  const tplDocs = (tpl?.documentIds as string[] | undefined) ?? [];
  const activeDocs = tplDocs.length ? (await db.select({ id: offerDocuments.id }).from(offerDocuments).where(and(sql`${offerDocuments.id} in ${tplDocs}`, eq(offerDocuments.active, true)))).map((d) => d.id) : [];
  return db.transaction(async (tx) => {
    const number = await nextNumber(tx, Number(today.slice(0, 4)));
    const [o] = await tx.insert(offers).values({
      number, area: tpl?.area ?? v.area, templateId: tpl?.id ?? null, customerCompany: v.customerCompany, customerName: v.customerName, email: v.email, phone: v.phone,
      street: v.street, zip: v.zip, city: v.city, eventDate: v.eventDate, eventEnd: v.eventEnd, persons: v.persons,
      title: tpl?.title ?? '', intro: tpl?.intro ?? '', closing: tpl?.closing ?? '', questions: tpl?.questions ?? [], mode: v.mode,
      // bei „nur Fragen“ gibt es noch keine Gültigkeit – sie wird beim Umwandeln in ein Angebot gesetzt
      validUntil: v.mode === 'questions' ? null : addDays(today, tpl?.validDays ?? 14),
      depositPercent: tpl?.depositPercent ?? 0, documentIds: tplDocs.filter((d) => activeDocs.includes(d)), createdBy: actor.userName,
    }).returning();
    // Leistungen der Vorlage mit vorgeschlagener Menge (aus Personen, Tagen, Nächten)
    let pos = 1;
    for (const t of (tpl?.items as OfferTemplateDto['items'] | undefined) ?? []) {
      if (t.preselect === false) continue; // nur im Katalog der Vorlage, nicht vorausgewählt
      const it = items.find((x) => x.id === t.itemId && x.active);
      if (!it) continue;
      const q = t.quantity ?? quantityFor(it.unit, v.persons, v.eventDate, v.eventEnd);
      await tx.insert(offerLines).values({ offerId: o!.id, pos: pos++, itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: q, unitPriceCents: it.priceCents, taxRatePercent: it.taxRatePercent, totalCents: lineTotal(q, it.priceCents) });
    }
    await record(tx, actor, { action: 'create', entity: 'offer', entityId: o!.id, after: { number, template: tpl?.name ?? null } });
    return { id: o!.id, number };
  });
}

export async function updateOffer(db: Db, actor: Actor, id: string, v: OfferUpdateInput) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(offers).where(eq(offers.id, id)).for('update');
    if (!b) throw notFound('Angebot');
    if (b.version !== v.version) throw stale();
    const { lines, version: _v, ...rest } = v;
    const oldLines = await tx.select().from(offerLines).where(eq(offerLines.offerId, id)).orderBy(asc(offerLines.pos));
    // Was der Kunde sieht (PDF, Link-Seite, E-Mail-Adresse) – die interne Notiz gehört nicht dazu
    const seen = (o: Omit<OfferUpdateInput, 'lines' | 'version'>, ls: OfferLineInput[]) => JSON.stringify([
      o.mode, o.area, o.customerCompany, o.customerName, o.email, o.phone, o.street, o.zip, o.city, o.eventDate ?? null, o.eventEnd ?? null, o.persons, o.title, o.intro, o.closing,
      o.questions, o.validUntil ?? null, o.depositPercent, [...o.documentIds].sort(),
      ls.map((l) => [l.description, l.detail, l.unit, Number(l.quantity), l.unitPriceCents, Number(l.taxRatePercent)]),
    ]);
    const before = { mode: b.mode, area: b.area, customerCompany: b.customerCompany, customerName: b.customerName, email: b.email, phone: b.phone, street: b.street, zip: b.zip, city: b.city,
      eventDate: b.eventDate, eventEnd: b.eventEnd, persons: b.persons, title: b.title, intro: b.intro, closing: b.closing, questions: b.questions as string[], validUntil: b.validUntil,
      depositPercent: b.depositPercent, documentIds: b.documentIds as string[], notes: b.notes };
    const visibleChange = seen(before, oldLines.map((l) => ({ ...l, unit: l.unit as OfferLineInput["unit"], taxRatePercent: Number(l.taxRatePercent) }))) !== seen(rest, lines);
    if (b.status === 'accepted' || b.status === 'declined') {
      // abgeschlossen: nur noch die interne Notiz
      if (visibleChange) throw conflict('Angenommene oder abgelehnte Angebote lassen sich nicht mehr ändern – nur die interne Notiz.');
      await tx.update(offers).set({ notes: rest.notes, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
      await record(tx, actor, { action: 'update', entity: 'offer', entityId: id, after: { number: b.number, notes: true } });
      return { ok: true, backToDraft: false };
    }
    if (!visibleChange) {
      await tx.update(offers).set({ notes: rest.notes, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
      return { ok: true, backToDraft: false };
    }
    // sichtbare Änderung nach dem Versand: zurück zum Entwurf, die versendete Fassung und ihr Link gelten nicht mehr
    const wasSent = b.status === 'sent';
    await tx.update(offers).set({ ...rest, ...(wasSent ? { status: 'draft' as const, sentPdf: null, sentHash: '', linkVersion: b.linkVersion + 1 } : {}), version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
    await tx.delete(offerLines).where(eq(offerLines.offerId, id));
    let pos = 1;
    for (const l of lines) await tx.insert(offerLines).values({ offerId: id, pos: pos++, itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxRatePercent: l.taxRatePercent, totalCents: lineTotal(l.quantity, l.unitPriceCents) });
    await record(tx, actor, { action: 'update', entity: 'offer', entityId: id, after: { number: b.number, lines: lines.length, backToDraft: wasSent } });
    return { ok: true, backToDraft: wasSent };
  });
}

// ---------- Gestaltung (Angebotslayout) ----------
export async function getOfferLayout(db: Exec): Promise<OfferLayout> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'offer_layout'));
  return offerLayoutInput.parse({ ...OFFER_LAYOUT_DEFAULT, ...((row?.value as Partial<OfferLayout>) ?? {}) });
}
export async function saveOfferLayout(db: Db, actor: Actor, v: OfferLayout) {
  await db.insert(settings).values({ key: 'offer_layout', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'offer_layout', after: v });
  return v;
}
/** Wirksame Gestaltung: „wie die Rechnung“ übernimmt Stil, Farbe, Schrift, Logo, Tabelle, Abstände und Papier aus dem Rechnungslayout */
async function effectiveLayout(db: Exec, v?: OfferLayout): Promise<OfferLayout> {
  const own = v ?? await getOfferLayout(db);
  if (!own.likeInvoice) return own;
  const i = await getLayout(db);
  return { ...own, style: i.style, accent: i.accent, accentHex: i.accentHex, font: i.font, logoPos: i.logoPos, logoSize: i.logoSize, table: i.table, spacing: i.spacing,
    fontSize: i.fontSize, senderLine: i.senderLine, foldMarks: i.foldMarks, letterhead: i.letterhead };
}
/** Vorschau mit einem Muster-Angebot (erfundene Angaben) */
export async function offerLayoutPreview(db: Exec, v: OfferLayout) {
  const today = todayBerlin();
  const mk = (pos: number, description: string, detail: string, unit: OfferDto['lines'][number]['unit'], quantity: number, unitPriceCents: number, taxRatePercent: number) =>
    ({ id: String(pos), pos, itemId: null, description, detail, unit, quantity, unitPriceCents, taxRatePercent, totalCents: lineTotal(quantity, unitPriceCents) });
  const lines = [mk(1, 'Tagungspauschale ganztags', 'Raum, Technik, zwei Kaffeepausen, Mittagessen', 'person_day', 40, 4900, 19),
    mk(2, 'Übernachtung im Doppelzimmer mit Frühstück', '', 'night', 10, 9800, 7), mk(3, 'Abendessen als Buffet', 'inkl. Tischwasser', 'person', 20, 3200, 19)];
  const total = lines.reduce((s, l) => s + l.totalCents, 0);
  const sample = {
    id: 'muster', number: 'AN-MUSTER-0001', status: 'draft', state: 'draft', area: 'both', title: 'Tagung Muster GmbH', customer: 'Muster GmbH', email: '', eventDate: addDays(today, 30), eventEnd: addDays(today, 31),
    persons: 20, totalCents: total, validUntil: addDays(today, 14), sentAt: null, acceptedAt: null, bookingId: null, tableReservationId: null, createdAt: today,
    templateId: null, customerCompany: 'Muster GmbH', customerName: 'Erika Mustermann', phone: '', street: 'Musterstraße 1', zip: '12345', city: 'Musterstadt',
    intro: 'vielen Dank für Ihre Anfrage. Gern unterbreiten wir Ihnen folgendes Angebot:', closing: 'Wir freuen uns, Sie bei uns begrüßen zu dürfen.',
    questions: ['Genaue Teilnehmerzahl', 'Gewünschte Bestuhlung', 'Besondere Ernährungswünsche oder Allergien'], depositPercent: 30, documentIds: [], notes: '',
    sentTo: '', acceptedBy: '', acceptedMethod: '', acceptedHash: '', sentHash: '', declinedAt: null, lines, taxes: taxBreakdown(lines), version: 1,
  } as unknown as OfferDto;
  const [h, logo] = await Promise.all([getHotel(db), getLogo(db)]);
  return Buffer.from(await renderOffer(sample, h, logo, await effectiveLayout(db, v), today));
}

async function render(db: Exec, o: OfferDto) {
  const [h, logo, layout] = await Promise.all([getHotel(db), getLogo(db), effectiveLayout(db)]);
  return Buffer.from(await renderOffer(o, h, logo, layout, todayBerlin()));
}
/** PDF: versendete/angenommene Fassung unverändert, sonst aktuelle Vorschau */
export async function offerPdf(db: Exec, id: string) {
  const [m] = await db.select({ mode: offers.mode }).from(offers).where(eq(offers.id, id));
  if (m?.mode === 'questions') throw conflict('Bei „Nur Fragen stellen“ gibt es kein PDF – die Fragen gehen als E-Mail mit Link zum Beantworten hinaus.');
  const [r] = await db.select({ pdf: offers.sentPdf, number: offers.number }).from(offers).where(eq(offers.id, id));
  if (!r) throw notFound('Angebot');
  return { fileName: `Angebot_${r.number}.pdf`, pdf: r.pdf ?? await render(db, await getOffer(db, id)) };
}

// ---------- Link für die Online-Annahme ----------
const tokenFor = (id: string, v: number) => `${id.replace(/-/g, '')}.${sign(`offer-link:${id}:${v}`)}`;
const GONE = () => new AppError(404, 'link_gone', 'Dieser Link ist nicht (mehr) gültig. Bitte wenden Sie sich an uns.');
async function idOfToken(db: Exec, token: string) {
  const [hex, mac] = token.split('.');
  if (!hex || !mac || !/^[0-9a-f]{32}$/.test(hex)) throw GONE();
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const [r] = await db.select({ v: offers.linkVersion, status: offers.status }).from(offers).where(eq(offers.id, id));
  if (!r || r.status === 'draft') throw GONE();
  const want = Buffer.from(tokenFor(id, r.v).split('.')[1]!), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw GONE();
  return id;
}
/** wie idOfToken, zusätzlich die Link-Fassung (für die Prüfung innerhalb der Transaktion) */
async function idAndVersionOfToken(db: Exec, token: string) {
  const id = await idOfToken(db, token);
  const [r] = await db.select({ v: offers.linkVersion }).from(offers).where(eq(offers.id, id));
  if (!r || tokenFor(id, r.v) !== token) throw GONE();
  return { id, v: r.v };
}
export async function offerLink(db: Exec, id: string, baseUrl: string) {
  const [r] = await db.select({ v: offers.linkVersion }).from(offers).where(eq(offers.id, id));
  if (!r) throw notFound('Angebot');
  const p = await getPolicy(db);
  return { url: `${p.publicUrl || baseUrl}/angebot/${tokenFor(id, r.v)}`, publicUrl: !!p.publicUrl };
}

/** E-Mail-Vorschlag zum Versand */
export async function mailDraft(db: Exec, id: string, baseUrl: string) {
  const [o, h] = [await getOffer(db, id), await getHotel(db)];
  if (o.status === 'accepted' || o.status === 'declined') throw conflict('Das Angebot ist bereits abgeschlossen.');
  const when = o.eventDate ? (o.eventEnd && o.eventEnd !== o.eventDate ? ` vom ${de(o.eventDate)} bis ${de(o.eventEnd)}` : ` am ${de(o.eventDate)}`) : '';
  const hello = o.customerName ? `Guten Tag ${o.customerName},` : 'Guten Tag,';
  if (o.mode === 'questions') {
    if (!o.questions.length) throw conflict('Bitte zuerst mindestens eine Frage eintragen.');
    const link = await offerLink(db, id, baseUrl);
    const text = [hello, '', `vielen Dank für Ihre Anfrage${o.title ? ` (${o.title})` : ''}${when}. Damit wir Ihnen ein passendes Angebot erstellen können, beantworten Sie uns bitte noch folgende Fragen:`, '',
      ...o.questions.map((q) => `- ${q}`),
      ...(link.publicUrl ? ['', `Sie können die Fragen bequem hier beantworten: ${link.url}`, 'Oder antworten Sie einfach auf diese E-Mail.'] : ['', 'Antworten Sie uns einfach auf diese E-Mail.']),
      ...(o.closing ? ['', o.closing] : []),
      '', signature(h)].join('\n');
    return { to: o.email, subject: withCode(`Ihre Anfrage${o.title ? ` – ${o.title}` : ''} – ${h.name}`, o.number), text, attachment: '', ready: await ready(db) };
  }
  if (!o.lines.length) throw conflict('Das Angebot hat noch keine Positionen.');
  if (o.validUntil && o.validUntil < todayBerlin()) throw conflict(expiredMsg(o.validUntil));
  const link = await offerLink(db, id, baseUrl);
  const docs = o.documentIds.length ? (await db.select({ name: offerDocuments.name }).from(offerDocuments).where(sql`${offerDocuments.id} in ${o.documentIds}`)).map((d) => d.name) : [];
  const text = [hello, '', `vielen Dank für Ihre Anfrage. Anbei erhalten Sie unser Angebot ${o.number}${o.title ? ` (${o.title})` : ''}${when} für ${o.persons} ${o.persons === 1 ? 'Person' : 'Personen'}.`, '',
    `Gesamtbetrag: ${formatMoney(o.totalCents)} (inkl. Umsatzsteuer)`, ...(o.validUntil ? [`Das Angebot gilt bis zum ${de(o.validUntil)}.`] : []),
    ...(link.publicUrl ? ['', `Sie können das Angebot hier ansehen und direkt online annehmen: ${link.url}`] : ['', 'Zur Annahme antworten Sie uns einfach auf diese E-Mail.']),
    ...(o.questions.length ? ['', 'Damit wir alles vorbereiten können, teilen Sie uns bitte noch mit:', ...o.questions.map((q) => `- ${q}`)] : []),
    ...(docs.length ? ['', `Anlagen: Angebot (PDF), ${docs.join(', ')}`] : ['', 'Anlage: Angebot (PDF)']),
    '', signature(h)].join('\n');
  return { to: o.email, subject: `Angebot ${o.number}${o.title ? ` – ${o.title}` : ''} – ${h.name}`, text, attachment: `Angebot_${o.number}.pdf${docs.length ? ` + ${docs.join(', ')}` : ''}`, ready: await ready(db) };
}

const expiredMsg = (d: string) => `Das Angebot war nur bis zum ${de(d)} gültig. Bitte „Gültig bis“ anpassen und speichern, dann senden.`;
export async function sendOffer(db: Db, actor: Actor, id: string, v: { to: string; subject: string; text: string }) {
  const o = await getOffer(db, id);
  if (o.status === 'accepted' || o.status === 'declined') throw conflict('Das Angebot ist bereits abgeschlossen.');
  if (o.mode === 'questions') {
    // nur Fragen: E-Mail ohne PDF; der Link führt zum Beantworten
    if (!o.questions.length) throw conflict('Bitte zuerst mindestens eine Frage eintragen.');
    await sendMail(db, actor, { to: v.to, subject: withCode(v.subject, o.number), text: v.text });
    await logMailOut(db, id, 'questions', actor, v.to, withCode(v.subject, o.number), v.text);
    const done = await db.update(offers).set({ status: 'sent', sentAt: new Date(), sentTo: v.to, updatedAt: new Date(), version: o.version + 1 })
      .where(and(eq(offers.id, id), eq(offers.version, o.version), sql`${offers.status} in ('draft', 'sent')`)).returning({ id: offers.id });
    await record(db, actor, { action: 'send_questions', entity: 'offer', entityId: id, after: { to: v.to, number: o.number, questions: o.questions.length, applied: done.length > 0 } });
    if (!done.length) throw conflict('Die E-Mail wurde gesendet, aber der Vorgang wurde währenddessen geändert. Bitte den aktuellen Stand prüfen.');
    return { ok: true };
  }
  if (!o.lines.length) throw conflict('Das Angebot hat noch keine Positionen.');
  if (o.validUntil && o.validUntil < todayBerlin()) throw conflict(expiredMsg(o.validUntil));
  // erneuter Versand ohne Änderung: dieselbe Fassung; sonst neu erzeugen
  const [cur] = await db.select({ pdf: offers.sentPdf, hash: offers.sentHash }).from(offers).where(eq(offers.id, id));
  const pdf = o.status === 'sent' && cur?.pdf ? cur.pdf : await render(db, o);
  const docs = o.documentIds.length ? await db.select().from(offerDocuments).where(sql`${offerDocuments.id} in ${o.documentIds}`) : [];
  await sendMail(db, actor, { to: v.to, subject: withCode(v.subject, o.number), text: v.text, attachments: [
    { filename: `Angebot_${o.number}.pdf`, content: pdf, contentType: 'application/pdf' },
    ...docs.map((d) => ({ filename: d.fileName, content: d.data, contentType: 'application/pdf' })),
  ] });
  await logMailOut(db, id, 'offer', actor, v.to, withCode(v.subject, o.number), v.text);
  // nur übernehmen, wenn das Angebot während des Versands unverändert blieb (nicht inzwischen geändert, angenommen oder abgelehnt)
  const done = await db.update(offers).set({ status: 'sent', sentAt: new Date(), sentTo: v.to, sentPdf: pdf, sentHash: sha(pdf), updatedAt: new Date(), version: o.version + 1 })
    .where(and(eq(offers.id, id), eq(offers.version, o.version), sql`${offers.status} in ('draft', 'sent')`)).returning({ id: offers.id });
  await record(db, actor, { action: 'send', entity: 'offer', entityId: id, after: { to: v.to, number: o.number, documents: docs.map((d) => d.name), applied: done.length > 0 } });
  if (!done.length) throw conflict('Die E-Mail wurde gesendet, aber das Angebot wurde währenddessen geändert, angenommen oder abgelehnt. Bitte den aktuellen Stand prüfen – der Status wurde nicht überschrieben.');
  return { ok: true };
}

/** Annahme von Hand vermerken (Antwort per E-Mail, Telefon, persönlich, unterschrieben zurück). */
export async function acceptOffer(db: Db, actor: Actor, id: string, v: { method: string; name: string; note: string }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(offers).where(eq(offers.id, id)).for('update');
    if (!b) throw notFound('Angebot');
    if (b.status === 'accepted' || b.status === 'declined') throw conflict('Das Angebot ist bereits abgeschlossen.');
    // annehmen kann der Kunde erst, was er bekommen hat – ein Entwurf oder reine Fragen lassen sich nicht annehmen
    if (b.mode === 'questions') throw conflict('Das sind erst Fragen an den Kunden – bitte zuerst daraus ein Angebot erstellen und senden.');
    if (b.status !== 'sent') throw conflict('Das Angebot ist noch ein Entwurf – bitte zuerst an den Kunden senden.');
    const [line] = await tx.select({ id: offerLines.id }).from(offerLines).where(eq(offerLines.offerId, id)).limit(1);
    if (!line) throw conflict('Das Angebot hat noch keine Positionen.');
    let pdf = b.sentPdf;
    if (!pdf) pdf = await render(tx, await getOffer(tx, id));
    await tx.update(offers).set({ status: 'accepted', acceptedAt: new Date(), acceptedBy: v.name, acceptedMethod: v.method, acceptedHash: sha(pdf), sentPdf: pdf, sentHash: sha(pdf),
      notes: v.note ? [b.notes, `Annahme: ${v.note}`].filter(Boolean).join('\n').slice(0, 2000) : b.notes, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
    await record(tx, actor, { action: 'accept', entity: 'offer', entityId: id, after: { number: b.number, method: v.method, name: v.name } });
    return { ok: true };
  });
}
export async function declineOffer(db: Db, actor: Actor, id: string) {
  const [r] = await db.update(offers).set({ status: 'declined', declinedAt: new Date(), updatedAt: new Date(), version: sql`${offers.version} + 1` })
    .where(and(eq(offers.id, id), sql`${offers.status} = 'sent'`)).returning({ number: offers.number });
  if (!r) throw conflict('Ablehnen geht erst, wenn das Angebot versendet ist (und noch nicht abgeschlossen).');
  await record(db, actor, { action: 'decline', entity: 'offer', entityId: id, after: { number: r.number } });
  return { ok: true };
}
/** Angenommenes Angebot mit der angelegten Hotel- oder Tischreservierung verknüpfen */
export async function linkReservation(db: Db, actor: Actor, id: string, v: { bookingId?: string | null; tableReservationId?: string | null }) {
  const [r] = await db.update(offers).set({ ...('bookingId' in v ? { bookingId: v.bookingId } : {}), ...('tableReservationId' in v ? { tableReservationId: v.tableReservationId } : {}), updatedAt: new Date() })
    .where(eq(offers.id, id)).returning({ number: offers.number });
  if (!r) throw notFound('Angebot');
  await record(db, actor, { action: 'link', entity: 'offer', entityId: id, after: v });
  return { ok: true };
}

/**
 * Aus „nur Fragen“ ein Angebot mit Leistungen machen: derselbe Vorgang wird wieder Entwurf (Antworten bleiben sichtbar),
 * bekommt eine Gültigkeit und einen neuen Link; der bisherige Frage-Link gilt nicht mehr.
 */
export async function toOffer(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(offers).where(eq(offers.id, id)).for('update');
    if (!b) throw notFound('Angebot');
    if (b.mode !== 'questions') throw conflict('Das ist bereits ein Angebot mit Leistungen.');
    if (b.status === 'accepted' || b.status === 'declined') throw conflict('Der Vorgang ist bereits abgeschlossen.');
    const tpl = b.templateId ? (await tx.select({ d: offerTemplates.validDays }).from(offerTemplates).where(eq(offerTemplates.id, b.templateId)))[0] : undefined;
    const validUntil = b.validUntil && b.validUntil >= todayBerlin() ? b.validUntil : addDays(todayBerlin(), tpl?.d ?? 14);
    await tx.update(offers).set({ mode: 'offer', status: 'draft', validUntil, sentPdf: null, sentHash: '', linkVersion: b.linkVersion + 1, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
    await record(tx, actor, { action: 'to_offer', entity: 'offer', entityId: id, after: { number: b.number } });
    return { ok: true };
  });
}

// ---------- Öffentliche Seite (über den Link) ----------
export async function publicOffer(db: Exec, token: string): Promise<PublicOffer> {
  const o = await getOffer(db, await idOfToken(db, token));
  const h = await getHotel(db);
  const docs = o.documentIds.length ? (await db.select({ id: offerDocuments.id, name: offerDocuments.name }).from(offerDocuments).where(sql`${offerDocuments.id} in ${o.documentIds}`)) : [];
  return { hotelName: h.name, hotelPhone: h.phone, number: o.number, title: o.title, customer: o.customer, eventDate: o.eventDate, eventEnd: o.eventEnd, persons: o.persons,
    totalCents: o.mode === 'questions' ? 0 : o.totalCents, validUntil: o.validUntil, state: o.state, documents: o.mode === 'questions' ? [] : docs, acceptedAt: o.acceptedAt, acceptedBy: o.acceptedBy, questions: o.questions,
    mode: o.mode, answers: o.answers };
}
export async function publicPdf(db: Exec, token: string) { return offerPdf(db, await idOfToken(db, token)); }
export async function publicDocument(db: Exec, token: string, docId: string) {
  const o = await getOffer(db, await idOfToken(db, token));
  if (!o.documentIds.includes(docId)) throw notFound('Dokument');
  return documentFile(db, docId);
}
/** Online annehmen: Name + Bestätigung; gespeichert werden Zeitpunkt, Name, IP-Adresse und der Prüfwert der angenommenen Fassung. */
export async function publicAccept(db: Db, token: string, v: { name: string }, ip: string | null) {
  const { id, v: linkVersion } = await idAndVersionOfToken(db, token);
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(offers).where(eq(offers.id, id)).for('update');
    // inzwischen geändert (neue Fassung, neuer Link) → dieser Link gilt nicht mehr
    if (!b || b.linkVersion !== linkVersion) throw GONE();
    if (b.mode === 'questions') throw conflict('Hier gibt es noch nichts anzunehmen – bitte beantworten Sie zuerst die Fragen.');
    if (b.status === 'accepted') throw conflict('Dieses Angebot wurde bereits angenommen. Vielen Dank!');
    if (b.status !== 'sent' || !b.sentPdf) throw conflict('Dieses Angebot kann nicht mehr online angenommen werden. Bitte wenden Sie sich an uns.');
    if (b.validUntil && b.validUntil < todayBerlin()) throw conflict(`Dieses Angebot war bis zum ${de(b.validUntil)} gültig. Bitte sprechen Sie uns an – wir erstellen Ihnen gern ein neues.`);
    const actor: Actor = { userId: null, userName: `Kunde online (${v.name})`, ip };
    await tx.update(offers).set({ status: 'accepted', acceptedAt: new Date(), acceptedBy: v.name, acceptedMethod: 'online', acceptedIp: ip, acceptedHash: b.sentHash, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
    await record(tx, actor, { action: 'accept', entity: 'offer', entityId: id, after: { number: b.number, method: 'online', name: v.name, hash: b.sentHash } });
    await tx.insert(teamNotes).values({ kind: 'task', text: `Angebot ${b.number} wurde online angenommen von ${v.name}${b.title ? ` (${b.title})` : ''} – Reservierung anlegen und ggf. Anzahlung anfordern`, place: '', createdBy: 'Kunde (Angebots-Link)', createdById: null });
    return { ok: true };
  });
}

/** Fragen online beantworten (nur bei „nur Fragen stellen“, einmal). Die Antworten erscheinen im Vorgang und als Aufgabe im Übergabebuch. */
export async function publicAnswer(db: Db, token: string, v: { name: string; answers: string[] }, ip: string | null) {
  const { id, v: linkVersion } = await idAndVersionOfToken(db, token);
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(offers).where(eq(offers.id, id)).for('update');
    if (!b || b.linkVersion !== linkVersion) throw GONE();
    if (b.mode !== 'questions' || b.status !== 'sent') throw conflict('Diese Fragen können hier nicht mehr beantwortet werden. Bitte wenden Sie sich an uns.');
    if (b.answers) throw conflict('Ihre Antworten sind bereits bei uns eingegangen. Vielen Dank!');
    const qs = b.questions as string[];
    const answers: OfferAnswers = { at: new Date().toISOString(), name: v.name, items: qs.map((q, i) => ({ q, a: (v.answers[i] ?? '').slice(0, 1000) })) };
    await tx.update(offers).set({ answers, version: b.version + 1, updatedAt: new Date() }).where(eq(offers.id, id));
    const actor: Actor = { userId: null, userName: `Kunde online (${v.name})`, ip };
    await record(tx, actor, { action: 'answer', entity: 'offer', entityId: id, after: { number: b.number, answered: answers.items.filter((x) => x.a).length } });
    await tx.insert(teamNotes).values({ kind: 'task', text: `Antworten zu ${b.number} eingegangen von ${v.name}${b.title ? ` (${b.title})` : ''} – jetzt Angebot erstellen (Angebote → ${b.number} → „Angebot erstellen“)`, place: '', createdBy: 'Kunde (Angebots-Link)', createdById: null });
    return { ok: true };
  });
}

// ---------- Fragenkatalog (Fragen zum Anklicken) ----------
const BANK = 'offer_question_bank';
/** Gesammelte Fragen; beim ersten Aufruf aus den Fragen der Vorlagen zusammengestellt */
export async function questionBank(db: Db): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, BANK));
  if (Array.isArray(row?.value)) return row.value as string[];
  await ensureDefaults(db);
  const seen = new Set<string>();
  for (const t of await db.select({ q: offerTemplates.questions }).from(offerTemplates).orderBy(asc(offerTemplates.sort)))
    for (const q of (t.q as string[]) ?? []) if (q.trim()) seen.add(q.trim());
  const list = [...seen].slice(0, 200);
  await db.insert(settings).values({ key: BANK, value: list }).onConflictDoNothing();
  return list;
}
async function saveBank(db: Db, list: string[]) {
  await db.insert(settings).values({ key: BANK, value: list }).onConflictDoUpdate({ target: settings.key, set: { value: list, updatedAt: new Date() } });
}
export async function addQuestion(db: Db, actor: Actor, q: string) {
  const list = await questionBank(db);
  if (list.some((x) => x.toLowerCase() === q.toLowerCase())) return list;
  if (list.length >= 200) throw conflict('Der Fragenkatalog ist voll (200 Fragen). Bitte zuerst nicht mehr benötigte Fragen entfernen.');
  const next = [...list, q];
  await saveBank(db, next);
  await record(db, actor, { action: 'question_add', entity: 'offer', after: { question: q } });
  return next;
}
export async function removeQuestion(db: Db, actor: Actor, q: string) {
  const next = (await questionBank(db)).filter((x) => x !== q);
  await saveBank(db, next);
  await record(db, actor, { action: 'question_remove', entity: 'offer', before: { question: q } });
  return next;
}

// ---------- Leistungskatalog zum Ankreuzen (PDF-Formular) ----------
/** Katalog der gewählten Vorlage (sonst der Vorlage des Angebots) mit den aktiven Leistungen */
async function catalogOf(db: Exec, id: string, templateId: string | null) {
  const o = await getOffer(db, id);
  const tid = templateId ?? o.templateId;
  if (!tid) throw conflict('Bitte zuerst einen Produktkatalog (Vorlage) wählen.');
  const [tpl] = await db.select().from(offerTemplates).where(eq(offerTemplates.id, tid));
  if (!tpl) throw notFound('Vorlage');
  const all = await db.select().from(offerItems);
  const items = (tpl.items as OfferTemplateDto['items']).map((t) => all.find((x) => x.id === t.itemId && x.active)).filter((x): x is typeof all[number] => !!x).map(itemDto);
  if (!items.length) throw conflict(`Der Katalog „${tpl.name}“ enthält noch keine Leistungen (Angebote → Vorlagen).`);
  const prices = await catalogPrices(db);
  return { o, tpl, items, showPrices: prices[tpl.id] === true };
}
const whenText = (o: OfferDto) => (o.eventDate ? (o.eventEnd && o.eventEnd !== o.eventDate ? `${de(o.eventDate)} – ${de(o.eventEnd)}` : de(o.eventDate)) : '');
export async function catalogPdf(db: Exec, id: string, templateId: string | null) {
  const { o, tpl, items, showPrices } = await catalogOf(db, id, templateId);
  const pdf = await renderCatalog({
    offerNumber: o.number, catalogName: tpl.name, customer: [o.customerCompany, o.customerName].filter(Boolean).join(', '), date: whenText(o), persons: o.persons,
    items, checked: o.lines.map((l) => l.itemId).filter((x): x is string => !!x), showPrices,
  }, await getHotel(db));
  return { fileName: `Leistungskatalog_${tpl.name.replace(/[^A-Za-z0-9ÄÖÜäöüß-]+/g, '_')}_${o.number}.pdf`, pdf: Buffer.from(pdf), tpl, o };
}
export async function catalogMailDraft(db: Exec, id: string, templateId: string | null) {
  const { o, tpl } = await catalogOf(db, id, templateId);
  const h = await getHotel(db);
  const when = whenText(o);
  const text = [o.customerName ? `Guten Tag ${o.customerName},` : 'Guten Tag,', '',
    `vielen Dank für Ihre Anfrage${o.title ? ` (${o.title})` : ''}${when ? ` für ${when}` : ''}. Anbei erhalten Sie unseren Leistungskatalog „${tpl.name}“.`, '',
    'So einfach geht es:',
    '1. PDF öffnen und die gewünschten Leistungen ankreuzen',
    '2. Personenzahl, Wunschtermin und Ihre Wünsche ergänzen',
    '3. PDF speichern und als Antwort auf diese E-Mail an uns zurückschicken', '',
    'Sie können uns natürlich auch einfach schreiben oder anrufen. Danach erhalten Sie von uns ein verbindliches Angebot.', '',
    signature(h)].join('\n');
  return { to: o.email, subject: withCode(`Leistungskatalog ${tpl.name}${o.title ? ` – ${o.title}` : ''} – ${h.name}`, o.number), text, attachment: `Leistungskatalog ${tpl.name} (PDF zum Ankreuzen)`, ready: await ready(db) };
}
/** Katalog senden – das Angebot bleibt ein Entwurf (Status unverändert); vermerkt im Protokoll */
export async function sendCatalog(db: Db, actor: Actor, id: string, templateId: string | null, v: { to: string; subject: string; text: string }) {
  const { fileName, pdf, tpl, o } = await catalogPdf(db, id, templateId);
  if (o.status === 'accepted' || o.status === 'declined') throw conflict('Das Angebot ist bereits abgeschlossen.');
  await sendMail(db, actor, { to: v.to, subject: withCode(v.subject, o.number), text: v.text, attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }] });
  await logMailOut(db, id, 'catalog', actor, v.to, withCode(v.subject, o.number), v.text);
  await record(db, actor, { action: 'send_catalog', entity: 'offer', entityId: id, after: { to: v.to, number: o.number, catalog: tpl.name } });
  return { ok: true };
}
/** Zurückgeschicktes, ausgefülltes Katalog-PDF lesen – ändert nichts; übernommen wird erst im Angebot (Speichern) */
export async function readCatalog(db: Exec, id: string, data: Buffer): Promise<CatalogReturn> {
  const o = await getOffer(db, id);
  const all = (await db.select({ id: offerItems.id, active: offerItems.active }).from(offerItems)).filter((x) => x.active).map((x) => x.id);
  let r: Awaited<ReturnType<typeof readCatalogPdf>>;
  try { r = await readCatalogPdf(data, all); }
  catch { throw new AppError(400, 'bad_pdf', 'Die Datei lässt sich nicht als PDF lesen.'); }
  if (!r.found) throw new AppError(422, 'no_form', 'In diesem PDF sind keine Ankreuzfelder (mehr). Wurde es ausgedruckt, eingescannt oder „als PDF gedruckt“? Dann bitte die Leistungen hier von Hand ankreuzen.');
  const warnings: string[] = [];
  if (r.offerNumber && r.offerNumber !== o.number) warnings.push(`Das PDF gehört zu ${r.offerNumber}, geöffnet ist ${o.number}. Bitte prüfen, ob es der richtige Kunde ist.`);
  if (r.unknown > 0) warnings.push(`${r.unknown} angekreuzte Leistung(en) gibt es nicht mehr oder sind ausgeblendet – bitte von Hand ergänzen.`);
  if (!r.itemIds.length) warnings.push('Im PDF ist keine Leistung angekreuzt.');
  return { itemIds: r.itemIds, persons: r.persons, date: r.date, name: r.name, remarks: r.remarks, offerNumber: r.offerNumber, warnings };
}

// ---------- Absprache am Tisch ----------
/** Absprache am Angebot festhalten (Momentaufnahme der Antworten); ändert weder Inhalt noch Status des Angebots */
export async function saveTalk(db: Db, actor: Actor, id: string, v: TalkInput) {
  const talk: OfferTalk = { ...v, at: new Date().toISOString(), by: actor.userName };
  const done = await db.update(offers).set({ talk, updatedAt: new Date() }).where(eq(offers.id, id)).returning({ id: offers.id });
  if (!done.length) throw notFound('Angebot');
  await record(db, actor, { action: 'talk', entity: 'offer', entityId: id, after: { template: v.template, steps: v.steps.length } });
  return talk;
}
