import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { todayBerlin } from '../../shared/hotel.js';
import type { CleanList, CleanRow, DayReport, NoteKind, TeamNoteDto, TeamState } from '../../shared/team.js';
import type { Db, Exec } from '../db/client.js';
import { teamNoteReads, teamNotes } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

/** Übergabebuch, Aufgaben und Reparaturmeldungen. Alle angemeldeten Benutzer sehen und schreiben alles; nichts wird gelöscht. */
export async function listNotes(db: Exec, actor: Actor, view: 'open' | NoteKind | 'done'): Promise<TeamNoteDto[]> {
  const today = todayBerlin();
  const where = view === 'done' ? eq(teamNotes.status, 'done') : view === 'open' ? eq(teamNotes.status, 'open') : and(eq(teamNotes.status, 'open'), eq(teamNotes.kind, view));
  const rows = await db.select().from(teamNotes).where(where).orderBy(desc(teamNotes.createdAt)).limit(200);
  const reads = rows.length ? await db.select().from(teamNoteReads).where(inArray(teamNoteReads.noteId, rows.map((r) => r.id))) : [];
  return rows.map((r) => {
    const mine = r.createdById === actor.userId;
    const rs = reads.filter((x) => x.noteId === r.id);
    return {
      id: r.id, kind: r.kind, text: r.text, place: r.place, dueDate: r.dueDate, status: r.status, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
      doneBy: r.doneBy, doneAt: r.doneAt?.toISOString() ?? null, doneNote: r.doneNote,
      readBy: rs.map((x) => x.userName), readByMe: mine || rs.some((x) => x.userId === actor.userId), mine,
      overdue: r.status === 'open' && !!r.dueDate && r.dueDate < today,
    };
  });
}

export async function teamState(db: Exec, actor: Actor): Promise<TeamState> {
  const [u] = await db.execute(sql`select count(*)::int as n from team_notes n where n.status = 'open' and n.created_by_id is distinct from ${actor.userId}
    and not exists (select 1 from team_note_reads r where r.note_id = n.id and r.user_id = ${actor.userId})`);
  const [t] = await db.execute(sql`select count(*)::int as n from team_notes where status = 'open' and kind <> 'note'`);
  return { unread: Number(u!.n), openTasks: Number(t!.n) };
}

export async function createNote(db: Db, actor: Actor, v: { kind: NoteKind; text: string; place: string; dueDate: string | null }) {
  const [r] = await db.insert(teamNotes).values({ ...v, createdBy: actor.userName, createdById: actor.userId }).returning();
  await record(db, actor, { action: 'create', entity: 'team_note', entityId: r!.id, after: { kind: v.kind, place: v.place, text: v.text.slice(0, 120) } });
  return { id: r!.id };
}

/** Gelesen-Vermerk setzen (einmal je Benutzer). */
export async function markRead(db: Db, actor: Actor, id: string) {
  const [n] = await db.select({ id: teamNotes.id }).from(teamNotes).where(eq(teamNotes.id, id));
  if (!n) throw notFound('Eintrag');
  await db.insert(teamNoteReads).values({ noteId: id, userId: actor.userId!, userName: actor.userName }).onConflictDoNothing();
  return { ok: true };
}

/** Erledigt melden oder wieder öffnen. */
export async function setDone(db: Db, actor: Actor, id: string, done: boolean, note: string) {
  const [r] = await db.update(teamNotes).set(done ? { status: 'done', doneBy: actor.userName, doneAt: new Date(), doneNote: note } : { status: 'open', doneBy: '', doneAt: null, doneNote: '' })
    .where(eq(teamNotes.id, id)).returning();
  if (!r) throw notFound('Eintrag');
  await record(db, actor, { action: done ? 'done' : 'reopen', entity: 'team_note', entityId: id, after: { kind: r.kind, text: r.text.slice(0, 120), note } });
  return { ok: true };
}

// ---------- Reinigungsliste ----------
/** Alle buchbaren Zimmer mit dem, was am Tag ansteht: Abreise (Endreinigung), Bleiber (Zwischenreinigung), Anreise. */
export async function cleanList(db: Exec, date: string): Promise<CleanList> {
  const rows = await db.execute(sql`
    select r.id, r.number, r.floor, r.note, r.housekeeping, c.name as category,
      dep.guest as dep_guest, dep.persons as dep_persons, stay.guest as stay_guest, stay.persons as stay_persons, arr.guest as arr_guest, arr.persons as arr_persons
    from rooms r join room_categories c on c.id = r.category_id
    left join lateral (select trim(g.first_name || ' ' || g.last_name) as guest, br.adults + br.children as persons
      from room_allocations a join booking_rooms br on br.allocation_id = a.id join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
      where a.room_id = r.id and a.active and br.status in ('confirmed', 'checked_in', 'checked_out') and upper(a.period) = ${date}::date limit 1) dep on true
    left join lateral (select trim(g.first_name || ' ' || g.last_name) as guest, br.adults + br.children as persons
      from room_allocations a join booking_rooms br on br.allocation_id = a.id join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
      where a.room_id = r.id and a.active and br.status in ('confirmed', 'checked_in') and lower(a.period) < ${date}::date and upper(a.period) > ${date}::date limit 1) stay on true
    left join lateral (select trim(g.first_name || ' ' || g.last_name) as guest, br.adults + br.children as persons
      from room_allocations a join booking_rooms br on br.allocation_id = a.id join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
      where a.room_id = r.id and a.active and br.status in ('confirmed', 'checked_in', 'tentative') and lower(a.period) = ${date}::date limit 1) arr on true
    where r.active`);
  const list: CleanRow[] = Array.from(rows).map((x) => ({
    roomId: x.id as string, room: x.number as string, floor: x.floor as string, category: x.category as string, housekeeping: x.housekeeping as 'clean' | 'dirty',
    departing: x.dep_guest != null, staying: x.stay_guest != null, arriving: x.arr_guest != null,
    guest: ((x.dep_guest ?? x.stay_guest) as string | null) ?? '', persons: Number(x.dep_persons ?? x.stay_persons ?? 0),
    nextGuest: (x.arr_guest as string | null) ?? '', nextPersons: Number(x.arr_persons ?? 0), note: x.note as string,
  })).sort((a, b) => a.room.localeCompare(b.room, 'de', { numeric: true }));
  return {
    date, rows: list,
    total: { departures: list.filter((r) => r.departing).length, stays: list.filter((r) => r.staying).length, arrivals: list.filter((r) => r.arriving).length, dirty: list.filter((r) => r.housekeeping === 'dirty').length },
  };
}

// ---------- Tagesabschluss ----------
/** Zahlungen, Rechnungen, An- und Abreisen eines Tages – als Übersicht zum Abgleich mit Kasse und EC-Gerät. Ändert nichts. */
export async function dayReport(db: Exec, date: string): Promise<DayReport> {
  const pays = await db.execute(sql`
    select p.amount_cents, p.method, p.payer, p.recorded_by, p.reverses_id, to_char(p.created_at at time zone 'Europe/Berlin', 'HH24:MI') as time,
      coalesce(i.number, b.number, '') as ref
    from payments p left join invoices i on i.id = p.invoice_id left join bookings b on b.id = p.booking_id
    where p.date = ${date}::date order by p.created_at`);
  const paymentList = Array.from(pays).map((p) => ({ time: p.time as string, method: p.method as string, cents: Number(p.amount_cents), payer: p.payer as string, ref: p.ref as string, by: p.recorded_by as string, reversal: p.reverses_id != null }));
  const by = new Map<string, { count: number; cents: number }>();
  for (const p of paymentList) { const e = by.get(p.method) ?? { count: 0, cents: 0 }; e.count++; e.cents += p.cents; by.set(p.method, e); }
  const [inv] = await db.execute(sql`select count(*) filter (where kind = 'invoice')::int as n, coalesce(sum(gross_cents), 0)::int as cents, count(*) filter (where kind = 'cancellation')::int as c
    from invoices where number is not null and issue_date = ${date}::date`);
  const moves = await db.execute(sql`
    select r.number as room, trim(g.first_name || ' ' || g.last_name) as guest, b.id as booking_id, br.status, lower(a.period) = ${date}::date as arrives, upper(a.period) = ${date}::date as departs
    from booking_rooms br join room_allocations a on a.id = br.allocation_id join rooms r on r.id = a.room_id join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
    where br.status in ('confirmed', 'checked_in', 'checked_out') and (lower(a.period) = ${date}::date or upper(a.period) = ${date}::date) order by r.number`);
  const m = Array.from(moves).map((x) => ({ room: x.room as string, guest: x.guest as string, bookingId: x.booking_id as string, status: x.status as string, arrives: x.arrives as boolean, departs: x.departs as boolean }));
  const arr = m.filter((x) => x.arrives), dep = m.filter((x) => x.departs);
  const slim = ({ room, guest, bookingId }: (typeof m)[number]) => ({ room, guest, bookingId });
  const [occ] = await db.execute(sql`select
    (select count(*)::int from room_allocations a join booking_rooms br on br.allocation_id = a.id where a.active and br.status in ('confirmed', 'checked_in', 'checked_out') and a.period @> ${date}::date) as occupied,
    (select count(*)::int from rooms where active) as rooms`);
  return {
    date, payments: [...by.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => a.method.localeCompare(b.method, 'de')), paymentList,
    totalCents: paymentList.reduce((s, p) => s + p.cents, 0), cashCents: by.get('Bar')?.cents ?? 0,
    invoices: { count: Number(inv!.n), cents: Number(inv!.cents), cancelled: Number(inv!.c) },
    arrivals: { expected: arr.length, checkedIn: arr.filter((x) => x.status !== 'confirmed').length, open: arr.filter((x) => x.status === 'confirmed').map(slim) },
    departures: { expected: dep.length, checkedOut: dep.filter((x) => x.status === 'checked_out').length, open: dep.filter((x) => x.status === 'checked_in').map(slim) },
    occupied: Number(occ!.occupied), rooms: Number(occ!.rooms),
  };
}
