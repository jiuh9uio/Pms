import { z } from 'zod';
import { isIsoDate } from './hotel.js';

const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const version = z.number().int();

export const PAYMENT_METHODS_BILLING = ['Bar', 'Karte', 'Überweisung', 'PayPal', 'Gutschein'] as const;
export const INVOICE_STATUS_LABEL = { draft: 'Entwurf', issued: 'Ausgestellt', cancelled: 'Storniert' } as const;

export const recipientInput = z.object({
  recipientCompany: text(160), recipientName: text(160), recipientStreet: text(), recipientZip: text(20),
  recipientCity: text(), recipientCountry: text(80), recipientVatId: text(40),
});
export const invoiceUpdateInput = recipientInput.extend({
  serviceFrom: isoDate.nullable(), serviceTo: isoDate.nullable(), notes: text(1000), version,
  /** Kostenvoranschlag: gültig bis (leer = ohne Angabe) */
  estimateValidUntil: isoDate.nullable().optional(),
}).refine((v) => !v.serviceFrom || !v.serviceTo || v.serviceFrom <= v.serviceTo, { message: 'Ende liegt vor dem Beginn', path: ['serviceTo'] })
  .refine((v) => !!(v.recipientCompany || v.recipientName), { message: 'Bitte Firma oder Namen angeben', path: ['recipientName'] });
export const invoiceLineInput = z.object({
  description: required(160), detail: text(200),
  // auf 2 Nachkommastellen, wie gespeichert – sonst passt die Zeilensumme nicht zur gedruckten Menge (und zur E-Rechnung)
  quantity: z.number('Bitte eine Zahl eingeben').positive('Größer als 0').max(10_000).transform((q) => Math.round(q * 100) / 100).refine((q) => q > 0, 'Größer als 0'),
  unitPriceCents: z.number('Bitte einen Betrag eingeben').int().min(-10_000_000).max(10_000_000),
  taxRatePercent: z.number('Bitte wählen').min(0).max(100),
});
export const invoiceCreateInput = z.object({
  bookingId: z.uuid().optional(),
  /** Welche Positionen der Reservierung übernommen werden */
  include: z.enum(['all', 'lodging', 'extras', 'none']).default('all'),
});
export const cancelInput = z.object({ reason: required(300) });
export const paymentInput = z.object({
  bookingId: z.uuid().optional(), invoiceId: z.uuid().optional(),
  amountCents: z.number('Bitte einen Betrag eingeben').int('Ungültiger Betrag').refine((n) => n !== 0, 'Betrag darf nicht 0 sein').refine((n) => Math.abs(n) <= 10_000_000, 'Betrag zu hoch'),
  method: z.enum(PAYMENT_METHODS_BILLING, 'Bitte Zahlungsart wählen'), date: isoDate, payer: text(160), note: text(300),
  /** Barzahlung: vom Gast gegebener Betrag */
  givenCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
}).refine((v) => !!v.bookingId || !!v.invoiceId, { message: 'Reservierung oder Rechnung angeben', path: ['bookingId'] });
export const reverseInput = z.object({ note: required(300) });

// ---------- Preisrechnung: alle Preise sind BRUTTO (inklusive Umsatzsteuer) ----------
/**
 * Ganzzahlige Division mit kaufmännischer Rundung (ab ,5 vom Betrag weg – auch bei Minusbeträgen, damit ein Storno
 * genau das Gegenstück der Rechnung ergibt). Gerechnet wird nur mit ganzen Zahlen (Cent), nie mit Kommazahlen.
 */
export function divRound(numerator: number, denominator: number): number {
  const n = BigInt(Math.round(numerator)), d = BigInt(Math.round(denominator));
  if (d <= 0n) throw new Error('Teiler muss größer als 0 sein');
  const a = n < 0n ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return Number(n < 0n ? -q : q);
}
/** Zeilenbetrag brutto in Cent: Menge (höchstens 2 Nachkommastellen) × Einzelpreis brutto */
export const lineGrossCents = (quantity: number, unitPriceCents: number) => divRound(Math.round(quantity * 100) * unitPriceCents, 100);
/** Aus einem Bruttobetrag herausgerechneter Nettobetrag (Steuersatz mit höchstens 2 Nachkommastellen) */
export const netFromGross = (grossCents: number, taxRatePercent: number) => divRound(grossCents * 10_000, 10_000 + Math.round(taxRatePercent * 100));
/**
 * Steuerausweis: Die Bruttobeträge werden je Steuersatz summiert; aus jeder Summe werden Netto und enthaltene Umsatzsteuer
 * herausgerechnet (Rundung einmal je Steuersatz auf der Summe, nicht je Zeile). Netto + Steuer ergibt immer genau das Brutto –
 * die Umsatzsteuer wird nie auf einen eingegebenen Preis aufgeschlagen.
 */
export function taxBreakdown(lines: { totalCents: number; taxRatePercent: number }[]) {
  const by = new Map<number, number>();
  for (const l of lines) by.set(l.taxRatePercent, (by.get(l.taxRatePercent) ?? 0) + l.totalCents);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([rate, gross]) => {
    const net = netFromGross(gross, rate);
    return { rate, grossCents: gross, netCents: net, taxCents: gross - net };
  });
}
/** Beschriftung des Leistungsdatums: ein Tag = Termin/Datum, mehrere Tage = Zeitraum; bei Kostenvoranschlägen „voraussichtlich“ (beim Zeitraum kurz, damit daneben Platz für beide Daten bleibt) */
export function serviceLabel(from: string | null, to: string | null, estimate: boolean): string {
  const range = !!from && !!to && to !== from;
  return estimate ? (range ? 'Leistung vorauss.' : 'Voraussichtl. Leistungstermin') : range ? 'Leistungszeitraum' : 'Leistungsdatum';
}

export interface InvoiceLineDto { id: string; pos: number; description: string; detail: string; quantity: number; unitPriceCents: number; taxRatePercent: number; totalCents: number }
export interface PaymentDto {
  id: string; bookingId: string | null; invoiceId: string | null; invoiceNumber: string | null; amountCents: number; method: string; date: string;
  payer: string; note: string; reversesId: string | null; reversed: boolean; recordedBy: string; createdAt: string;
  /** TSE-Aufzeichnung dieser Zahlung; null = nicht mit der TSE aufgezeichnet */
  tse: { status: 'signed' | 'failed'; transactionNumber: number | null; signatureCounter: number | null } | null;
}
export interface IssuerDto { name: string; street: string; zip: string; city: string; country: string; phone: string; email: string; website: string; taxNumber: string; vatId: string; bankName: string; iban: string; bic: string; footer: string }
export interface InvoiceDto {
  id: string; number: string | null; kind: 'invoice' | 'cancellation'; status: 'draft' | 'issued' | 'cancelled';
  /** Kostenvoranschlag (KV-Jahr-Nr.): der Entwurf wird als Kostenvoranschlag geführt bzw. die Rechnung ist daraus entstanden */
  estimateNumber: string | null;
  /** Kostenvoranschlag: gültig bis */
  estimateValidUntil?: string | null;
  bookingId: string | null; bookingNumber: string | null; cancelsId: string | null; cancelsNumber: string | null; cancelledById: string | null; cancelledByNumber: string | null;
  recipientCompany: string; recipientName: string; recipientStreet: string; recipientZip: string; recipientCity: string; recipientCountry: string; recipientVatId: string;
  serviceFrom: string | null; serviceTo: string | null; issueDate: string | null; dueDate: string | null; notes: string; cancelReason: string;
  grossCents: number; paidCents: number; openCents: number; createdBy: string; issuedBy: string; issuedAt: string | null; version: number;
  /** Verrechnung zwischen Rechnungen derselben Reservierung: + = Überschuss einer anderen Rechnung hierher übernommen, − = Überschuss an andere abgegeben (in paidCents enthalten) */
  creditCents?: number;
  issuer: IssuerDto | null; lines: InvoiceLineDto[]; payments: PaymentDto[]; taxes: ReturnType<typeof taxBreakdown>;
}
export type InvoiceListRow = Omit<InvoiceDto, 'lines' | 'payments' | 'taxes' | 'issuer'>;
export interface BookingBillingDto { invoices: InvoiceListRow[]; payments: PaymentDto[]; invoicedCents: number; paidCents: number; unassignedPaidCents: number; /** Betrag der Reservierung, der noch auf keiner Rechnung steht */ uninvoicedCents: number }

// ---------- EC-Gerät (Kassenschnittstelle ZVT) ----------
export const terminalSettingsInput = z.object({
  enabled: z.boolean(), host: z.string().trim().max(15).regex(/^(\d{1,3}(\.\d{1,3}){3})?$/, 'IP-Adresse im Format 192.168.1.60'),
  port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535),
  password: z.string().regex(/^\d{6}$/, 'Genau 6 Ziffern, meist 000000'),
  /** Angaben zum Gerät – nur zur Dokumentation und für Rückfragen bei VR Payment */
  maker: text(60).default(''), model: text(60).default(''), terminalId: text(20).default(''),
});
/** Fortschritt einer laufenden Zahlung am EC-Gerät. */
export interface TerminalProgress { phase: 'idle' | 'preparing' | 'connecting' | 'payment'; since: string | null }
export type TerminalSettings = z.infer<typeof terminalSettingsInput>;
export const terminalPayInput = z.object({
  bookingId: z.uuid().optional(), invoiceId: z.uuid().optional(),
  amountCents: z.number('Bitte einen Betrag eingeben').int('Ungültiger Betrag').min(1, 'Betrag muss größer als 0 sein').max(10_000_000, 'Betrag zu hoch'),
  payer: text(160), note: text(300),
}).refine((v) => !!v.bookingId || !!v.invoiceId, { message: 'Reservierung oder Rechnung angeben', path: ['bookingId'] });
export interface TerminalLogDto { id: string; at: string; amountCents: number; outcome: 'approved' | 'unrecorded' | 'declined' | 'unknown'; message: string; trace: string; receiptNo: string; cardName: string; userName: string }

// ---------- Rechnungslayout ----------
/** Ja/Nein – auch aus der Vorschau-Adresse („true“/„false“) */
const flag = (d: boolean) => z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(d);
export const invoiceLayoutInput = z.object({
  spacing: z.enum(['compact', 'normal', 'wide']).default('normal'),
  fontSize: z.enum(['small', 'normal', 'large']).default('normal'),
  /** Satz über den Positionen, z. B. „Vielen Dank für Ihren Aufenthalt.“ */
  intro: z.string().trim().max(300).default(''),
  /** Schlusssatz unter den Summen */
  closing: z.string().trim().max(300).default(''),
  style: z.enum(['classic', 'modern', 'elegant']).default('classic'),
  accent: z.enum(['black', 'blue', 'green', 'red', 'gold', 'petrol', 'custom']).default('black'),
  font: z.enum(['sans', 'serif']).default('sans'),
  logoPos: z.enum(['right', 'left', 'center']).default('right'),
  table: z.enum(['lines', 'stripes', 'plain']).default('lines'),
  /** eigene Farbe (#rrggbb), wenn accent = 'custom' */
  accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe als #RRGGBB').default('#1c457a'),
  logoSize: z.enum(['small', 'normal', 'large']).default('normal'),
  /** Falz- und Lochmarken am linken Rand (für gefaltete Briefe) */
  foldMarks: flag(false),
  /** Zahlungs-QR-Code (GiroCode) bei offenem Betrag – Banking-Apps übernehmen Empfänger, IBAN, Betrag und Verwendungszweck */
  qrCode: flag(false),
  /** vorgedrucktes Briefpapier: Kopf (Name, Logo) und Fuß (Anschrift, Bank) nicht drucken, Platz bleibt frei */
  letterhead: flag(false),
  /** kleine Absenderzeile über der Anschrift (für Fensterumschläge) */
  senderLine: flag(true),
  /** Kostenvoranschlag: so viele Tage gilt er ab dem Tag, an dem er angelegt wird (0 = ohne Gültigkeitsangabe) */
  estimateValidDays: z.coerce.number('Bitte eine Zahl eingeben').int().min(0).max(365).default(14),
});
export type InvoiceLayoutDto = z.infer<typeof invoiceLayoutInput>;

// ---------- Zettel für die Buchhaltung (interner Vermerk, kein Kassenbeleg) ----------
export interface AccountingSlipDto {
  hotelName: string; createdAt: string; createdBy: string;
  booking: { number: string; guest: string; company: string; from: string | null; to: string | null; rooms: string };
  /** nur die Zahlung eines Vorgangs (z. B. der eben abgeschlossene Bezahlvorgang), sonst alle */
  onlyRecent: boolean;
  payments: { date: string; method: string; amountCents: number; givenCents: number | null; invoiceNumber: string | null; recordedBy: string; createdAt: string; tse: string | null; reversal: boolean }[];
  byMethod: { method: string; amountCents: number }[];
  paymentsTotalCents: number;
  invoices: { number: string; kind: 'invoice' | 'cancellation'; issueDate: string | null; grossCents: number; status: string; taxes: { rate: number; netCents: number; taxCents: number; grossCents: number }[] }[];
  totalCents: number; paidCents: number; openCents: number;
}

// ---------- Buchungsliste für den Steuerberater (Vorbereitung) ----------
/**
 * Kontenzuordnung für die Buchungsliste. Die Vorschläge sind die üblichen Konten im SKR03 – sie sind NICHT geprüft
 * und müssen mit dem Steuerberater abgestimmt werden. Ein DATEV-Importformat ist bewusst (noch) nicht enthalten.
 */
const acct = z.string().trim().regex(/^\d{0,9}$/, 'Nur Ziffern');
export const accountingSettingsInput = z.object({
  chart: z.enum(['SKR03', 'SKR04', 'eigen']).default('SKR03'),
  receivables: acct, cash: acct, bank: acct, card: acct, paypal: acct, voucher: acct,
  /** Erlöskonto je Steuersatz (in %, als Text-Schlüssel, z. B. „7“, „19“, „0“) */
  revenue: z.record(z.string().regex(/^\d{1,2}(\.\d{1,2})?$/), acct),
});
export type AccountingSettings = z.infer<typeof accountingSettingsInput>;
export const CHART_DEFAULTS: Record<'SKR03' | 'SKR04', AccountingSettings> = {
  SKR03: { chart: 'SKR03', receivables: '1400', cash: '1000', bank: '1200', card: '1360', paypal: '1360', voucher: '', revenue: { '7': '8300', '19': '8400', '0': '8100' } },
  SKR04: { chart: 'SKR04', receivables: '1200', cash: '1600', bank: '1800', card: '1460', paypal: '1460', voucher: '', revenue: { '7': '4300', '19': '4400', '0': '4100' } },
};

/** Ausfallgebühr als Rechnungsentwurf */
export const cancelFeeInput = z.object({
  amountCents: z.number('Bitte einen Betrag eintragen').int().min(1, 'Betrag größer als 0').max(10_000_000),
  taxRatePercent: z.number('Bitte einen Steuersatz wählen').min(0).max(100),
  text: z.string().trim().max(120).default(''),
});

/** Verlauf eines Kostenvoranschlags / einer Rechnung (wie ein Chat) */
export interface InvoiceTimelineEntry { id: string; at: string; dir: 'out' | 'in' | 'event'; /** Art der gesendeten E-Mail bzw. des Vermerks (estimate, order_confirm, order_ready, table …) */ what?: string; title: string; by: string; subject: string; text: string; answer: 'yes' | 'no' | 'unclear' | null; removable: boolean }
export interface InvoiceTimeline {
  /** Kennzeichen im Betreff (KV-Nummer), an dem Antworten erkannt werden */
  code: string;
  /** letzte Antwort des Kunden auf den Kostenvoranschlag: Ja / Nein / unklar (nur ein Hinweis – die Rechnung wird von Hand ausgestellt) */
  answer: 'yes' | 'no' | 'unclear' | null;
  /** hat der Kunde seit der letzten gesendeten E-Mail geantwortet? */
  waiting: boolean;
  /** letzte Empfängeradresse */
  lastTo: string;
  entries: InvoiceTimelineEntry[];
  candidates: { inboxMailId: string; at: string; from: string; subject: string }[];
}
