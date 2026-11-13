import { z } from 'zod';
import { isIsoDate } from './hotel.js';

/**
 * E-Rechnung im Format ZUGFeRD / Factur-X (Profil EN 16931): eine PDF-Datei mit eingebetteter XML-Datei „factur-x.xml“.
 * Die XML-Datei (Syntax UN/CEFACT CII) enthält die Rechnungsdaten maschinenlesbar und ist der maßgebliche Teil.
 */
const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const country = z.string().regex(/^[A-Z]{2}$/, 'Bitte ein Land wählen');

export const COUNTRIES: [string, string][] = [
  ['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['NL', 'Niederlande'], ['BE', 'Belgien'], ['LU', 'Luxemburg'], ['FR', 'Frankreich'],
  ['IT', 'Italien'], ['PL', 'Polen'], ['CZ', 'Tschechien'], ['DK', 'Dänemark'], ['ES', 'Spanien'], ['GB', 'Vereinigtes Königreich'], ['US', 'USA'],
];
export const countryCode = (name: string) => {
  const n = name.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase();
  return COUNTRIES.find(([, l]) => l.toLowerCase() === n)?.[0] ?? (n === '' || n === 'germany' ? 'DE' : '');
};

/** Zahlungsart nach UNTDID 4461 */
export const PAYMENT_MEANS: [string, string][] = [['58', 'Überweisung (SEPA)'], ['10', 'Bar'], ['48', 'Karte'], ['1', 'Nicht festgelegt']];

const party = z.object({
  name: required(160), street: text(), zip: text(20), city: text(), country,
  vatId: text(40), email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]),
});
export const einvoiceData = z.object({
  number: required(60), issueDate: isoDate, serviceFrom: isoDate, serviceTo: isoDate, dueDate: isoDate.nullable(),
  seller: party.extend({ taxNumber: text(40), phone: text(60), contactName: text(120) })
    .refine((s) => !!(s.vatId || s.taxNumber), { message: 'USt-IdNr. oder Steuernummer des Rechnungsstellers fehlt', path: ['taxNumber'] }),
  buyer: party.extend({ reference: text(100) }),
  lines: z.array(z.object({
    name: required(200), quantity: z.number('Bitte eine Zahl eingeben').positive('Größer als 0').max(100_000),
    /** Bruttopreis je Einheit in Cent */
    unitGrossCents: z.number('Bitte einen Betrag eingeben').int().min(-10_000_000).max(10_000_000),
    taxRate: z.number('Bitte wählen').min(0).max(100),
  })).min(1, 'Mindestens eine Position').max(200),
  paidCents: z.number().int().min(0).max(100_000_000),
  paymentMeans: z.enum(['58', '10', '48', '1']),
  iban: text(40), bic: text(15), paymentTerms: text(300), note: text(1000),
}).refine((v) => v.serviceFrom <= v.serviceTo, { message: 'Ende liegt vor dem Beginn', path: ['serviceTo'] });
export type EInvoiceData = z.infer<typeof einvoiceData>;

export const einvoiceUploadInput = z.object({
  fileName: required(200), pdfBase64: z.string().min(100, 'Bitte eine PDF-Datei wählen').max(14_000_000, 'Die PDF-Datei ist zu groß (höchstens 10 MB)'),
  data: einvoiceData,
});
export const einvoiceSendInput = z.object({
  to: z.email('Ungültige E-Mail-Adresse'), subject: required(200), body: text(5000), attach: z.enum(['pdf', 'xml', 'both']),
});
export const mailSettingsInput = z.object({
  enabled: z.boolean(), host: text(120), port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535), user: text(160),
  fromName: text(120), /** leer = gespeichertes Passwort behalten */ password: z.string().max(200),
});
export interface MailSettingsDto { enabled: boolean; host: string; port: number; user: string; fromName: string; hasPassword: boolean }

const r2 = (n: number) => Math.round(n);

/**
 * Rechnet Bruttopositionen in die Netto-Darstellung der EN 16931 um. Alle Beträge in Cent.
 * Regeln der Norm: Steuerbasis je Satz = Summe der Positions-Nettobeträge; Steuer = Basis × Satz (gerundet);
 * Gesamt = Basis + Steuer. Weicht das wegen der Brutto-Kalkulation um Cent vom Bruttobetrag der PDF-Rechnung ab,
 * gleicht der „Rundungsbetrag“ (BT-114) den Zahlbetrag an.
 */
export function computeEInvoice(d: Pick<EInvoiceData, 'lines' | 'paidCents'>) {
  const lines = d.lines.map((l, i) => {
    const gross = r2(l.quantity * l.unitGrossCents);
    const net = r2(gross / (1 + l.taxRate / 100));
    return { id: i + 1, name: l.name, quantity: l.quantity, taxRate: l.taxRate, grossCents: gross, netCents: net, netUnit: net / 100 / l.quantity };
  });
  const rates = [...new Set(lines.map((l) => l.taxRate))].sort((a, b) => a - b);
  const taxes = rates.map((rate) => {
    const basis = lines.filter((l) => l.taxRate === rate).reduce((s, l) => s + l.netCents, 0);
    return { rate, basisCents: basis, taxCents: r2(basis * rate / 100) };
  });
  const lineTotal = lines.reduce((s, l) => s + l.netCents, 0);
  const taxTotal = taxes.reduce((s, t) => s + t.taxCents, 0);
  const grandTotal = lineTotal + taxTotal;
  const gross = lines.reduce((s, l) => s + l.grossCents, 0);
  const rounding = gross - grandTotal;
  return { lines, taxes, lineTotalCents: lineTotal, taxTotalCents: taxTotal, grandTotalCents: grandTotal, grossCents: gross, roundingCents: rounding, dueCents: grandTotal - d.paidCents + rounding };
}

export interface EInvoiceRow {
  id: string; source: 'upload' | 'invoice'; invoiceId: string | null; number: string; issueDate: string; buyerName: string; buyerEmail: string; grossCents: number;
  originalName: string; generatedPdf: boolean; createdBy: string; createdAt: string; sentAt: string | null; sentTo: string;
}
