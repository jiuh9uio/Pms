import { sql } from 'drizzle-orm';
import { cancelTerms, todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { conflict } from '../lib/errors.js';
import type { Actor } from './audit.js';
import { addLine, createInvoice } from './billing.js';
import { getBooking } from './bookings.js';
import { getPolicy } from './guestlink.js';

/**
 * Ausfallgebühr für stornierte bzw. nicht angereiste Zimmer: Vorschlag nach den eingestellten Stornobedingungen
 * und – auf Knopfdruck – ein Rechnungsentwurf mit dieser einen Position. Ausgestellt wird er wie jede Rechnung von Hand.
 */
export interface CancelFeeSuggestion {
  rooms: string[]; lodgingCents: number; cancelledOn: string; noShow: boolean; policyEnabled: boolean;
  freeUntil: string | null; free: boolean; feePercent: number; feeCents: number; existingDraftOrInvoice: string | null;
}
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

export async function suggestion(db: Exec, bookingId: string): Promise<CancelFeeSuggestion> {
  const b = await getBooking(db, bookingId);
  const gone = b.rooms.filter((r) => r.status === 'cancelled' || r.status === 'no_show');
  if (!gone.length) throw conflict('In dieser Reservierung ist kein Zimmer storniert oder als nicht angereist vermerkt.');
  const arrival = gone.map((r) => r.from).sort()[0]!;
  const noShow = gone.some((r) => r.status === 'no_show');
  // Datum der Stornierung aus dem Protokoll (sonst heute); bei Nichtanreise zählt der Anreisetag
  const [last] = await db.execute(sql`select max(at) as at from audit_log where entity = 'booking' and entity_id = ${bookingId} and action = 'status' and after->>'status' = 'cancelled'`) as unknown as { at: string | Date | null }[];
  const cancelledOn = noShow ? arrival : last?.at ? new Date(last.at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) : todayBerlin();
  const lodgingCents = gone.reduce((s, r) => s + (r.nightly ?? []).reduce((x, n) => x + n.priceCents, 0), 0);
  const policy = await getPolicy(db);
  const t = cancelTerms(policy, arrival, lodgingCents, cancelledOn);
  // Nichtanreise: laut Bedingungen immer gebührenpflichtig
  const terms = noShow && policy.enabled ? { ...t, free: false, feeCents: Math.round((lodgingCents * policy.feePercent) / 100) } : t;
  const [dup] = await db.execute(sql`select i.number, i.status from invoices i join invoice_lines l on l.invoice_id = i.id
    where i.booking_id = ${bookingId} and i.status <> 'cancelled' and l.description like 'Ausfallgebühr%' limit 1`) as unknown as { number: string | null; status: string }[];
  return { rooms: gone.map((r) => r.roomNumber), lodgingCents, cancelledOn, noShow, policyEnabled: policy.enabled, freeUntil: terms.freeUntil, free: terms.free,
    feePercent: terms.feePercent, feeCents: terms.feeCents, existingDraftOrInvoice: dup ? (dup.number ?? 'Entwurf') : null };
}

export async function createDraft(db: Db, actor: Actor, bookingId: string, v: { amountCents: number; taxRatePercent: number; text: string }) {
  const s = await suggestion(db, bookingId);
  if (s.existingDraftOrInvoice) throw conflict(`Für diese Reservierung gibt es schon eine Ausfallgebühr (${s.existingDraftOrInvoice}).`, 'fee_exists');
  const { id } = await createInvoice(db, actor, { bookingId, include: 'none' });
  const detail = [`Zimmer ${s.rooms.join(', ')}`, s.noShow ? `Nichtanreise am ${de(s.cancelledOn)}` : `storniert am ${de(s.cancelledOn)}`, v.text].filter(Boolean).join(' · ');
  await addLine(db, actor, id, { description: 'Ausfallgebühr', detail: detail.slice(0, 200), quantity: 1, unitPriceCents: v.amountCents, taxRatePercent: v.taxRatePercent });
  return { invoiceId: id };
}
