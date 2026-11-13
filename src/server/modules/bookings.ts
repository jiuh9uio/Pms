import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  TRANSITIONS, addDays, diffDays, eachNight, isActiveStatus, perFactor, todayBerlin,
  type BookingDto, type BookingListRow, type BookingRoomDto, type CalendarDto, type CalendarEntry, type ChargeDto, type DashboardDto,
  type GuestInput, type RoomStatus, type TaskDto,
} from '../../shared/hotel.js';
import type { Db, Exec, Tx } from '../db/client.js';
import { bookingRoomNights, bookingRooms, bookings, charges, companies, companyRates, guests, numberSequences, roomAllocations, rooms, services, taxRates } from '../db/schema.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { createGuest, toGuestDto } from './guests.js';
import { listRooms, lodgingTaxPercent, period, priceNights } from './rooms.js';

type Raw = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

// ---------- Lesen ----------
const ROOM_SELECT = sql`
  select br.id, br.booking_id, a.id as allocation_id, a.room_id, r.number as room_number, c.name as category_name,
    lower(a.period)::text as "from", upper(a.period)::text as "to", br.status, br.adults, br.children, br.price_manual, br.version,
    br.checked_in_at, br.checked_out_at,
    coalesce((select sum(n.price_cents) from booking_room_nights n where n.booking_room_id = br.id), 0)::int as lodging_cents,
    b.number, b.guest_id, b.group_name, b.source, trim(g.first_name || ' ' || g.last_name) as guest_name,
    (select count(*) from booking_rooms x where x.booking_id = b.id)::int as room_count
  from booking_rooms br
    join room_allocations a on a.id = br.allocation_id
    join rooms r on r.id = a.room_id
    join room_categories c on c.id = br.category_id
    join bookings b on b.id = br.booking_id
    join guests g on g.id = b.guest_id`;

const toRow = (x: Raw): BookingListRow => ({
  id: x.id as string, bookingId: x.booking_id as string, allocationId: x.allocation_id as string, roomId: x.room_id as string, roomNumber: x.room_number as string,
  categoryName: x.category_name as string, from: x.from as string, to: x.to as string, nights: diffDays(x.from as string, x.to as string),
  status: x.status as RoomStatus, adults: x.adults as number, children: x.children as number, priceManual: x.price_manual as boolean,
  lodgingCents: x.lodging_cents as number, version: x.version as number, checkedInAt: iso(x.checked_in_at), checkedOutAt: iso(x.checked_out_at),
  number: x.number as string, guestId: x.guest_id as string, guestName: x.guest_name as string, groupName: x.group_name as string,
  source: x.source as string, roomCount: x.room_count as number,
});

export async function selectRooms(db: Exec, where: SQL, order: SQL = sql`lower(a.period), r.number`, limit = 500) {
  const rows = await db.execute(sql`${ROOM_SELECT} where ${where} order by ${order} limit ${limit}`);
  return Array.from(rows).map((r) => toRow(r as Raw));
}

export async function listBookings(db: Exec, f: { q?: string; status?: string; from?: string; to?: string }) {
  const conds: SQL[] = [sql`true`];
  if (f.q) {
    const like = '%' + f.q.replace(/[%_\\]/g, '') + '%';
    conds.push(sql`(g.first_name || ' ' || g.last_name ilike ${like} or g.company ilike ${like} or b.number ilike ${like} or b.group_name ilike ${like} or r.number ilike ${like})`);
  }
  if (f.status === 'active') conds.push(sql`br.status not in ('cancelled','no_show')`);
  else if (f.status) conds.push(sql`br.status = ${f.status}`);
  if (f.from) conds.push(sql`upper(a.period) >= ${f.from}::date`);
  if (f.to) conds.push(sql`lower(a.period) <= ${f.to}::date`);
  return selectRooms(db, sql.join(conds, sql` and `));
}

export async function getBooking(db: Exec, id: string): Promise<BookingDto> {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, id));
  if (!b) throw notFound('Reservierung');
  const [g] = await db.select().from(guests).where(eq(guests.id, b.guestId));
  const [company] = b.companyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, b.companyId)) : [];
  const roomRows = await selectRooms(db, sql`br.booking_id = ${id}`);
  const nights = await db.select().from(bookingRoomNights)
    .where(sql`${bookingRoomNights.bookingRoomId} in (select id from booking_rooms where booking_id = ${id})`).orderBy(bookingRoomNights.date);
  const roomDtos: BookingRoomDto[] = roomRows.map((r) => ({
    ...r, nightly: nights.filter((n) => n.bookingRoomId === r.id).map((n) => ({ date: n.date, priceCents: n.priceCents, taxRatePercent: n.taxRatePercent, source: n.source })),
  }));
  const chargeRows = await db.select().from(charges).where(eq(charges.bookingId, id)).orderBy(charges.createdAt);
  const chargeDtos: ChargeDto[] = chargeRows.map((c) => ({
    id: c.id, bookingRoomId: c.bookingRoomId, name: c.name, quantity: c.quantity, unitPriceCents: c.unitPriceCents, taxRatePercent: c.taxRatePercent,
    totalCents: Math.round(c.quantity * c.unitPriceCents),
  }));
  const lodgingCents = roomDtos.filter((r) => isActiveStatus(r.status)).reduce((s, r) => s + r.lodgingCents, 0);
  const chargesCents = chargeDtos.reduce((s, c) => s + c.totalCents, 0);
  return {
    id: b.id, number: b.number, groupName: b.groupName, source: b.source, paymentMethod: b.paymentMethod, notes: b.notes, version: b.version,
    createdAt: b.createdAt.toISOString(), companyId: b.companyId, companyName: company?.name ?? null, guest: toGuestDto(g!), rooms: roomDtos, charges: chargeDtos,
    lodgingCents, chargesCents, totalCents: lodgingCents + chargesCents,
  };
}

export async function guestBookings(db: Exec, guestId: string) {
  return selectRooms(db, sql`b.guest_id = ${guestId}`, sql`lower(a.period) desc`, 200);
}

export async function calendar(db: Exec, from: string, days: number): Promise<CalendarDto> {
  const to = addDays(from, days);
  const rows = await db.execute(sql`
    select a.id as allocation_id, a.room_id, lower(a.period)::text as "from", upper(a.period)::text as "to", a.kind, a.version as a_version,
      br.id as booking_room_id, br.booking_id, br.status, br.version as br_version, b.number, trim(g.first_name || ' ' || g.last_name) as guest_name,
      bl.id as block_id, bl.reason
    from room_allocations a
      left join booking_rooms br on br.allocation_id = a.id
      left join bookings b on b.id = br.booking_id
      left join guests g on g.id = b.guest_id
      left join room_blocks bl on bl.allocation_id = a.id
    where a.active and a.period && ${period(from, to)}::daterange
    order by lower(a.period)`);
  const entries: CalendarEntry[] = Array.from(rows).map((r) => {
    const x = r as Raw;
    return x.kind === 'block'
      ? { allocationId: x.allocation_id as string, roomId: x.room_id as string, from: x.from as string, to: x.to as string, kind: 'block', version: x.a_version as number, blockId: x.block_id as string, reason: x.reason as string }
      : {
          allocationId: x.allocation_id as string, roomId: x.room_id as string, from: x.from as string, to: x.to as string, kind: 'stay', version: x.br_version as number,
          bookingRoomId: x.booking_room_id as string, bookingId: x.booking_id as string, status: x.status as RoomStatus, guestName: x.guest_name as string, number: x.number as string,
        };
  });
  return { from, days, rooms: await listRooms(db, true), entries };
}

// ---------- Schreiben ----------
async function nextNumber(tx: Tx, key: string, prefix: string) {
  const year = Number(todayBerlin().slice(0, 4));
  const [row] = await tx.insert(numberSequences).values({ key, year, last: 1 })
    .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
  return `${prefix}${String(year).slice(2)}-${String(row!.last).padStart(5, '0')}`;
}

/**
 * Preise je Nacht: Bei Firmenbuchungen gilt der mit der Firma vereinbarte Preis der Zimmerkategorie,
 * sonst Zimmer-/Kategoriepreis mit Preisregeln.
 */
export async function nightsFor(tx: Exec, companyId: string | null, roomId: string, categoryId: string, from: string, to: string) {
  if (companyId) {
    const [rate] = await tx.select({ price: companyRates.priceCents, name: companies.name }).from(companyRates)
      .innerJoin(companies, eq(companies.id, companyRates.companyId))
      .where(and(eq(companyRates.companyId, companyId), eq(companyRates.categoryId, categoryId)));
    if (rate) return eachNight(from, to).map((date) => ({ date, priceCents: rate.price, source: `Firmenpreis ${rate.name}` }));
  }
  return priceNights(tx, roomId, categoryId, from, to);
}

interface RoomIn { roomId: string; from: string; to: string; adults: number; children: number; status: 'tentative' | 'confirmed'; pricePerNightCents: number | null }

async function insertRoom(tx: Tx, bookingId: string, r: RoomIn, companyId: string | null) {
  const [room] = await tx.select().from(rooms).where(eq(rooms.id, r.roomId));
  if (!room) throw notFound('Zimmer');
  if (!room.active) throw conflict(`Zimmer ${room.number} ist nicht buchbar`);
  const tax = await lodgingTaxPercent(tx);
  // Der Ausschluss-Constraint der Datenbank lehnt überschneidende Belegungen ab (Fehler 23P01).
  const [a] = await tx.insert(roomAllocations).values({ roomId: r.roomId, period: period(r.from, r.to), kind: 'stay' }).returning();
  const manual = r.pricePerNightCents !== null;
  const [br] = await tx.insert(bookingRooms).values({
    bookingId, allocationId: a!.id, categoryId: room.categoryId, status: r.status, adults: r.adults, children: r.children, priceManual: manual,
  }).returning();
  const nightly = manual
    ? eachNight(r.from, r.to).map((date) => ({ date, priceCents: r.pricePerNightCents!, source: 'manuell' }))
    : await nightsFor(tx, companyId, r.roomId, room.categoryId, r.from, r.to);
  await tx.insert(bookingRoomNights).values(nightly.map((n) => ({ bookingRoomId: br!.id, date: n.date, priceCents: n.priceCents, taxRatePercent: tax, source: n.source })));
  return { br: br!, room, lodgingCents: nightly.reduce((s, n) => s + n.priceCents, 0) };
}

async function addServiceCharge(tx: Tx, bookingId: string, bookingRoomId: string | null, serviceId: string, nights: number, persons: number, quantity?: number) {
  const [s] = await tx.select({ s: services, rate: taxRates.ratePercent }).from(services).innerJoin(taxRates, eq(taxRates.id, services.taxRateId)).where(eq(services.id, serviceId));
  if (!s) throw notFound('Leistung');
  const qty = quantity ?? perFactor(s.s.per, nights, persons);
  const [c] = await tx.insert(charges).values({ bookingId, bookingRoomId, serviceId, name: s.s.name, quantity: qty, unitPriceCents: s.s.priceCents, taxRatePercent: s.rate }).returning();
  return c!;
}

export async function createBooking(db: Db, actor: Actor, input: {
  guestId?: string; guest?: GuestInput; companyId?: string; groupName: string; source: string; paymentMethod: string; notes: string; rooms: RoomIn[]; breakfast: boolean;
}) {
  return db.transaction(async (tx) => {
    let guestId = input.guestId;
    if (guestId) {
      const [g] = await tx.select({ id: guests.id }).from(guests).where(eq(guests.id, guestId));
      if (!g) throw notFound('Gast');
    } else guestId = (await createGuest(tx, actor, input.guest!)).id;

    const number = await nextNumber(tx, 'booking', 'B');
    if (input.companyId && !(await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, input.companyId))).length) throw notFound('Firma');
    const [b] = await tx.insert(bookings).values({ number, guestId, companyId: input.companyId ?? null, groupName: input.groupName, source: input.source, paymentMethod: input.paymentMethod, notes: input.notes }).returning();
    const summary: unknown[] = [];
    const [breakfast] = input.breakfast ? await tx.select().from(services).where(and(eq(services.isBreakfast, true), eq(services.active, true))).limit(1) : [];
    if (input.breakfast && !breakfast) throw conflict('Es ist keine aktive Frühstücksleistung angelegt (Zimmer & Preise → Leistungen)');
    for (const r of input.rooms) {
      const { br, room, lodgingCents } = await insertRoom(tx, b!.id, r, input.companyId ?? null);
      if (breakfast) await addServiceCharge(tx, b!.id, br.id, breakfast.id, diffDays(r.from, r.to), r.adults + r.children);
      summary.push({ room: room.number, from: r.from, to: r.to, status: r.status, adults: r.adults, children: r.children, lodgingCents });
    }
    await record(tx, actor, { action: 'create', entity: 'booking', entityId: b!.id, after: { number, source: input.source, breakfast: input.breakfast, rooms: summary } });
    return { id: b!.id, number };
  });
}

export async function updateBooking(db: Db, actor: Actor, id: string, v: { guestId?: string; companyId?: string | null; groupName?: string; source?: string; paymentMethod?: string; notes?: string; version: number }) {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
    if (!before) throw notFound('Reservierung');
    if (before.version !== v.version) throw stale();
    if (v.guestId && !(await tx.select({ id: guests.id }).from(guests).where(eq(guests.id, v.guestId))).length) throw notFound('Gast');
    if (v.companyId && !(await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, v.companyId))).length) throw notFound('Firma');
    const set = { guestId: v.guestId ?? before.guestId, companyId: v.companyId === undefined ? before.companyId : v.companyId, groupName: v.groupName ?? before.groupName, source: v.source ?? before.source, paymentMethod: v.paymentMethod ?? before.paymentMethod, notes: v.notes ?? before.notes };
    await tx.update(bookings).set({ ...set, version: before.version + 1, updatedAt: new Date() }).where(eq(bookings.id, id));
    await record(tx, actor, {
      action: 'update', entity: 'booking', entityId: id,
      before: { guestId: before.guestId, companyId: before.companyId, groupName: before.groupName, source: before.source, paymentMethod: before.paymentMethod, notes: before.notes }, after: set,
    });
  });
}

export async function addRoom(db: Db, actor: Actor, bookingId: string, r: RoomIn) {
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
    if (!b) throw notFound('Reservierung');
    const { room, lodgingCents } = await insertRoom(tx, bookingId, r, b.companyId);
    await record(tx, actor, { action: 'room_add', entity: 'booking', entityId: bookingId, after: { room: room.number, from: r.from, to: r.to, status: r.status, lodgingCents } });
  });
}

const companyOf = async (tx: Exec, bookingId: string) =>
  (await tx.select({ c: bookings.companyId }).from(bookings).where(eq(bookings.id, bookingId)))[0]?.c ?? null;

async function lockRoom(tx: Tx, id: string) {
  const [br] = await tx.select().from(bookingRooms).where(eq(bookingRooms.id, id)).for('update');
  if (!br) throw notFound('Zimmerbuchung');
  const [a] = await tx.execute(sql`select room_id, lower(period)::text as "from", upper(period)::text as "to" from room_allocations where id = ${br.allocationId} for update`);
  const x = a as Raw;
  return { br, alloc: { roomId: x.room_id as string, from: x.from as string, to: x.to as string } };
}

/** Zimmer wechseln, Zeitraum ändern (auch per Drag-and-drop), Personen oder Preis anpassen. */
export async function updateBookingRoom(db: Db, actor: Actor, id: string, v: {
  roomId?: string; from?: string; to?: string; adults?: number; children?: number; pricePerNightCents?: number | null; version: number;
}) {
  return db.transaction(async (tx) => {
    const { br, alloc } = await lockRoom(tx, id);
    if (br.version !== v.version) throw stale();
    if (!['tentative', 'confirmed', 'checked_in'].includes(br.status)) throw conflict('Diese Zimmerbuchung ist abgeschlossen und kann nicht mehr geändert werden');
    const next = { roomId: v.roomId ?? alloc.roomId, from: v.from ?? alloc.from, to: v.to ?? alloc.to };
    if (next.from >= next.to || diffDays(next.from, next.to) > 365) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { to: 'Abreise muss nach der Anreise liegen' });
    if (br.status === 'checked_in' && next.from !== alloc.from) throw conflict('Der Gast ist bereits eingecheckt – das Anreisedatum kann nicht mehr geändert werden');
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, next.roomId));
    if (!room) throw notFound('Zimmer');
    if (!room.active && next.roomId !== alloc.roomId) throw conflict(`Zimmer ${room.number} ist nicht buchbar`);

    const moved = next.roomId !== alloc.roomId || next.from !== alloc.from || next.to !== alloc.to;
    if (moved)
      await tx.update(roomAllocations).set({ roomId: next.roomId, period: period(next.from, next.to), updatedAt: new Date(), version: sql`${roomAllocations.version} + 1` })
        .where(eq(roomAllocations.id, br.allocationId));

    // Preise: vorhandene Nächte behalten ihren gespeicherten Preis; nur neue Nächte werden berechnet.
    const old = await tx.select().from(bookingRoomNights).where(eq(bookingRoomNights.bookingRoomId, id)).orderBy(bookingRoomNights.date);
    const oldByDate = new Map(old.map((n) => [n.date, n]));
    const tax = old[0]?.taxRatePercent ?? (await lodgingTaxPercent(tx));
    let manual = br.priceManual;
    let nightly: { date: string; priceCents: number; source: string }[];
    const dates = eachNight(next.from, next.to);
    if (typeof v.pricePerNightCents === 'number') {
      manual = true;
      nightly = dates.map((date) => ({ date, priceCents: v.pricePerNightCents as number, source: 'manuell' }));
    } else if (v.pricePerNightCents === null) {
      manual = false;
      nightly = await nightsFor(tx, await companyOf(tx, br.bookingId), next.roomId, br.categoryId, next.from, next.to);
    } else {
      const fresh = dates.some((d) => !oldByDate.has(d)) && !manual ? new Map((await nightsFor(tx, await companyOf(tx, br.bookingId), next.roomId, br.categoryId, next.from, next.to)).map((n) => [n.date, n])) : null;
      nightly = dates.map((date) => {
        const o = oldByDate.get(date);
        if (o) return { date, priceCents: o.priceCents, source: o.source };
        return manual ? { date, priceCents: old[0]?.priceCents ?? 0, source: 'manuell' } : fresh!.get(date)!;
      });
    }
    await tx.delete(bookingRoomNights).where(eq(bookingRoomNights.bookingRoomId, id));
    await tx.insert(bookingRoomNights).values(nightly.map((n) => ({ bookingRoomId: id, date: n.date, priceCents: n.priceCents, taxRatePercent: tax, source: n.source })));

    const adults = v.adults ?? br.adults;
    const children = v.children ?? br.children;
    await tx.update(bookingRooms).set({ adults, children, priceManual: manual, version: br.version + 1, updatedAt: new Date() }).where(eq(bookingRooms.id, id));
    const [oldRoom] = await tx.select({ number: rooms.number }).from(rooms).where(eq(rooms.id, alloc.roomId));
    const sum = (list: { priceCents: number }[]) => list.reduce((s, n) => s + n.priceCents, 0);
    await record(tx, actor, {
      action: 'room_update', entity: 'booking', entityId: br.bookingId,
      before: { room: oldRoom!.number, from: alloc.from, to: alloc.to, adults: br.adults, children: br.children, lodgingCents: sum(old) },
      after: { room: room.number, from: next.from, to: next.to, adults, children, lodgingCents: sum(nightly) },
    });
    return { bookingId: br.bookingId };
  });
}

/** Statuswechsel: bestätigen, Check-in, Check-out, Storno, Nichtanreise – und das jeweilige Zurücknehmen. */
export async function setRoomStatus(db: Db, actor: Actor, id: string, v: { status: RoomStatus; version: number }) {
  return db.transaction(async (tx) => {
    const { br, alloc } = await lockRoom(tx, id);
    if (br.version !== v.version) throw stale();
    if (!TRANSITIONS[br.status].includes(v.status)) throw conflict('Dieser Statuswechsel ist nicht möglich');
    const today = todayBerlin();
    const set: Partial<typeof bookingRooms.$inferInsert> = { status: v.status };
    const detail: Record<string, unknown> = {};

    if (v.status === 'checked_in' && br.status === 'confirmed') {
      if (alloc.from > today) throw conflict('Check-in ist erst am Anreisetag möglich. Bei früherer Anreise bitte zuerst das Anreisedatum ändern.');
      set.checkedInAt = new Date();
    }
    if (v.status === 'checked_in' && br.status === 'checked_out') set.checkedOutAt = null;
    if (v.status === 'confirmed' && br.status === 'checked_in') set.checkedInAt = null;
    if (v.status === 'checked_out') {
      set.checkedOutAt = new Date();
      // Nach der Abreise ist das Zimmer zu reinigen
      await tx.update(rooms).set({ housekeeping: 'dirty', updatedAt: new Date() }).where(eq(rooms.id, alloc.roomId));
      // Vorzeitige Abreise: Zeitraum endet heute, das Zimmer ist ab heute wieder frei, spätere Nächte entfallen.
      const end = today < alloc.from ? addDays(alloc.from, 1) : today === alloc.from ? addDays(today, 1) : today;
      if (end < alloc.to) {
        await tx.update(roomAllocations).set({ period: period(alloc.from, end), updatedAt: new Date(), version: sql`${roomAllocations.version} + 1` }).where(eq(roomAllocations.id, br.allocationId));
        await tx.delete(bookingRoomNights).where(and(eq(bookingRoomNights.bookingRoomId, id), sql`${bookingRoomNights.date} >= ${end}`));
        detail.earlyDeparture = { plannedTo: alloc.to, to: end };
      }
    }
    // Storno und Nichtanreise geben das Zimmer frei; Reaktivieren belegt es wieder (kann am Constraint scheitern).
    const active = isActiveStatus(v.status);
    if (active !== isActiveStatus(br.status))
      await tx.update(roomAllocations).set({ active, updatedAt: new Date(), version: sql`${roomAllocations.version} + 1` }).where(eq(roomAllocations.id, br.allocationId));

    await tx.update(bookingRooms).set({ ...set, version: br.version + 1, updatedAt: new Date() }).where(eq(bookingRooms.id, id));
    const [room] = await tx.select({ number: rooms.number }).from(rooms).where(eq(rooms.id, alloc.roomId));
    await record(tx, actor, { action: 'status', entity: 'booking', entityId: br.bookingId, before: { room: room!.number, status: br.status }, after: { room: room!.number, status: v.status, ...detail } });
    return { bookingId: br.bookingId };
  });
}

export async function addCharge(db: Db, actor: Actor, bookingId: string, v: {
  serviceId?: string; bookingRoomId?: string; name?: string; unitPriceCents?: number; taxRateId?: string; quantity?: number;
}) {
  await db.transaction(async (tx) => {
    const [b] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId));
    if (!b) throw notFound('Reservierung');
    let nights = 1;
    let persons = 1;
    if (v.bookingRoomId) {
      const { br, alloc } = await lockRoom(tx, v.bookingRoomId);
      if (br.bookingId !== bookingId) throw notFound('Zimmerbuchung');
      nights = diffDays(alloc.from, alloc.to);
      persons = br.adults + br.children;
    }
    let c: typeof charges.$inferSelect;
    if (v.serviceId) c = await addServiceCharge(tx, bookingId, v.bookingRoomId ?? null, v.serviceId, nights, persons, v.quantity);
    else {
      const [rate] = await tx.select().from(taxRates).where(eq(taxRates.id, v.taxRateId!));
      if (!rate) throw notFound('Steuersatz');
      [c] = (await tx.insert(charges).values({ bookingId, bookingRoomId: v.bookingRoomId ?? null, name: v.name!, quantity: v.quantity ?? 1, unitPriceCents: v.unitPriceCents!, taxRatePercent: rate.ratePercent }).returning()) as [typeof charges.$inferSelect];
    }
    await record(tx, actor, { action: 'charge_add', entity: 'booking', entityId: bookingId, after: { name: c.name, quantity: c.quantity, unitPriceCents: c.unitPriceCents, taxRatePercent: c.taxRatePercent } });
  });
}

export async function removeCharge(db: Db, actor: Actor, chargeId: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.delete(charges).where(eq(charges.id, chargeId)).returning();
    if (!c) throw notFound('Leistung');
    await record(tx, actor, { action: 'charge_remove', entity: 'booking', entityId: c.bookingId, before: { name: c.name, quantity: c.quantity, unitPriceCents: c.unitPriceCents } });
    return { bookingId: c.bookingId };
  });
}

// ---------- Übersicht ----------
export async function dashboard(db: Exec): Promise<DashboardDto> {
  const today = todayBerlin();
  const monthStart = today.slice(0, 8) + '01';
  const monthEnd = addDays(addDays(monthStart, 31).slice(0, 8) + '01', 0);
  const [arrivals, departures, overdueArr, overdueDep, tentative] = await Promise.all([
    selectRooms(db, sql`br.status in ('confirmed','tentative') and lower(a.period) = ${today}::date`, sql`r.number`),
    selectRooms(db, sql`br.status = 'checked_in' and upper(a.period) = ${today}::date`, sql`r.number`),
    selectRooms(db, sql`br.status in ('confirmed','tentative') and lower(a.period) < ${today}::date`),
    selectRooms(db, sql`br.status = 'checked_in' and upper(a.period) < ${today}::date`),
    selectRooms(db, sql`br.status = 'tentative' and lower(a.period) > ${today}::date and lower(a.period) <= ${addDays(today, 7)}::date`),
  ]);
  const [c] = await db.execute(sql`
    select
      (select count(*) from rooms where active)::int as total,
      (select count(*) from booking_rooms where status = 'checked_in')::int as in_house,
      (select count(distinct a.room_id) from room_allocations a join rooms r on r.id = a.room_id and r.active
        where a.active and a.kind = 'block' and a.period @> ${today}::date)::int as blocked,
      (select count(distinct a.room_id) from room_allocations a join rooms r on r.id = a.room_id and r.active
        join booking_rooms br on br.allocation_id = a.id
        where a.active and a.period @> ${today}::date and br.status in ('confirmed','checked_in','tentative'))::int as booked_tonight,
      (select coalesce(sum(n.price_cents), 0) from booking_room_nights n join booking_rooms br on br.id = n.booking_room_id
        where br.status in ('confirmed','checked_in','checked_out') and n.date = ${today}::date)::int as rev_today,
      (select coalesce(sum(n.price_cents), 0) from booking_room_nights n join booking_rooms br on br.id = n.booking_room_id
        where br.status in ('confirmed','checked_in','checked_out') and n.date >= ${monthStart}::date and n.date < ${monthEnd}::date)::int as rev_month`);
  const x = c as Raw;
  const total = x.total as number;
  const blocked = x.blocked as number;
  const booked = x.booked_tonight as number;
  const de = (s: string) => `${s.slice(8)}.${s.slice(5, 7)}.`;
  const task = (kind: TaskDto['kind'], r: BookingListRow, text: string): TaskDto => ({ kind, text, bookingId: r.bookingId, bookingRoomId: r.id });
  const dirtyRows = await db.execute(sql`
    select r.id, r.number, c.name as category_name,
      (select trim(g.first_name || ' ' || g.last_name) from room_allocations a join booking_rooms br on br.allocation_id = a.id join bookings b on b.id = br.booking_id
        join guests g on g.id = b.guest_id where a.room_id = r.id and a.active and lower(a.period) = ${today}::date and br.status in ('confirmed','tentative') limit 1) as arrival,
      exists(select 1 from room_allocations a join booking_rooms br on br.allocation_id = a.id where a.room_id = r.id and a.active and br.status = 'checked_in') as occupied
    from rooms r join room_categories c on c.id = r.category_id where r.active and r.housekeeping = 'dirty'`);
  const dirty = Array.from(dirtyRows).map((x) => {
    const y = x as Raw;
    return { roomId: y.id as string, number: y.number as string, categoryName: y.category_name as string, arrivalToday: (y.arrival as string) ?? null, occupied: y.occupied as boolean };
  }).sort((a, b) => Number(!!b.arrivalToday) - Number(!!a.arrivalToday) || a.number.localeCompare(b.number, 'de', { numeric: true }));
  const tasks: TaskDto[] = [
    ...overdueDep.map((r) => task('overdue_departure', r, `Abreise überfällig: ${r.guestName}, Zimmer ${r.roomNumber} (geplant ${de(r.to)})`)),
    ...overdueArr.map((r) => task('overdue_arrival', r, `Nicht angereist seit ${de(r.from)}: ${r.guestName}, Zimmer ${r.roomNumber} – einchecken oder als nicht angereist markieren`)),
    ...departures.map((r) => task('departure', r, `Check-out: ${r.guestName}, Zimmer ${r.roomNumber}`)),
    ...dirty.filter((d) => d.arrivalToday).map((d): TaskDto => ({ kind: 'cleaning', text: `Zimmer ${d.number} reinigen – heute Anreise ${d.arrivalToday}`, bookingId: '', bookingRoomId: d.roomId })),
    ...arrivals.map((r) => task('arrival', r, `Check-in: ${r.guestName}, Zimmer ${r.roomNumber}${r.status === 'tentative' ? ' (noch vorläufig)' : ''}`)),
    ...tentative.map((r) => task('tentative', r, `Vorläufige Reservierung bestätigen: ${r.guestName}, Anreise ${de(r.from)}`)),
  ];
  return {
    today,
    rooms: { total, occupied: x.in_house as number, blocked, free: Math.max(0, total - blocked - booked), occupancyPercent: total ? Math.round((booked / total) * 100) : 0 },
    arrivals, departures, inHouse: x.in_house as number,
    revenueTodayCents: x.rev_today as number, revenueMonthCents: x.rev_month as number, tasks, dirty,
  };
}
