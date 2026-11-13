import { sql } from 'drizzle-orm';
import type { YearReport } from '../../shared/hotel.js';
import type { Exec } from '../db/client.js';

/**
 * Jahresauswertung je Monat: verkaufte Zimmernächte, Auslastung, gebuchter Logisumsatz und Rechnungssumme.
 * Die Auslastung bezieht sich auf die heute aktiven Zimmer; frühere Zimmerzahlen und Sperren werden nicht berücksichtigt.
 */
export async function yearReport(db: Exec, year: number): Promise<YearReport> {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const [[rooms], nights, inv] = await Promise.all([
    db.execute(sql`select count(*)::int as n from rooms where active`),
    db.execute(sql`
      select extract(month from n.date)::int as m, count(*)::int as nights, coalesce(sum(n.price_cents), 0)::int as cents
      from booking_room_nights n join booking_rooms br on br.id = n.booking_room_id
      where br.status in ('confirmed', 'checked_in', 'checked_out') and n.date >= ${from}::date and n.date < ${to}::date group by 1`),
    db.execute(sql`
      select extract(month from issue_date)::int as m, coalesce(sum(gross_cents), 0)::int as cents, count(*) filter (where kind = 'invoice')::int as count
      from invoices where number is not null and issue_date >= ${from}::date and issue_date < ${to}::date group by 1`),
  ]);
  const roomCount = (rooms as { n: number }).n;
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const n = Array.from(nights).find((r) => r.m === m) as { nights: number; cents: number } | undefined;
    const v = Array.from(inv).find((r) => r.m === m) as { cents: number; count: number } | undefined;
    const available = roomCount * days;
    return {
      month: m, nights: n?.nights ?? 0, available, occupancyPercent: available ? Math.round(((n?.nights ?? 0) / available) * 1000) / 10 : 0,
      lodgingCents: n?.cents ?? 0, invoicedCents: v?.cents ?? 0, invoices: v?.count ?? 0,
    };
  });
  const sum = (k: 'nights' | 'available' | 'lodgingCents' | 'invoicedCents' | 'invoices') => months.reduce((s, x) => s + x[k], 0);
  const total = { nights: sum('nights'), available: sum('available'), lodgingCents: sum('lodgingCents'), invoicedCents: sum('invoicedCents'), invoices: sum('invoices') };
  return { year, rooms: roomCount, months, total: { ...total, occupancyPercent: total.available ? Math.round((total.nights / total.available) * 1000) / 10 : 0 } };
}
