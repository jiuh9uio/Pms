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
}).refine((v) => !v.serviceFrom || !v.serviceTo || v.serviceFrom <= v.serviceTo, { message: 'Ende liegt vor dem Beginn', path: ['serviceTo'] })
  .refine((v) => !!(v.recipientCompany || v.recipientName), { message: 'Bitte Firma oder Namen angeben', path: ['recipientName'] });
export const invoiceLineInput = z.object({
  description: required(160), detail: text(200),
  quantity: z.number('Bitte eine Zahl eingeben').positive('Größer als 0').max(10_000),
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
}).refine((v) => !!v.bookingId || !!v.invoiceId, { message: 'Reservierung oder Rechnung angeben', path: ['bookingId'] });
export const reverseInput = z.object({ note: required(300) });

/** Steuerausweis: Bruttobeträge je Satz → Netto und Steuer (Rundung je Steuersatz auf Summenebene). */
export function taxBreakdown(lines: { totalCents: number; taxRatePercent: number }[]) {
  const by = new Map<number, number>();
  for (const l of lines) by.set(l.taxRatePercent, (by.get(l.taxRatePercent) ?? 0) + l.totalCents);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([rate, gross]) => {
    const net = Math.round(gross / (1 + rate / 100));
    return { rate, grossCents: gross, netCents: net, taxCents: gross - net };
  });
}

export interface InvoiceLineDto { id: string; pos: number; description: string; detail: string; quantity: number; unitPriceCents: number; taxRatePercent: number; totalCents: number }
export interface PaymentDto {
  id: string; bookingId: string | null; invoiceId: string | null; invoiceNumber: string | null; amountCents: number; method: string; date: string;
  payer: string; note: string; reversesId: string | null; reversed: boolean; recordedBy: string; createdAt: string;
}
export interface IssuerDto { name: string; street: string; zip: string; city: string; country: string; phone: string; email: string; website: string; taxNumber: string; vatId: string; bankName: string; iban: string; bic: string; footer: string }
export interface InvoiceDto {
  id: string; number: string | null; kind: 'invoice' | 'cancellation'; status: 'draft' | 'issued' | 'cancelled';
  bookingId: string | null; bookingNumber: string | null; cancelsId: string | null; cancelsNumber: string | null; cancelledById: string | null; cancelledByNumber: string | null;
  recipientCompany: string; recipientName: string; recipientStreet: string; recipientZip: string; recipientCity: string; recipientCountry: string; recipientVatId: string;
  serviceFrom: string | null; serviceTo: string | null; issueDate: string | null; dueDate: string | null; notes: string; cancelReason: string;
  grossCents: number; paidCents: number; openCents: number; createdBy: string; issuedBy: string; issuedAt: string | null; version: number;
  issuer: IssuerDto | null; lines: InvoiceLineDto[]; payments: PaymentDto[]; taxes: ReturnType<typeof taxBreakdown>;
}
export type InvoiceListRow = Omit<InvoiceDto, 'lines' | 'payments' | 'taxes' | 'issuer'>;
export interface BookingBillingDto { invoices: InvoiceListRow[]; payments: PaymentDto[]; invoicedCents: number; paidCents: number; unassignedPaidCents: number }
