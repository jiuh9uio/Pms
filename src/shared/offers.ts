import { z } from 'zod';

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
/** „abgelaufen“ ist kein gespeicherter Status: versendet und Gültigkeit überschritten */
export type OfferState = OfferStatus | 'expired';
export const OFFER_STATE_LABEL: Record<OfferState, string> = { draft: 'Entwurf', sent: 'versendet', accepted: 'angenommen', declined: 'abgelehnt', expired: 'abgelaufen' };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen');
const text = (max: number) => z.string().trim().max(max).default('');
const cents = z.number('Bitte einen Betrag eintragen').int().min(-10_000_000).max(10_000_000);
const rate = z.number('Bitte eine Zahl eingeben').min(0).max(100);

export const offerItemInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(120), description: text(500),
  unit: z.enum(OFFER_UNITS), priceCents: cents, taxRatePercent: rate, area: z.enum(OFFER_AREAS), sort: z.number().int().min(0).max(9999).default(0), active: z.boolean().default(true),
});
export type OfferItemInput = z.infer<typeof offerItemInput>;
export interface OfferItemDto extends OfferItemInput { id: string; version: number }

export const offerTemplateInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(80), area: z.enum(OFFER_AREAS),
  title: text(160), intro: text(3000), closing: text(3000),
  questions: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  items: z.array(z.object({ itemId: z.uuid(), quantity: z.number().positive().max(100000).nullable().default(null) })).max(60).default([]),
  validDays: z.number('Bitte eine Zahl eingeben').int().min(1).max(365), depositPercent: z.number('Bitte eine Zahl eingeben').int().min(0).max(100),
  documentIds: z.array(z.uuid()).max(10).default([]), sort: z.number().int().min(0).max(9999).default(0), active: z.boolean().default(true),
});
export type OfferTemplateInput = z.infer<typeof offerTemplateInput>;
export interface OfferTemplateDto extends OfferTemplateInput { id: string; version: number }

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
  templateId: z.uuid().nullable().default(null), area: z.enum(OFFER_AREAS).default('both'), ...customer,
  eventDate: isoDate.nullable().default(null), eventEnd: isoDate.nullable().default(null), persons: z.number('Bitte eine Zahl eingeben').int().min(1).max(5000),
}).refine((v) => !!(v.customerName || v.customerCompany), { message: 'Bitte einen Namen oder eine Firma eintragen', path: ['customerName'] })
  .refine((v) => !v.eventEnd || !v.eventDate || v.eventEnd >= v.eventDate, { message: 'Das Ende liegt vor dem Beginn', path: ['eventEnd'] });
export type OfferCreateInputT = z.infer<typeof offerCreateInput>;
export const offerUpdateInput = z.object({
  area: z.enum(OFFER_AREAS), ...customer,
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
  id: string; number: string; status: OfferStatus; state: OfferState; area: OfferArea; title: string; customer: string; email: string;
  eventDate: string | null; eventEnd: string | null; persons: number; totalCents: number; validUntil: string | null; sentAt: string | null; acceptedAt: string | null;
  bookingId: string | null; tableReservationId: string | null; createdAt: string;
}
export interface OfferDto extends OfferListRow {
  templateId: string | null; customerCompany: string; customerName: string; phone: string; street: string; zip: string; city: string;
  intro: string; closing: string; questions: string[]; depositPercent: number; documentIds: string[]; notes: string;
  sentTo: string; acceptedBy: string; acceptedMethod: string; acceptedHash: string; sentHash: string; declinedAt: string | null;
  lines: OfferLineDto[]; taxes: { rate: number; netCents: number; taxCents: number }[]; version: number;
}
/** Öffentliche Ansicht über den Link (ohne interne Notizen) */
export interface PublicOffer {
  hotelName: string; hotelPhone: string; number: string; title: string; customer: string; eventDate: string | null; eventEnd: string | null; persons: number;
  totalCents: number; validUntil: string | null; state: OfferState; documents: { id: string; name: string }[]; acceptedAt: string | null; acceptedBy: string; questions: string[];
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
export const lineTotal = (q: number, unitPriceCents: number) => Math.round(q * unitPriceCents);

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
