import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GuestDto, GuestDuplicate, GuestInput } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { auditLog, bookingRooms, bookings as bookingsTable, guests, invoices } from '../db/schema.js';
import { conflict, notFound, stale } from '../lib/errors.js';
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

// ---------- Datenschutz ----------

/** Datenauskunft (Art. 15 DSGVO): alle gespeicherten Angaben zum Gast, seine Reservierungen und Rechnungen. */
export async function exportGuest(db: Exec, id: string) {
  const guest = await getGuest(db, id);
  const stays = await db.execute(sql`
    select b.number, lower(a.period)::text as "from", upper(a.period)::text as "to", br.status, r.number as room
    from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id join rooms r on r.id = a.room_id
    where b.guest_id = ${id} order by lower(a.period)`);
  const inv = await db.select({ number: invoices.number, issueDate: invoices.issueDate, grossCents: invoices.grossCents, recipientName: invoices.recipientName, recipientCompany: invoices.recipientCompany })
    .from(invoices).innerJoin(bookingsTable, eq(bookingsTable.id, invoices.bookingId)).where(and(eq(bookingsTable.guestId, id), sql`${invoices.status} <> 'draft'`));
  return { erstellt: new Date().toISOString(), gast: guest, aufenthalte: Array.from(stays), rechnungen: inv };
}

/**
 * Anonymisieren: Personenbezogene Angaben werden entfernt, Reservierungen bleiben als statistische Daten erhalten.
 * Ausgestellte Rechnungen bleiben unverändert – sie unterliegen der gesetzlichen Aufbewahrung.
 * Nicht möglich, solange der Gast eine laufende oder künftige Reservierung hat.
 */
export async function anonymizeGuest(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [g] = await tx.select().from(guests).where(eq(guests.id, id)).for('update');
    if (!g) throw notFound('Gast');
    const [open] = await tx.select({ id: bookingRooms.id }).from(bookingRooms).innerJoin(bookingsTable, eq(bookingsTable.id, bookingRooms.bookingId))
      .where(and(eq(bookingsTable.guestId, id), inArray(bookingRooms.status, ['tentative', 'confirmed', 'checked_in'])));
    if (open) throw conflict('Der Gast hat noch eine offene, laufende oder künftige Reservierung. Bitte erst abschließen oder stornieren.');
    await tx.update(guests).set({
      salutation: '', firstName: '', lastName: 'Anonymisiert', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '',
      birthdate: null, nationality: '', idNumber: '', notes: '', version: g.version + 1, updatedAt: new Date(),
    }).where(eq(guests.id, id));
    // Personenbezogene Inhalte in den Protokolleinträgen dieses Gastes ersetzen (vom Trigger nur so erlaubt)
    await tx.execute(sql`select set_config('pms.audit_scrub', ${id}, true)`);
    await tx.update(auditLog).set({
      before: sql`case when ${auditLog.before} is null then null else '{"anonymisiert": true}'::jsonb end`,
      after: sql`case when ${auditLog.after} is null then null else '{"anonymisiert": true}'::jsonb end`,
    }).where(and(eq(auditLog.entity, 'guest'), eq(auditLog.entityId, id)));
    await tx.execute(sql`select set_config('pms.audit_scrub', '', true)`);
    await record(tx, actor, { action: 'anonymize', entity: 'guest', entityId: id });
  });
}

// ---------- Doppelte Gäste ----------
/** Mögliche Doppelte: gleiche E-Mail-Adresse oder gleicher Vor- und Nachname. Behalten wird vorgeschlagen, wer mehr Reservierungen hat. */
export async function guestDuplicates(db: Exec): Promise<GuestDuplicate[]> {
  const rows = await db.execute(sql`
    select a.id as a_id, b.id as b_id,
      case when a.email <> '' and lower(a.email) = lower(b.email) then 'gleiche E-Mail-Adresse' else 'gleicher Name' end as reason,
      (select count(*) from bookings x where x.guest_id = a.id)::int as a_n, (select count(*) from bookings x where x.guest_id = b.id)::int as b_n
    from guests a join guests b on a.id < b.id and (
      (a.email <> '' and lower(a.email) = lower(b.email))
      or (a.last_name <> '' and lower(trim(a.last_name)) = lower(trim(b.last_name)) and lower(trim(a.first_name)) = lower(trim(b.first_name)) and a.first_name <> ''))
    where a.last_name <> 'Anonymisiert' and b.last_name <> 'Anonymisiert' limit 100`);
  const list = Array.from(rows);
  if (!list.length) return [];
  const ids = [...new Set(list.flatMap((r) => [r.a_id as string, r.b_id as string]))];
  const byId = new Map((await db.select().from(guests).where(inArray(guests.id, ids))).map((g) => [g.id, toGuestDto(g)]));
  return list.map((r) => {
    const aFirst = Number(r.a_n) >= Number(r.b_n);
    const keep = byId.get((aFirst ? r.a_id : r.b_id) as string)!, other = byId.get((aFirst ? r.b_id : r.a_id) as string)!;
    return { keep: { ...keep, stays: Number(aFirst ? r.a_n : r.b_n) }, other: { ...other, stays: Number(aFirst ? r.b_n : r.a_n) }, reason: r.reason as string };
  });
}

/**
 * Zwei Gäste zusammenführen: Alle Reservierungen des zweiten gehen auf den ersten über, leere Felder des ersten werden aus dem
 * zweiten ergänzt, dann wird der zweite gelöscht. Rechnungen bleiben unverändert (sie tragen ihre eigene Empfängerkopie).
 */
export async function mergeGuests(db: Db, actor: Actor, keepId: string, otherId: string) {
  if (keepId === otherId) throw conflict('Ein Gast kann nicht mit sich selbst zusammengeführt werden');
  return db.transaction(async (tx) => {
    const [keep] = await tx.select().from(guests).where(eq(guests.id, keepId)).for('update');
    const [other] = await tx.select().from(guests).where(eq(guests.id, otherId)).for('update');
    if (!keep || !other) throw notFound('Gast');
    const fill: Partial<Row> = {};
    for (const k of ['salutation', 'firstName', 'company', 'email', 'phone', 'street', 'zip', 'city', 'nationality', 'idNumber'] as const) if (!keep[k] && other[k]) fill[k] = other[k];
    if (!keep.birthdate && other.birthdate) fill.birthdate = other.birthdate;
    if (other.notes && other.notes !== keep.notes) fill.notes = [keep.notes, other.notes].filter(Boolean).join('\n').slice(0, 2000);
    const moved = await tx.update(bookingsTable).set({ guestId: keepId }).where(eq(bookingsTable.guestId, otherId)).returning({ id: bookingsTable.id });
    await tx.update(guests).set({ ...fill, version: keep.version + 1, updatedAt: new Date() }).where(eq(guests.id, keepId));
    await tx.delete(guests).where(eq(guests.id, otherId));
    await record(tx, actor, { action: 'merge', entity: 'guest', entityId: keepId, before: { removed: `${other.firstName} ${other.lastName}`.trim(), removedId: otherId }, after: { bookingsMoved: moved.length, filled: Object.keys(fill) } });
    return { ok: true, bookingsMoved: moved.length };
  });
}
