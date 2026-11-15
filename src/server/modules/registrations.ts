import { sql } from 'drizzle-orm';
import { todayBerlin, type RegistrationRow } from '../../shared/hotel.js';
import type { Exec } from '../db/client.js';

/** Jahr dazuzählen (29.02. → 28.02.) */
const addYears = (d: string, n: number) => { const y = Number(d.slice(0, 4)) + n; const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5); return `${y}-${md}`; };
const addMonths = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00Z`); const day = dt.getUTCDate();
  dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return dt.toISOString().slice(0, 10);
};

/**
 * Meldeschein-Archiv: je Reservierung mit Check-in eine Zeile. Die Angaben kommen aus Reservierung und Gästeprofil
 * (so, wie der Meldeschein gedruckt wird) – es wird keine eigene Kopie gespeichert.
 * Frist: § 30 Abs. 4 BMG – ein Jahr ab Anreise aufbewahren, danach innerhalb von drei Monaten vernichten.
 */
export async function listRegistrations(db: Exec, f: { from?: string; to?: string; q: string; expired: '0' | '1' }): Promise<RegistrationRow[]> {
  const today = todayBerlin();
  const q = f.q ? `%${f.q}%` : null;
  const rows = await db.execute(sql`
    select b.id, b.number, g.first_name, g.last_name, g.birthdate::text as birthdate, g.nationality, g.street, g.zip, g.city, g.country,
      min(lower(a.period))::text as "from", max(upper(a.period))::text as "to", min(br.checked_in_at) as checked_in_at,
      string_agg(distinct r.number, ', ' order by r.number) as rooms, sum(br.adults + br.children)::int as persons,
      max(gf.submitted_at) as online_at
    from booking_rooms br
    join bookings b on b.id = br.booking_id
    join guests g on g.id = b.guest_id
    join room_allocations a on a.id = br.allocation_id
    join rooms r on r.id = a.room_id
    left join guest_forms gf on gf.booking_id = b.id
    where br.checked_in_at is not null and br.status in ('checked_in', 'checked_out')
      ${q ? sql`and (g.last_name ilike ${q} or g.first_name ilike ${q} or b.number ilike ${q} or g.city ilike ${q} or r.number ilike ${q})` : sql``}
    group by b.id, g.id
    having true
      ${f.from ? sql`and min(lower(a.period)) >= ${f.from}::date` : sql``}
      ${f.to ? sql`and min(lower(a.period)) <= ${f.to}::date` : sql``}
      ${f.expired === '1' ? sql`and min(lower(a.period)) < (${today}::date - interval '1 year')` : sql``}
    order by min(lower(a.period)) desc, b.number desc
    limit 500`) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const from = String(r.from);
    const missing = [
      ...(!(r.street && r.zip && r.city) ? ['Anschrift'] : []), ...(!r.birthdate ? ['Geburtsdatum'] : []), ...(!r.nationality ? ['Staatsangehörigkeit'] : []),
    ];
    const keepUntil = addYears(from, 1);
    return {
      bookingId: String(r.id), number: String(r.number), guest: [r.first_name, r.last_name].filter(Boolean).join(' '),
      birthdate: (r.birthdate as string | null) ?? null, nationality: String(r.nationality ?? ''), city: String(r.city ?? ''), country: String(r.country ?? ''),
      rooms: String(r.rooms ?? ''), from, to: String(r.to), checkedInAt: new Date(r.checked_in_at as string).toISOString(), persons: Number(r.persons ?? 0),
      onlineAt: r.online_at ? new Date(r.online_at as string).toISOString() : null, missing,
      keepUntil, destroyBy: addMonths(keepUntil, 3),
    };
  });
}
