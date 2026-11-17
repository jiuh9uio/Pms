import { sql } from 'drizzle-orm';
import { todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Actor } from './audit.js';
import { addCharge } from './bookings.js';

/** Restaurant: Verzehr eines Hotelgastes auf seine Zimmerrechnung schreiben („aufs Zimmer“). */
export interface InHouseRoom { bookingRoomId: string; bookingId: string; room: string; guest: string; bookingNumber: string; to: string }

/** Zimmer, deren Gäste heute im Haus sind (eingecheckt) */
export async function inHouse(db: Exec): Promise<InHouseRoom[]> {
  const rows = await db.execute(sql`
    select br.id as br_id, b.id as b_id, r.number as room, trim(g.first_name || ' ' || g.last_name) as guest, b.number as bnum, upper(a.period)::text as "to"
    from booking_rooms br join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
      join room_allocations a on a.id = br.allocation_id join rooms r on r.id = a.room_id
    where br.status = 'checked_in' order by r.number`) as unknown as Record<string, string>[];
  return rows.map((x) => ({ bookingRoomId: x.br_id!, bookingId: x.b_id!, room: x.room!, guest: x.guest!, bookingNumber: x.bnum!, to: x.to! }));
}

export async function chargeToRoom(db: Db, actor: Actor, v: { bookingRoomId: string; name: string; amountCents: number; taxRateId: string }) {
  const [r] = await db.execute(sql`select br.booking_id, br.status, rm.number from booking_rooms br join room_allocations a on a.id = br.allocation_id join rooms rm on rm.id = a.room_id where br.id = ${v.bookingRoomId}`) as unknown as { booking_id: string; status: string; number: string }[];
  if (!r) throw notFound('Zimmer');
  // nur für Gäste, die gerade im Haus sind – sonst landet der Betrag womöglich auf einer falschen oder schon abgerechneten Reservierung
  if (r.status !== 'checked_in') throw conflict(`Zimmer ${r.number}: Der Gast ist nicht (mehr) eingecheckt. Bitte direkt im Restaurant kassieren.`);
  const name = `${v.name} (${todayBerlin().split('-').reverse().join('.')})`;
  await addCharge(db, actor, r.booking_id, { bookingRoomId: v.bookingRoomId, name, unitPriceCents: v.amountCents, taxRateId: v.taxRateId, quantity: 1 });
  return { ok: true, room: r.number };
}
