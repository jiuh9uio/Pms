import { and, asc, eq, ne } from 'drizzle-orm';
import { endTime, holdsTable, overlaps, type RestaurantTableDto, type TableReservationDto, type TableStatus } from '../../shared/restaurant.js';
import type { Db, Exec } from '../db/client.js';
import { restaurantTables, tableReservations } from '../db/schema.js';
import { conflict, notFound, stale } from '../lib/errors.js';
import { columns, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { print, printerWidth } from './breakfast.js';
import { getHotel } from './settings.js';

/** Restaurant: Tische und Tischreservierungen. Ein Tisch kann zur selben Zeit nur einmal reserviert sein. */

const tableDto = (t: typeof restaurantTables.$inferSelect): RestaurantTableDto => ({ id: t.id, name: t.name, seats: t.seats, area: t.area, sort: t.sort, active: t.active, version: t.version });

export const listTables = async (db: Exec) =>
  (await db.select().from(restaurantTables).orderBy(asc(restaurantTables.sort), asc(restaurantTables.name))).map(tableDto);

export async function saveTable(db: Db, actor: Actor, id: string | null, v: { name: string; seats: number; area: string; sort: number; active: boolean }, version?: number) {
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx.insert(restaurantTables).values(v).returning();
      await record(tx, actor, { action: 'create', entity: 'restaurant_table', entityId: row!.id, after: v });
      return tableDto(row!);
    }
    const [before] = await tx.select().from(restaurantTables).where(eq(restaurantTables.id, id)).for('update');
    if (!before) throw notFound('Tisch');
    if (before.version !== version) throw stale();
    const [row] = await tx.update(restaurantTables).set({ ...v, version: before.version + 1, updatedAt: new Date() }).where(eq(restaurantTables.id, id)).returning();
    await record(tx, actor, { action: 'update', entity: 'restaurant_table', entityId: id, before: tableDto(before), after: v });
    return tableDto(row!);
  });
}

type Row = { r: typeof tableReservations.$inferSelect; tableName: string | null };
const toDto = ({ r, tableName }: Row): TableReservationDto => ({
  id: r.id, date: r.date, time: r.time, durationMin: r.durationMin, persons: r.persons, name: r.name, phone: r.phone, note: r.note,
  tableId: r.tableId, tableName, status: r.status, createdBy: r.createdBy, version: r.version,
});
const select = (db: Exec) => db.select({ r: tableReservations, tableName: restaurantTables.name }).from(tableReservations)
  .leftJoin(restaurantTables, eq(restaurantTables.id, tableReservations.tableId));

export const listReservations = async (db: Exec, date: string) =>
  (await select(db).where(eq(tableReservations.date, date)).orderBy(asc(tableReservations.time), asc(tableReservations.createdAt))).map(toDto);

interface In { date: string; time: string; durationMin: number; persons: number; name: string; phone: string; note: string; tableId: string | null }

/** Sperrt den Tisch für diese Transaktion und lehnt Überschneidungen und zu kleine Tische ab. */
async function checkTable(tx: Exec, v: In, selfId: string | null) {
  if (!v.tableId) return;
  const [table] = await tx.select().from(restaurantTables).where(eq(restaurantTables.id, v.tableId)).for('update');
  if (!table) throw notFound('Tisch');
  if (!table.active) throw conflict(`${table.name} ist nicht mehr in Benutzung`);
  if (v.persons > table.seats) throw conflict(`${table.name} hat nur ${table.seats} Plätze`, 'table_small');
  const same = await tx.select().from(tableReservations).where(and(
    eq(tableReservations.tableId, v.tableId), eq(tableReservations.date, v.date), selfId ? ne(tableReservations.id, selfId) : undefined));
  const clash = same.find((o) => holdsTable(o.status) && overlaps(o, v));
  if (clash) throw conflict(`${table.name} ist um ${clash.time} Uhr bereits für ${clash.name} reserviert`, 'table_taken');
}

export async function createReservation(db: Db, actor: Actor, v: In) {
  return db.transaction(async (tx) => {
    await checkTable(tx, v, null);
    const [row] = await tx.insert(tableReservations).values({ ...v, createdBy: actor.userName }).returning();
    await record(tx, actor, { action: 'create', entity: 'table_reservation', entityId: row!.id, after: v });
    return { id: row!.id };
  });
}

export async function updateReservation(db: Db, actor: Actor, id: string, v: In & { version: number }) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tableReservations).where(eq(tableReservations.id, id)).for('update');
    if (!before) throw notFound('Reservierung');
    if (before.version !== v.version) throw stale();
    const { version, ...data } = v;
    if (holdsTable(before.status)) await checkTable(tx, data, id);
    await tx.update(tableReservations).set({ ...data, version: version + 1, updatedAt: new Date() }).where(eq(tableReservations.id, id));
    await record(tx, actor, { action: 'update', entity: 'table_reservation', entityId: id,
      before: { date: before.date, time: before.time, persons: before.persons, name: before.name, tableId: before.tableId }, after: data });
    return { id };
  });
}

export async function setStatus(db: Db, actor: Actor, id: string, status: TableStatus, version: number) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(tableReservations).where(eq(tableReservations.id, id)).for('update');
    if (!before) throw notFound('Reservierung');
    if (before.version !== version) throw stale();
    // beim Reaktivieren muss der Tisch noch frei sein
    if (holdsTable(status) && !holdsTable(before.status)) await checkTable(tx, before, id);
    await tx.update(tableReservations).set({ status, version: version + 1, updatedAt: new Date() }).where(eq(tableReservations.id, id));
    await record(tx, actor, { action: 'status', entity: 'table_reservation', entityId: id, before: { status: before.status }, after: { status, name: before.name } });
    return { id };
  });
}

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Tagesliste der Tischreservierungen auf dem Küchendrucker (nur reservierte und anwesende Gäste). */
export async function printReservations(db: Db, actor: Actor, date: string) {
  const [list, h, width] = [(await listReservations(db, date)).filter((r) => holdsTable(r.status)), await getHotel(db), await printerWidth(db)];
  const persons = list.reduce((s, r) => s + r.persons, 0);
  const lines: Line[] = [
    { text: h.name, align: 'center' }, { text: 'RESERVIERUNGEN', align: 'center', bold: true, big: true },
    { text: `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}, ${de(date)}`, align: 'center', bold: true }, { rule: true },
  ];
  if (list.length === 0) lines.push({ text: 'Keine Tischreservierungen.' });
  for (const r of list) {
    lines.push({ text: columns(`${r.time}  ${r.name}`, `${r.persons} Pers.`, width), bold: true });
    lines.push({ text: `  bis ${endTime(r.time, r.durationMin)} · ${r.tableName ?? 'Tisch offen'}${r.status === 'seated' ? ' · am Tisch' : ''}` });
    if (r.note) lines.push({ text: `  ${r.note}`.slice(0, width * 2) });
  }
  lines.push({ rule: true }, { text: columns(`${list.length} ${list.length === 1 ? 'Reservierung' : 'Reservierungen'}`, `${persons} Personen`, width), bold: true });
  lines.push({ feed: 1 }, { text: `Gedruckt ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`, align: 'center' });
  await print(db, lines);
  await record(db, actor, { action: 'print', entity: 'table_reservation', entityId: date, after: { reservations: list.length, persons } });
  return { ok: true };
}
