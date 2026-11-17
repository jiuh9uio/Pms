import { taxBreakdown, type InvoiceDto, type IssuerDto } from '../../shared/billing.js';

/** Muster-Rechnung mit erfundenen Angaben für die Vorschau des Rechnungslayouts (keine echten Gastdaten). */
/** unpaid: offen (z. B. um den Zahlungs-QR-Code in der Vorschau zu zeigen) */
export function sampleInvoice(issuer: IssuerDto, today: string, unpaid = false): InvoiceDto {
  const mk = (pos: number, description: string, detail: string, quantity: number, unitPriceCents: number, taxRatePercent: number) =>
    ({ id: String(pos), pos, description, detail, quantity, unitPriceCents, taxRatePercent, totalCents: Math.round(quantity * unitPriceCents) });
  const lines = [
    mk(1, 'Übernachtung Doppelzimmer Komfort', 'Zimmer 12 · 3 Nächte · 2 Personen', 3, 9800, 7),
    mk(2, 'Frühstück', '3 Tage · 2 Personen', 6, 1250, 19),
    mk(3, 'Parkplatz', '', 3, 500, 19),
  ];
  const gross = lines.reduce((s, l) => s + l.totalCents, 0);
  return {
    id: 'muster', number: 'MUSTER-0001', kind: 'invoice', status: 'issued', bookingId: null, bookingNumber: 'B-MUSTER', cancelsId: null, cancelsNumber: null, cancelledById: null, cancelledByNumber: null,
    recipientCompany: '', recipientName: 'Erika Mustermann', recipientStreet: 'Musterstraße 1', recipientZip: '12345', recipientCity: 'Musterstadt', recipientCountry: 'Deutschland', recipientVatId: '',
    issueDate: today, dueDate: today, serviceFrom: today, serviceTo: today, notes: '', grossCents: gross, paidCents: unpaid ? 0 : gross, openCents: unpaid ? gross : 0,
    issuer, lines, taxes: taxBreakdown(lines),
    payments: unpaid ? [] : [{ id: 'p', bookingId: null, invoiceId: 'muster', invoiceNumber: 'MUSTER-0001', amountCents: gross, method: 'Karte', date: today, payer: '', note: '', reversesId: null, reversed: false, recordedBy: '', createdAt: today, tse: null }],
  } as unknown as InvoiceDto;
}
