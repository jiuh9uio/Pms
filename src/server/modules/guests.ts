import { eq, sql } from 'drizzle-orm';
import type { GuestDto, GuestInput } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { guests } from '../db/schema.js';
import { notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

type Row = typeof guests.$inferSelect;
export const toGuestDto = (g: Row): GuestDto => ({
  id: g.id, salutation: g.salutation as GuestDto['salutation'], firstName: g.firstName, lastName: g.lastName, company: g.company, email: g.email,
  phone: g.phone, street: g.street, zip: g.zip, city: g.city, country: g.country, birthdate: g.birthdate, nationality: g.nationality,
  idNumber: g.idNumber, notes: g.notes, version: g.version,
});

export async function listGuests(db: Exec, q: string): Promise<GuestDto[]> {
  const like = '%' + q.replace(/[%_\\]/g, '') + '%';
  const rows = await db.execute(sql`
    select g.*,
      (select count(*) from bookings b join booking_rooms br on br.booking_id = b.id where b.guest_id = g.id and br.status in ('checked_in','checked_out'))::int as stays,
      (select max(upper(a.period))::text from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
        where b.guest_id = g.id and br.status in ('checked_in','checked_out')) as last_stay
    from guests g
    where ${q === '' ? sql`true` : sql`(g.first_name || ' ' || g.last_name ilike ${like} or g.last_name || ' ' || g.first_name ilike ${like}
      or g.company ilike ${like} or g.email ilike ${like} or g.phone ilike ${like} or g.city ilike ${like})`}
    order by lower(g.last_name), lower(g.first_name) limit 300`);
  return Array.from(rows).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      id: x.id, salutation: x.salutation, firstName: x.first_name, lastName: x.last_name, company: x.company, email: x.email, phone: x.phone,
      street: x.street, zip: x.zip, city: x.city, country: x.country, birthdate: x.birthdate ? String(x.birthdate).slice(0, 10) : null,
      nationality: x.nationality, idNumber: x.id_number, notes: x.notes, version: x.version, stays: x.stays, lastStay: x.last_stay,
    } as GuestDto;
  });
}

export async function getGuest(db: Exec, id: string) {
  const [g] = await db.select().from(guests).where(eq(guests.id, id));
  if (!g) throw notFound('Gast');
  return toGuestDto(g);
}

export async function createGuest(db: Exec, actor: Actor, v: GuestInput) {
  const [g] = await db.insert(guests).values(v).returning();
  await record(db, actor, { action: 'create', entity: 'guest', entityId: g!.id, after: toGuestDto(g!) });
  return toGuestDto(g!);
}

export async function updateGuest(db: Db, actor: Actor, id: string, v: GuestInput, version: number) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(guests).where(eq(guests.id, id)).for('update');
    if (!before) throw notFound('Gast');
    if (before.version !== version) throw stale();
    const [g] = await tx.update(guests).set({ ...v, version: before.version + 1, updatedAt: new Date() }).where(eq(guests.id, id)).returning();
    await record(tx, actor, { action: 'update', entity: 'guest', entityId: id, before: toGuestDto(before), after: toGuestDto(g!) });
    return toGuestDto(g!);
  });
}
