import { sql } from 'drizzle-orm';
import { isActiveStatus } from '../../shared/hotel.js';
import type { Db } from '../db/client.js';
import type { Actor } from './audit.js';
import { bookingBilling } from './billing.js';
import { getBooking, setRoomStatus } from './bookings.js';
import { getCheckinSheet } from './checkinsheet.js';
import { getHotel } from './settings.js';

const SYSTEM: Actor = { userId: null, userName: 'Automatisch (Abreise)', ip: null };
const berlinTime = (d: Date) => d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * Automatischer Check-out: Gäste, deren Abreisetag erreicht ist, werden nach der Check-out-Zeit ausgecheckt –
 * aber nur, wenn die Reservierung vollständig berechnet und bezahlt ist. Offene Beträge bleiben zur Klärung stehen.
 */
export async function autoCheckoutTick(db: Db, now = new Date()): Promise<{ checkedOut: number }> {
  const sheet = await getCheckinSheet(db);
  if (!sheet.autoCheckout) return { checkedOut: 0 };
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const h = await getHotel(db);
  const afterTime = berlinTime(now) >= (h.checkoutTime || '11:00');
  const rows = await db.execute(sql`
    select br.id, br.booking_id, br.version, upper(a.period)::text as "to"
    from booking_rooms br join room_allocations a on a.id = br.allocation_id
    where br.status = 'checked_in' and upper(a.period) <= ${today}::date`) as unknown as { id: string; booking_id: string; version: number; to: string }[];
  let checkedOut = 0;
  const paid = new Map<string, boolean>();
  for (const r of rows) {
    // am Abreisetag erst nach der Check-out-Zeit, bei überfälligen Abreisen sofort
    if (r.to === today && !afterTime) continue;
    if (!paid.has(r.booking_id)) {
      const [b, bill] = await Promise.all([getBooking(db, r.booking_id), bookingBilling(db, r.booking_id)]);
      const total = b.rooms.filter((x) => isActiveStatus(x.status)).reduce((s, x) => s + x.lodgingCents, 0) + b.chargesCents;
      const openInvoices = bill.invoices.filter((i) => i.status === 'issued' && i.kind === 'invoice').reduce((s, i) => s + Math.max(0, i.openCents), 0);
      paid.set(r.booking_id, total - bill.paidCents <= 0 && openInvoices === 0 && bill.uninvoicedCents <= 0 && bill.invoices.some((i) => i.status === 'issued'));
    }
    if (!paid.get(r.booking_id)) continue;
    try { await setRoomStatus(db, SYSTEM, r.id, { status: 'checked_out', version: r.version }); checkedOut++; }
    catch (e) { console.error('Automatischer Check-out:', e instanceof Error ? e.message : e); }
  }
  return { checkedOut };
}

export function startAutoCheckoutScheduler(db: Db) {
  const run = () => void autoCheckoutTick(db).catch((e) => console.error('Automatischer Check-out:', e instanceof Error ? e.message : e));
  setTimeout(run, 30_000).unref();
  setInterval(run, 10 * 60_000).unref();
}
