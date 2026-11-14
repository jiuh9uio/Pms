import { sql } from 'drizzle-orm';
import { addDays, type ForecastDto, type OriginStats, type SourceStats } from '../../shared/hotel.js';
import type { Exec } from '../db/client.js';

const ACTIVE = sql`('confirmed', 'checked_in', 'checked_out')`;

/**
 * Belegungsvorschau: je Tag belegte, vorläufig belegte, gesperrte und freie Zimmer, An- und Abreisen sowie freie Zimmer je Kategorie.
 * „Belegt“ meint die Nacht, die an dem Tag beginnt.
 */
export async function forecast(db: Exec, from: string, days: number): Promise<ForecastDto> {
  const to = addDays(from, days);
  const rooms = Array.from(await db.execute(sql`select r.id, r.category_id from rooms r where r.active`)) as { id: string; category_id: string }[];
  const cats = Array.from(await db.execute(sql`select c.id, c.name, (select count(*) from rooms r where r.category_id = c.id and r.active)::int as rooms from room_categories c order by c.sort, c.name`)) as { id: string; name: string; rooms: number }[];
  const used = cats.filter((c) => c.rooms > 0);
  const allocs = Array.from(await db.execute(sql`
    select a.room_id, a.kind, lower(a.period)::text as "from", upper(a.period)::text as "to", br.status
    from room_allocations a left join booking_rooms br on br.allocation_id = a.id join rooms r on r.id = a.room_id and r.active
    where a.active and a.period && daterange(${from}::date, ${to}::date) and (a.kind = 'block' or br.status in ('tentative', 'confirmed', 'checked_in', 'checked_out'))`)) as { room_id: string; kind: string; from: string; to: string; status: string | null }[];
  const catOf = new Map(rooms.map((r) => [r.id, r.category_id]));
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const night = allocs.filter((a) => a.from <= date && a.to > date);
    const busy = new Set(night.map((a) => a.room_id));
    const blocked = night.filter((a) => a.kind === 'block').length, tentative = night.filter((a) => a.status === 'tentative').length;
    const occupied = night.length - blocked - tentative;
    out.push({
      date, occupied, tentative, blocked, free: rooms.length - busy.size,
      arrivals: allocs.filter((a) => a.kind === 'stay' && a.from === date).length, departures: allocs.filter((a) => a.kind === 'stay' && a.to === date).length,
      occupancyPercent: rooms.length ? Math.round(((occupied + tentative) / rooms.length) * 100) : 0,
      freeByCategory: used.map((c) => rooms.filter((r) => r.category_id === c.id && !busy.has(r.id)).length),
    });
  }
  void catOf;
  return { from, rooms: rooms.length, categories: used.map((c) => ({ id: c.id, name: c.name, rooms: c.rooms })), days: out };
}

/**
 * Ankünfte und Übernachtungen eines Monats nach Herkunftsland – die Angaben, die die amtliche Beherbergungsstatistik abfragt.
 * Gezählt werden Personen (Erwachsene und Kinder); das Land ist das des Hauptgastes der Reservierung (Feld „Land“ der Anschrift).
 * Eine Ankunft zählt in dem Monat, in dem die erste Nacht liegt.
 */
export async function originStats(db: Exec, year: number, month: number): Promise<OriginStats> {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const rows = await db.execute(sql`
    select coalesce(nullif(trim(g.country), ''), 'ohne Angabe') as country,
      coalesce(sum(br.adults + br.children) filter (where lower(a.period) >= ${from}::date and lower(a.period) < ${to}::date), 0)::int as arrivals,
      coalesce(sum((br.adults + br.children) * (select count(*) from booking_room_nights n where n.booking_room_id = br.id and n.date >= ${from}::date and n.date < ${to}::date)), 0)::int as nights
    from booking_rooms br join room_allocations a on a.id = br.allocation_id join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
    where br.status in ${ACTIVE} and a.period && daterange(${from}::date, ${to}::date)
    group by 1 order by 3 desc, 1`);
  const list = Array.from(rows).map((r) => ({ country: r.country as string, arrivals: Number(r.arrivals), nights: Number(r.nights) })).filter((r) => r.arrivals || r.nights);
  const [b] = await db.execute(sql`select coalesce(sum(c.max_persons), 0)::int as beds from rooms r join room_categories c on c.id = r.category_id where r.active`);
  const openDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const total = { arrivals: list.reduce((s, r) => s + r.arrivals, 0), nights: list.reduce((s, r) => s + r.nights, 0) };
  const beds = Number(b!.beds);
  return { year, month, rows: list, total, beds, openDays, bedOccupancyPercent: beds ? Math.round((total.nights / (beds * openDays)) * 1000) / 10 : 0 };
}

/** Buchungen, Nächte und Logisumsatz eines Jahres je Buchungsquelle (nach dem Tag der Übernachtung). */
export async function sourceStats(db: Exec, year: number): Promise<SourceStats> {
  const from = `${year}-01-01`, to = `${year + 1}-01-01`;
  const rows = await db.execute(sql`
    select coalesce(nullif(trim(b.source), ''), 'ohne Angabe') as source, count(distinct b.id)::int as bookings, count(n.date)::int as nights, coalesce(sum(n.price_cents), 0)::int as cents
    from booking_room_nights n join booking_rooms br on br.id = n.booking_room_id join bookings b on b.id = br.booking_id
    where br.status in ${ACTIVE} and n.date >= ${from}::date and n.date < ${to}::date group by 1 order by 4 desc, 1`);
  return { year, rows: Array.from(rows).map((r) => ({ source: r.source as string, bookings: Number(r.bookings), nights: Number(r.nights), lodgingCents: Number(r.cents) })) };
}
