import { z } from 'zod';
import { lineGrossCents } from './billing.js';

/** Angebote für Tagungen, Feiern und Gruppen: Katalog (Leistungen), Vorlagen, Angebote mit Positionen. */
export const OFFER_UNITS = ['person', 'day', 'person_day', 'night', 'person_night', 'flat'] as const;
export type OfferUnit = (typeof OFFER_UNITS)[number];
export const UNIT_LABEL: Record<OfferUnit, string> = {
  person: 'pro Person', day: 'pro Tag', person_day: 'pro Person und Tag', night: 'pro Nacht', person_night: 'pro Person und Nacht', flat: 'pauschal',
};
export const OFFER_AREAS = ['hotel', 'restaurant', 'both'] as const;
export type OfferArea = (typeof OFFER_AREAS)[number];
export const AREA_LABEL: Record<OfferArea, string> = { hotel: 'Hotel', restaurant: 'Restaurant', both: 'Hotel & Restaurant' };
export type OfferStatus = 'draft' | 'sent' | 'accepted' | 'declined';
export type OfferMode = 'offer' | 'questions';
export const MODE_LABEL: Record<OfferMode, string> = { questions: 'Nur Fragen stellen', offer: 'Angebot mit Leistungen' };
/** berechnete Zustände: „abgelaufen“ (versendet, Gültigkeit überschritten); bei „nur Fragen“: „Fragen gesendet“ / „beantwortet“ */
export type OfferState = OfferStatus | 'expired' | 'asked' | 'answered';
export const OFFER_STATE_LABEL: Record<OfferState, string> = { draft: 'Entwurf', sent: 'versendet', accepted: 'angenommen', declined: 'abgelehnt', expired: 'abgelaufen', asked: 'Fragen gesendet', answered: 'beantwortet' };
export interface OfferAnswers { at: string; name: string; items: { q: string; a: string }[] }
export const publicAnswersInput = z.object({
  name: z.string().trim().min(2, 'Bitte Ihren Namen eintragen').max(120),
  answers: z.array(z.string().trim().max(1000)).max(40),
}).refine((v) => v.answers.some((a) => a.length > 0), { message: 'Bitte mindestens eine Frage beantworten', path: ['answers'] });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen');
const text = (max: number) => z.string().trim().max(max).default('');
const cents = z.number('Bitte einen Betrag eintragen').int().min(-10_000_000).max(10_000_000);
const rate = z.number('Bitte eine Zahl eingeben').min(0).max(100);

export const offerItemInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(120), description: text(500),
  unit: z.enum(OFFER_UNITS), priceCents: cents, taxRatePercent: rate, area: z.enum(OFFER_AREAS), group: text(60), sort: z.number().int().min(0).max(9999).default(0), active: z.boolean().default(true),
});
export type OfferItemInput = z.infer<typeof offerItemInput>;
export interface OfferItemDto extends OfferItemInput { id: string; version: number }
/** Leistungen nach Gruppe ordnen (Reihenfolge: erstes Vorkommen; ohne Gruppe zuletzt als „Weitere Leistungen“) */
export function groupItems<T extends { group: string }>(items: T[]): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = [];
  for (const it of items) {
    const name = it.group.trim();
    if (!name) continue;
    const g = out.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (g) g.items.push(it); else out.push({ name, items: [it] });
  }
  const rest = items.filter((x) => !x.group.trim());
  if (rest.length) out.push({ name: out.length ? 'Weitere Leistungen' : 'Leistungen', items: rest });
  return out;
}

// ---------- Absprache (am Tisch): frei einstellbare Schritte je Vorlage ----------
export const TALK_KINDS = ['single', 'multi', 'text'] as const;
export type TalkKind = (typeof TALK_KINDS)[number];
export const TALK_KIND_LABEL: Record<TalkKind, string> = { single: 'eine Antwort', multi: 'mehrere Antworten', text: 'nur Text' };
/** Antwort zum Antippen; mit itemId kommt die Leistung (mit Preis) ins Angebot, ohne ist es nur eine Angabe (z. B. „à la carte“) */
export const talkOption = z.object({ label: z.string().trim().min(1, 'Bitte die Antwort benennen').max(80), itemId: z.uuid().nullable().default(null) });
export const talkStep = z.object({
  title: z.string().trim().min(1, 'Bitte den Schritt benennen').max(80), hint: text(200), kind: z.enum(TALK_KINDS).default('single'),
  options: z.array(talkOption).max(20).default([]),
});
export type TalkStep = z.infer<typeof talkStep>;
/** Festgehaltene Absprache (Momentaufnahme: bleibt lesbar, auch wenn die Vorlage später geändert wird) */
export const talkInput = z.object({
  template: text(80),
  steps: z.array(z.object({ title: z.string().trim().min(1).max(80), answers: z.array(z.string().trim().min(1).max(80)).max(20), text: text(1000) })).max(20),
});
export type TalkInput = z.infer<typeof talkInput>;
export interface OfferTalk extends TalkInput { at: string; by: string }

export const offerTemplateInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(80), area: z.enum(OFFER_AREAS),
  title: text(160), intro: text(3000), closing: text(3000),
  questions: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  /** Produktkatalog der Vorlage (z. B. „Tagung“); preselect = gleich ins neue Angebot übernehmen, sonst nur zur Auswahl angeboten */
  items: z.array(z.object({ itemId: z.uuid(), quantity: z.number().positive().max(100000).nullable().default(null), preselect: z.boolean().default(true) })).max(80).default([]),
  validDays: z.number('Bitte eine Zahl eingeben').int().min(1).max(365), depositPercent: z.number('Bitte eine Zahl eingeben').int().min(0).max(100),
  documentIds: z.array(z.uuid()).max(10).default([]), sort: z.number().int().min(0).max(9999).default(0), active: z.boolean().default(true),
  /** Schritte der Absprache am Tisch (leer = die Gruppen des Produktkatalogs dienen als Schritte) */
  talkSteps: z.array(talkStep).max(20).default([]),
  /** Preise im Katalog-PDF für den Kunden zeigen (gespeichert in den Einstellungen, nicht in der Vorlagen-Tabelle) */
  catalogPrices: z.boolean().default(false),
});
export type OfferTemplateInput = z.infer<typeof offerTemplateInput>;
export interface OfferTemplateDto extends OfferTemplateInput { id: string; version: number }

/** Rückmeldung des Kunden aus dem ausgefüllten Katalog-PDF */
export interface CatalogReturn {
  itemIds: string[]; persons: number | null; date: string; name: string; remarks: string;
  /** Nummer, die im PDF steht – weicht sie vom geöffneten Angebot ab, gibt es einen Hinweis */
  offerNumber: string; warnings: string[];
}

export interface OfferDocumentDto { id: string; name: string; fileName: string; sizeBytes: number; active: boolean; uploadedBy: string; createdAt: string }

export const offerLineInput = z.object({
  itemId: z.uuid().nullable().default(null), description: z.string().trim().min(1, 'Bitte eine Bezeichnung eintragen').max(200), detail: text(300),
  // Menge auf 2 Nachkommastellen (so wird sie gespeichert) – sonst passt die Zeilensumme nicht zur gedruckten Menge
  unit: z.enum(OFFER_UNITS), quantity: z.number('Bitte eine Zahl eingeben').min(0).max(100000).transform((q) => Math.round(q * 100) / 100), unitPriceCents: cents, taxRatePercent: rate,
}).refine((l) => Math.abs(l.quantity * l.unitPriceCents) <= 1_000_000_000, { message: 'Betrag der Zeile ist zu hoch', path: ['quantity'] });
export type OfferLineInput = z.infer<typeof offerLineInput>;

const customer = {
  customerCompany: text(160), customerName: text(120), email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]).default(''),
  phone: text(60), street: text(160), zip: text(12), city: text(80),
};
export const offerCreateInput = z.object({
  templateId: z.uuid().nullable().default(null), area: z.enum(OFFER_AREAS).default('both'), mode: z.enum(['offer', 'questions']).default('offer'), ...customer,
  eventDate: isoDate.nullable().default(null), eventEnd: isoDate.nullable().default(null), persons: z.number('Bitte eine Zahl eingeben').int().min(1).max(5000),
}).refine((v) => !!(v.customerName || v.customerCompany), { message: 'Bitte einen Namen oder eine Firma eintragen', path: ['customerName'] })
  .refine((v) => !v.eventEnd || !v.eventDate || v.eventEnd >= v.eventDate, { message: 'Das Ende liegt vor dem Beginn', path: ['eventEnd'] });
export type OfferCreateInputT = z.infer<typeof offerCreateInput>;
export const offerUpdateInput = z.object({
  area: z.enum(OFFER_AREAS), mode: z.enum(['offer', 'questions']).default('offer'), ...customer,
  eventDate: isoDate.nullable(), eventEnd: isoDate.nullable(), persons: z.number('Bitte eine Zahl eingeben').int().min(1).max(5000),
  title: text(160), intro: text(3000), closing: text(3000), questions: z.array(z.string().trim().min(1).max(200)).max(40),
  validUntil: isoDate.nullable(), depositPercent: z.number().int().min(0).max(100), documentIds: z.array(z.uuid()).max(10), notes: text(2000),
  lines: z.array(offerLineInput).max(80), version: z.number().int(),
}).refine((v) => !!(v.customerName || v.customerCompany), { message: 'Bitte einen Namen oder eine Firma eintragen', path: ['customerName'] })
  .refine((v) => !v.eventEnd || !v.eventDate || v.eventEnd >= v.eventDate, { message: 'Das Ende liegt vor dem Beginn', path: ['eventEnd'] });
export type OfferUpdateInput = z.infer<typeof offerUpdateInput>;
export const offerSendInput = z.object({ to: z.email('Ungültige E-Mail-Adresse'), subject: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(10000) });
export const offerAcceptInput = z.object({ method: z.enum(['email', 'telefon', 'persoenlich', 'schriftlich']), name: z.string().trim().min(1, 'Bitte den Namen eintragen').max(120), note: text(300) });
export const publicOfferAcceptInput = z.object({ name: z.string().trim().min(2, 'Bitte Ihren vollständigen Namen eintragen').max(120), agree: z.literal(true, 'Bitte bestätigen, dass Sie Angebot und Bedingungen gelesen haben') });

export interface OfferLineDto extends OfferLineInput { id: string; pos: number; totalCents: number }
export interface OfferListRow {
  id: string; number: string; status: OfferStatus; state: OfferState; mode: OfferMode; area: OfferArea; title: string; customer: string; email: string;
  eventDate: string | null; eventEnd: string | null; persons: number; totalCents: number; validUntil: string | null; sentAt: string | null; acceptedAt: string | null;
  bookingId: string | null; tableReservationId: string | null; createdAt: string;
}
export interface OfferDto extends OfferListRow {
  templateId: string | null; customerCompany: string; customerName: string; phone: string; street: string; zip: string; city: string;
  intro: string; closing: string; questions: string[]; depositPercent: number; documentIds: string[]; notes: string;
  sentTo: string; acceptedBy: string; acceptedMethod: string; acceptedHash: string; sentHash: string; declinedAt: string | null;
  lines: OfferLineDto[]; taxes: { rate: number; netCents: number; taxCents: number }[]; version: number;
  answers: OfferAnswers | null;
  /** Absprache am Tisch (falls das Angebot daraus entstand) */
  talk: OfferTalk | null;
}
/** Verlauf eines Angebots (wie ein Chat): gesendete und empfangene E-Mails, Absprache, Antworten, Annahme */
export interface OfferTimelineEntry {
  id: string; at: string; dir: 'out' | 'in' | 'event'; title: string; by: string; subject: string; text: string;
  /** nur bei Antworten des Kunden: klingt nach Zusage/Absage – nur ein Hinweis, entschieden wird von Hand */
  hint: 'accept' | 'decline' | null;
  /** zugeordnete Posteingangs-Mail lässt sich wieder lösen */
  removable: boolean;
  /** gespeicherte Anhänge der E-Mail (z. B. der ausgefüllte Katalog) */
  attachments: { id: string; name: string; size: number; type: string }[];
}
export interface OfferTimeline {
  /** Kennzeichen im Betreff, an dem Antworten erkannt werden */
  code: string; entries: OfferTimelineEntry[];
  /** E-Mails derselben Adresse im Posteingang, die noch keinem Angebot zugeordnet sind */
  candidates: { inboxMailId: string; at: string; from: string; subject: string }[];
}
/** Öffentliche Ansicht über den Link (ohne interne Notizen) */
export interface PublicOffer {
  hotelName: string; hotelPhone: string; number: string; title: string; customer: string; eventDate: string | null; eventEnd: string | null; persons: number;
  totalCents: number; validUntil: string | null; state: OfferState; documents: { id: string; name: string }[]; acceptedAt: string | null; acceptedBy: string; questions: string[];
  mode: OfferMode; answers: OfferAnswers | null;
}

/** Tage und Nächte aus Beginn/Ende (ohne Ende: 1 Tag, 1 Nacht) */
export function spanOf(from: string | null, to: string | null) {
  if (!from || !to) return { days: 1, nights: 1 };
  const d = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
  return { days: Math.max(1, d + 1), nights: Math.max(1, d) };
}
/** Vorgeschlagene Menge je Abrechnungsart */
export function quantityFor(unit: OfferUnit, persons: number, from: string | null, to: string | null) {
  const { days, nights } = spanOf(from, to);
  return { person: persons, day: days, person_day: persons * days, night: nights, person_night: persons * nights, flat: 1 }[unit];
}
/** Zeilenbetrag brutto – dieselbe Rechnung wie bei Rechnungen */
export const lineTotal = (q: number, unitPriceCents: number) => lineGrossCents(q, unitPriceCents);

// ---------- Gestaltung des Angebots-PDFs (Angebote → Gestaltung) ----------
const flag = (d: boolean) => z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(d);
export const offerLayoutInput = z.object({
  /** true = Farben, Schrift und Logo wie im Rechnungslayout; die übrigen Angaben gelten trotzdem */
  likeInvoice: flag(true),
  style: z.enum(['classic', 'modern', 'elegant']).default('classic'),
  accent: z.enum(['black', 'blue', 'green', 'red', 'gold', 'petrol', 'custom']).default('black'),
  accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB').default('#1c457a'),
  font: z.enum(['sans', 'serif']).default('sans'),
  logoPos: z.enum(['right', 'left', 'center']).default('right'),
  logoSize: z.enum(['small', 'normal', 'large']).default('normal'),
  table: z.enum(['lines', 'stripes', 'plain']).default('lines'),
  spacing: z.enum(['compact', 'normal', 'wide']).default('normal'),
  fontSize: z.enum(['small', 'normal', 'large']).default('normal'),
  /** Preise je Position zeigen oder nur den Gesamtbetrag (z. B. bei Pauschalangeboten) */
  prices: z.enum(['all', 'total']).default('all'),
  /** Feld „Ort, Datum, Unterschrift“ für die Annahme auf Papier */
  signature: flag(true),
  /** Fragenkatalog als Kästchen zum Ankreuzen/Ausfüllen statt als Aufzählung */
  questionBoxes: flag(false),
  senderLine: flag(true),
  foldMarks: flag(false),
  letterhead: flag(false),
});
export type OfferLayout = z.infer<typeof offerLayoutInput>;
export const OFFER_LAYOUT_DEFAULT: OfferLayout = offerLayoutInput.parse({});
