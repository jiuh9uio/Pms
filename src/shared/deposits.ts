import { z } from 'zod';

/**
 * Anzahlung anfordern – für Hotelreservierungen und Tischreservierungen (z. B. Gruppen, Feiern).
 * Hotel: „bezahlt“ ergibt sich aus den gebuchten Zahlungen der Reservierung.
 * Restaurant: das Programm kassiert hier nicht – der Eingang wird von Hand vermerkt (die Buchung in der Kasse erfolgt dort).
 */
export type DepositKind = 'booking' | 'table' | 'offer';
export type DepositState = 'open' | 'overdue' | 'paid' | 'cancelled';
export interface DepositDto {
  id: string; kind: DepositKind; refId: string; amountCents: number; dueDate: string;
  createdAt: string; createdBy: string; to: string; mailed: boolean;
  state: DepositState;
  /** nur Restaurant: von Hand vermerkter Eingang */
  paidAt: string | null; paidBy: string; paidNote: string;
  cancelledBy: string;
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen');
export const depositDraftQuery = z.object({ amountCents: z.coerce.number().int().min(100, 'Mindestens 1,00 €').max(10_000_000), dueDate: isoDate });
export const depositCreateInput = z.object({
  amountCents: z.number('Bitte einen Betrag eintragen').int().min(100, 'Mindestens 1,00 €').max(10_000_000),
  dueDate: isoDate,
  /** true = E-Mail an den Gast senden; false = nur vermerken (z. B. am Telefon besprochen) */
  send: z.boolean(),
  to: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]).default(''),
  subject: z.string().trim().max(200).default(''),
  text: z.string().trim().max(8000).default(''),
}).refine((v) => !v.send || (v.to && v.subject && v.text), { message: 'Für den Versand bitte E-Mail-Adresse, Betreff und Text angeben', path: ['to'] });
export type DepositCreateInput = z.infer<typeof depositCreateInput>;
export const depositPaidInput = z.object({ note: z.string().trim().max(300).default('') });
export const DEPOSIT_STATE_LABEL: Record<DepositState, string> = { open: 'offen', overdue: 'überfällig', paid: 'eingegangen', cancelled: 'zurückgezogen' };
