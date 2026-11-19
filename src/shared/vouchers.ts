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
});
export type VoucherNumbering = z.infer<typeof voucherNumberingInput>;
export const VOUCHER_NUMBERING_DEFAULT: VoucherNumbering = { prefix: 'SH-', start: 1001, digits: 4, validYears: 3, postageCents: 0 };

export const voucherInput = z.object({
  number: required(40),
  /** leer lassen = PIN unverändert (beim Bearbeiten) */
  pin: text(40),
  posCardNo: text(60),
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
export interface VoucherDesignDto { id: string; name: string; textPos: TextPos; createdAt: string }
export interface VoucherOverviewDto { vouchers: VoucherDto[]; designs: VoucherDesignDto[]; numbering: VoucherNumbering; nextNumber: string; suggestedValidUntil: string }
