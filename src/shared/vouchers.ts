import { z } from 'zod';
import { isIsoDate } from './hotel.js';

/** Gutscheine: Geschenkkarten aus dem Kassenprogramm mit interner Nummer, PIN, Motiv, E-Mail-Versand und Rechnung. */

const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const isoDate = z.string().refine(isIsoDate, 'Bitte ein Datum wählen');
const email = z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse').max(200)]);
const cents = (min: number, msg: string) => z.number('Bitte einen Betrag eingeben').int('Ungültiger Betrag').min(min, msg).max(10_000_000, 'Betrag zu hoch');

export const VOUCHER_STATUS = ['active', 'redeemed', 'cancelled'] as const;
export type VoucherStatus = (typeof VOUCHER_STATUS)[number];
export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = { active: 'gültig', redeemed: 'eingelöst', cancelled: 'storniert' };
export const TEXT_POS = ['right', 'left', 'bottom'] as const;
export type TextPos = (typeof TEXT_POS)[number];
export const TEXT_POS_LABEL: Record<TextPos, string> = { right: 'Text rechts', left: 'Text links', bottom: 'Text unten' };

/** Nummernkreis: Kürzel + fortlaufende Zahl; nächste Nummer = höchste vergebene + 1, mindestens Startwert */
export const voucherNumberingInput = z.object({
  prefix: text(12).regex(/^[A-Za-z0-9-_/]*$/, 'Nur Buchstaben, Ziffern, - _ /'),
  start: z.number('Bitte eine Zahl eingeben').int('Ganze Zahl').min(1, 'Mindestens 1').max(99_999_999),
  digits: z.number().int().min(1).max(8),
  /** Gültigkeit in Jahren zum Jahresende (0 = kein Ablaufdatum vorschlagen) */
  validYears: z.number().int().min(0).max(10),
  /** Porto, das beim Rechnungsentwurf vorgeschlagen wird */
  postageCents: cents(0, 'Mindestens 0'),
  /** Strichcode der Kassennummer auf den Gutschein drucken */
  barcode: z.boolean().default(true),
});
export type VoucherNumbering = z.infer<typeof voucherNumberingInput>;
export const VOUCHER_NUMBERING_DEFAULT: VoucherNumbering = { prefix: 'SH-', start: 1001, digits: 4, validYears: 3, postageCents: 0, barcode: true };

export const voucherInput = z.object({
  number: required(40),
  /** leer lassen = PIN unverändert (beim Bearbeiten) */
  pin: text(40),
  posCardNo: text(60).regex(/^[\x20-\x7e]*$/, 'Bitte nur Buchstaben ohne Umlaute, Ziffern und einfache Zeichen (wegen des Strichcodes)'),
  valueCents: cents(1, 'Bitte einen Wert eintragen'),
  issuedOn: isoDate,
  validUntil: z.union([z.literal(''), isoDate]),
  buyerName: text(120), buyerCompany: text(160), buyerStreet: text(), buyerZip: text(20), buyerCity: text(), buyerCountry: text(80), buyerEmail: email,
  recipientName: text(120), message: text(400),
  designId: z.union([z.literal(''), z.uuid()]),
  note: text(400),
}).refine((v) => !v.validUntil || v.validUntil >= v.issuedOn, { path: ['validUntil'], message: 'Liegt vor dem Ausstellungsdatum' });
export type VoucherInput = z.infer<typeof voucherInput>;

export const voucherStatusInput = z.object({ status: z.enum(VOUCHER_STATUS), version: z.number().int() });
export const voucherMailInput = z.object({ to: z.email('Ungültige E-Mail-Adresse').max(200), subject: required(200), text: required(5000) });
export const voucherInvoiceInput = z.object({
  /** Steuersatz für den Gutscheinwert (Vorgabe 0 % – Mehrzweckgutschein; im Entwurf änderbar) */
  valueTaxPercent: z.number().min(0).max(100),
  postageCents: cents(0, 'Mindestens 0'),
  postageTaxPercent: z.number().min(0).max(100),
});
export const voucherDesignInput = z.object({
  name: required(80), mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().min(10).max(8_000_000, 'Bild zu groß (höchstens ca. 5 MB)'),
  textPos: z.enum(TEXT_POS),
});

export interface VoucherDto {
  id: string; number: string; hasPin: boolean; pinHint: string; posCardNo: string; valueCents: number; issuedOn: string; validUntil: string | null;
  buyerName: string; buyerCompany: string; buyerStreet: string; buyerZip: string; buyerCity: string; buyerCountry: string; buyerEmail: string;
  recipientName: string; message: string; designId: string | null; status: VoucherStatus; invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
  sentAt: string | null; sentTo: string | null; note: string; createdBy: string; createdAt: string; version: number;
}
export interface VoucherDesignDto { id: string; name: string; textPos: TextPos; createdAt: string; hasImage: boolean; hasLayout: boolean }
export interface VoucherOverviewDto { vouchers: VoucherDto[]; designs: VoucherDesignDto[]; numbering: VoucherNumbering; nextNumber: string; suggestedValidUntil: string }

// ---------- Design-Editor ----------
/** Seite: DIN A5 quer, Maße in Millimetern (Ursprung oben links) */
export const PAGE_W = 210;
export const PAGE_H = 148;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB');
const mm = (max: number) => z.number().min(-50).max(max);
export const DESIGN_ELEMENT_TYPES = ['text', 'logo', 'barcode', 'box'] as const;
export const designElement = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(DESIGN_ELEMENT_TYPES),
  /** Bezeichnung in der Elementliste */
  label: text(40),
  x: mm(PAGE_W + 50), y: mm(PAGE_H + 50), w: z.number().min(2).max(PAGE_W + 100), h: z.number().min(2).max(PAGE_H + 100),
  hidden: z.boolean().default(false),
  // Text
  text: text(600).default(''),
  font: z.enum(['serif', 'sans']).default('serif'),
  size: z.number().min(5).max(96).default(12),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right']).default('left'),
  color: hex.default('#1f1f24'),
  // Fläche
  fill: hex.default('#ffffff'),
  opacity: z.number().min(0).max(1).default(1),
  radius: z.number().min(0).max(30).default(0),
  border: z.union([z.literal(''), hex]).default(''),
});
export type DesignElement = z.infer<typeof designElement>;
export const voucherLayout = z.object({
  background: hex.default('#ffffff'),
  /** hochgeladenes Hintergrundbild verwenden (falls vorhanden) */
  useImage: z.boolean().default(true),
  imageFit: z.enum(['cover', 'contain']).default('cover'),
  /** eigene Farbpalette des Designs */
  palette: z.array(hex).max(24).default([]),
  elements: z.array(designElement).max(40),
});
export type VoucherLayout = z.infer<typeof voucherLayout>;
export const voucherDesignSave = z.object({
  name: required(80),
  layout: voucherLayout,
  /** neues Hintergrundbild; null = Bild entfernen; weglassen = unverändert */
  image: z.object({ mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().min(10).max(8_000_000, 'Bild zu groß (höchstens ca. 5 MB)') }).nullable().optional(),
});
export interface VoucherDesignDetailDto { id: string; name: string; hasImage: boolean; textPos: TextPos; layout: VoucherLayout | null }

/** Platzhalter in Texten – werden beim Drucken mit den Angaben des Gutscheins gefüllt */
export const PLACEHOLDERS: { key: string; label: string; sample: string }[] = [
  { key: 'wert', label: 'Wert', sample: '50,00 €' },
  { key: 'empfaenger', label: 'beschenkte Person', sample: 'Erika Beispiel' },
  { key: 'gruss', label: 'Gruß', sample: 'Alles Gute zum Geburtstag!' },
  { key: 'kassennr', label: 'Kassennummer', sample: '100234' },
  { key: 'intern', label: 'interne Nummer', sample: 'SH-1001' },
  { key: 'ausgestellt', label: 'ausgestellt am', sample: '19.11.2026' },
  { key: 'gueltig', label: 'gültig bis', sample: '31.12.2029' },
  { key: 'hotel', label: 'Name des Hauses', sample: 'Hotel & Restaurant Schützenhaus' },
  { key: 'adresse', label: 'Anschrift', sample: 'Musterweg 1, 12345 Musterstadt' },
  { key: 'telefon', label: 'Telefon', sample: '01234 5678' },
  { key: 'website', label: 'Website', sample: 'www.example.de' },
];
/**
 * Platzhalter ersetzen. Zeilen, deren Platzhalter alle leer bleiben, fallen weg
 * (z. B. „für {empfaenger}“ ohne beschenkte Person, „gültig bis {gueltig}“ ohne Datum).
 */
export function fillText(text: string, values: Record<string, string>): string {
  return text.split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!);
    if (keys.length && keys.every((k) => !values[k])) return [];
    // Teilstücke mit leerem Platzhalter (getrennt durch „ · “) entfernen
    const parts = line.split(' · ').filter((p) => { const k = [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!); return !k.length || k.some((x) => values[x]); });
    return [parts.join(' · ').replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '')];
  }).join('\n');
}

let seq = 0;
const el = (p: Partial<DesignElement> & Pick<DesignElement, 'type' | 'label' | 'x' | 'y' | 'w' | 'h'>): DesignElement => ({
  id: `e${++seq}`, hidden: false, text: '', font: 'serif', size: 12, bold: false, italic: false, align: 'left', color: '#1f1f24',
  fill: '#ffffff', opacity: 1, radius: 0, border: '', ...p,
});
export const DEFAULT_PALETTE = ['#1f1f24', '#ffffff', '#1c457a', '#0f5c46', '#8a1c1c', '#b8860b', '#c9a227', '#6d4c41', '#f3e9d2', '#e8f0ea', '#4a4a4f', '#d4a5a5'];
/** Startvorlagen für neue Designs */
export function layoutTemplate(kind: 'classic' | 'right' | 'bottom', accent = '#0f5c46'): VoucherLayout {
  seq = 0;
  const common = { background: '#ffffff', useImage: true, imageFit: 'cover' as const, palette: [...DEFAULT_PALETTE] };
  if (kind === 'classic') return { ...common, elements: [
    el({ type: 'box', label: 'Rahmen', x: 6, y: 6, w: 198, h: 136, fill: '#ffffff', opacity: 0, border: accent, radius: 2 }),
    el({ type: 'logo', label: 'Logo', x: 85, y: 12, w: 40, h: 16 }),
    el({ type: 'text', label: 'Überschrift', x: 20, y: 32, w: 170, h: 16, text: 'Gutschein', size: 34, bold: true, align: 'center', color: accent }),
    el({ type: 'text', label: 'Wert', x: 20, y: 50, w: 170, h: 10, text: 'im Wert von {wert}', size: 18, bold: true, align: 'center' }),
    el({ type: 'text', label: 'Für', x: 20, y: 63, w: 170, h: 8, text: 'für {empfaenger}', size: 13, align: 'center' }),
    el({ type: 'text', label: 'Gruß', x: 30, y: 72, w: 150, h: 14, text: '{gruss}', size: 11, italic: true, align: 'center', color: '#4a4a4f' }),
    el({ type: 'barcode', label: 'Strichcode', x: 80, y: 92, w: 50, h: 12 }),
    el({ type: 'text', label: 'Nummern', x: 20, y: 106, w: 170, h: 14, text: 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\nausgestellt am {ausgestellt} · gültig bis {gueltig}', font: 'sans', size: 8.5, align: 'center' }),
    el({ type: 'text', label: 'Absender', x: 20, y: 130, w: 170, h: 5, text: '{hotel} · {adresse} · Tel. {telefon}', font: 'sans', size: 7, align: 'center', color: '#4a4a4f' }),
  ] };
  const right = kind === 'right';
  const bx = right ? { x: 108, y: 8, w: 94, h: 132 } : { x: 10, y: 84, w: 190, h: 56 };
  const tx = bx.x + 6, tw = bx.w - 12;
  return { ...common, elements: [
    el({ type: 'box', label: 'Textfeld', ...bx, fill: '#ffffff', opacity: 0.9, radius: 3, border: accent }),
    ...(right ? [
      el({ type: 'logo', label: 'Logo', x: tx, y: 14, w: 36, h: 13 }),
      el({ type: 'text', label: 'Überschrift', x: tx, y: 32, w: tw, h: 14, text: 'Gutschein', size: 30, bold: true, color: accent }),
      el({ type: 'text', label: 'Wert', x: tx, y: 48, w: tw, h: 9, text: 'im Wert von {wert}', size: 16, bold: true }),
      el({ type: 'text', label: 'Für', x: tx, y: 60, w: tw, h: 7, text: 'für {empfaenger}', size: 12 }),
      el({ type: 'text', label: 'Gruß', x: tx, y: 69, w: tw, h: 22, text: '{gruss}', size: 10.5, italic: true, color: '#4a4a4f' }),
      el({ type: 'barcode', label: 'Strichcode', x: tx, y: 98, w: 44, h: 11 }),
      el({ type: 'text', label: 'Nummern', x: tx, y: 112, w: tw, h: 16, text: 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\nausgestellt am {ausgestellt} · gültig bis {gueltig}', font: 'sans', size: 8 }),
      el({ type: 'text', label: 'Absender', x: tx, y: 132, w: tw, h: 5, text: '{hotel} · Tel. {telefon}', font: 'sans', size: 6.5, color: '#4a4a4f' }),
    ] : [
      el({ type: 'text', label: 'Überschrift', x: tx, y: 88, w: 100, h: 13, text: 'Gutschein', size: 26, bold: true, color: accent }),
      el({ type: 'text', label: 'Wert', x: tx, y: 102, w: 100, h: 8, text: 'im Wert von {wert}', size: 15, bold: true }),
      el({ type: 'text', label: 'Für', x: tx, y: 112, w: 100, h: 7, text: 'für {empfaenger}', size: 11.5 }),
      el({ type: 'text', label: 'Gruß', x: tx, y: 120, w: 100, h: 14, text: '{gruss}', size: 10, italic: true, color: '#4a4a4f' }),
      el({ type: 'barcode', label: 'Strichcode', x: 140, y: 90, w: 52, h: 12 }),
      el({ type: 'text', label: 'Nummern', x: 120, y: 105, w: 74, h: 16, text: 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\nausgestellt am {ausgestellt}\ngültig bis {gueltig}', font: 'sans', size: 7.5, align: 'right' }),
      el({ type: 'text', label: 'Absender', x: 120, y: 131, w: 74, h: 5, text: '{hotel} · Tel. {telefon}', font: 'sans', size: 6.5, align: 'right', color: '#4a4a4f' }),
    ]),
  ] };
}
