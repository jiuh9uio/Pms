import { and, asc, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { eachNight, weekdayOf, type CategoryDto, type RateRuleDto, type RoomDto, type ServiceDto } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { rateRules, roomAllocations, roomBlocks, roomCategories, rooms, services, taxRates } from '../db/schema.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

const period = (from: string, to: string) => `[${from},${to})`;

/**
 * Stammdatensatz anlegen (id = null) oder ändern – mit Versionsprüfung und Protokolleintrag.
 * Die Tabellen haben alle id, version und updatedAt.
 */
async function save(db: Db, actor: Actor, table: PgTable, entity: string, id: string | null, values: Record<string, unknown>, version?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx.insert(t).values(values).returning();
      await record(tx, actor, { action: 'create', entity, entityId: row.id, after: row });
      return row as { id: string };
    }
    const [before] = await tx.select().from(t).where(eq(t.id, id)).for('update');
    if (!before) throw notFound();
    if (before.version !== version) throw stale();
    const [row] = await tx.update(t).set({ ...values, version: before.version + 1, updatedAt: new Date() }).where(eq(t.id, id)).returning();
    await record(tx, actor, { action: 'update', entity, entityId: id, before, after: row });
    return row as { id: string };
  });
}

// ---------- Kategorien ----------
export const listCategories = async (db: Exec): Promise<CategoryDto[]> =>
  db.select().from(roomCategories).orderBy(asc(roomCategories.sort), asc(roomCategories.name));
export const saveCategory = (db: Db, actor: Actor, id: string | null, v: Omit<CategoryDto, 'id' | 'version'>, version?: number) =>
  save(db, actor, roomCategories, 'category', id, v, version);

// ---------- Zimmer ----------
export async function listRooms(db: Exec, onlyActive = false): Promise<RoomDto[]> {
  const rows = await db
    .select({ r: rooms, categoryName: roomCategories.name, base: roomCategories.basePriceCents })
    .from(rooms).innerJoin(roomCategories, eq(roomCategories.id, rooms.categoryId))
    .where(onlyActive ? eq(rooms.active, true) : undefined);
  return rows
    .map(({ r, categoryName, base }) => ({
      id: r.id, number: r.number, categoryId: r.categoryId, categoryName, floor: r.floor, note: r.note, active: r.active, housekeeping: r.housekeeping,
      priceOverrideCents: r.priceOverrideCents, priceCents: r.priceOverrideCents ?? base, version: r.version,
    }))
    .sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }));
}
export const saveRoom = (db: Db, actor: Actor, id: string | null, v: { number: string; categoryId: string; floor: string; note: string; active: boolean; priceOverrideCents: number | null }, version?: number) =>
  save(db, actor, rooms, 'room', id, v, version);

/** Legt mehrere Zimmer mit fortlaufenden Nummern an – alle oder keines. */
export async function createRoomsBulk(db: Db, actor: Actor, v: { categoryId: string; count: number; firstNumber: number; floor: string }) {
  const numbers = Array.from({ length: v.count }, (_, i) => String(v.firstNumber + i));
  return db.transaction(async (tx) => {
    const [cat] = await tx.select().from(roomCategories).where(eq(roomCategories.id, v.categoryId));
    if (!cat) throw notFound('Kategorie');
    const taken = (await tx.select({ number: rooms.number }).from(rooms)).map((r) => r.number).filter((n) => numbers.includes(n));
    if (taken.length) throw conflict(`Diese Zimmernummern gibt es bereits: ${taken.join(', ')}`, 'number_taken');
    const rows = await tx.insert(rooms).values(numbers.map((number) => ({ number, categoryId: v.categoryId, floor: v.floor }))).returning();
    await record(tx, actor, { action: 'create_many', entity: 'room', after: { category: cat.name, numbers, floor: v.floor } });
    return { created: rows.length, numbers };
  });
}

// ---------- Preisregeln und Leistungen ----------
export const listRateRules = async (db: Exec): Promise<RateRuleDto[]> =>
  db.select().from(rateRules).orderBy(asc(rateRules.priority), asc(rateRules.startDate));
export const saveRateRule = (db: Db, actor: Actor, id: string | null, v: Omit<RateRuleDto, 'id' | 'version'>, version?: number) =>
  save(db, actor, rateRules, 'rate_rule', id, v, version);

export async function listServices(db: Exec): Promise<ServiceDto[]> {
  const rows = await db.select({ s: services, taxRatePercent: taxRates.ratePercent }).from(services)
    .innerJoin(taxRates, eq(taxRates.id, services.taxRateId)).orderBy(asc(services.name));
  return rows.map(({ s, taxRatePercent }) => ({
    id: s.id, name: s.name, priceCents: s.priceCents, per: s.per, taxRateId: s.taxRateId, taxRatePercent, isBreakfast: s.isBreakfast, active: s.active, version: s.version,
  }));
}
export const saveService = (db: Db, actor: Actor, id: string | null, v: Omit<ServiceDto, 'id' | 'version' | 'taxRatePercent'>, version?: number) =>
  save(db, actor, services, 'service', id, v, version);

// ---------- Preisberechnung ----------
export interface NightPrice { date: string; priceCents: number; source: string }

/** Steuersatz für Übernachtungen (Standard aus den Einstellungen). */
export async function lodgingTaxPercent(db: Exec) {
  const [r] = await db.select({ p: taxRates.ratePercent }).from(taxRates).where(and(eq(taxRates.defaultFor, 'lodging'), eq(taxRates.active, true)));
  if (!r) throw new AppError(409, 'no_lodging_tax', 'Es ist kein Standard-Steuersatz für Übernachtungen festgelegt (Einstellungen → Steuersätze)');
  return r.p;
}

/** Preis je Nacht: Zimmer- bzw. Kategoriepreis, darauf die Preisregeln in Reihenfolge der Priorität. */
export async function priceNights(db: Exec, roomId: string, categoryId: string, from: string, to: string): Promise<NightPrice[]> {
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
  const [cat] = await db.select().from(roomCategories).where(eq(roomCategories.id, categoryId));
  if (!room || !cat) throw notFound('Zimmer');
  const own = room.categoryId === categoryId && room.priceOverrideCents != null;
  const base = own ? room.priceOverrideCents! : cat.basePriceCents;
  const rules = await db.select().from(rateRules)
    .where(and(eq(rateRules.active, true), sql`${rateRules.startDate} < ${to}`, sql`${rateRules.endDate} >= ${from}`))
    .orderBy(asc(rateRules.priority), asc(rateRules.createdAt));
  return eachNight(from, to).map((date) => {
    let price = base;
    const names: string[] = [];
    for (const r of rules) {
      if (date < r.startDate || date > r.endDate) continue;
      if (r.categoryId && r.categoryId !== categoryId) continue;
      if (r.weekdays.length && !r.weekdays.includes(weekdayOf(date))) continue;
      if (r.mode === 'fixed') price = Math.round(r.value * 100);
      else if (r.mode === 'amount') price += Math.round(r.value * 100);
      else price = Math.round(price * (1 + r.value / 100));
      names.push(r.name);
    }
    return { date, priceCents: Math.max(0, price), source: names.join(', ') || (own ? 'Zimmerpreis' : 'Grundpreis') };
  });
}

// ---------- Verfügbarkeit ----------
/** Aktive Zimmer ohne überschneidende Belegung; excludeAllocationId für das Umbuchen einer bestehenden Belegung. */
export async function freeRooms(db: Exec, from: string, to: string, excludeAllocationId?: string): Promise<RoomDto[]> {
  const busy = await db.select({ roomId: roomAllocations.roomId }).from(roomAllocations).where(and(
    eq(roomAllocations.active, true), sql`${roomAllocations.period} && ${period(from, to)}::daterange`,
    excludeAllocationId ? sql`${roomAllocations.id} <> ${excludeAllocationId}` : undefined,
  ));
  const taken = new Set(busy.map((b) => b.roomId));
  return (await listRooms(db, true)).filter((r) => !taken.has(r.id));
}

// ---------- Sperren ----------
async function activeRoom(tx: Exec, roomId: string) {
  const [room] = await tx.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room) throw notFound('Zimmer');
  return room;
}

export async function createBlock(db: Db, actor: Actor, v: { roomId: string; from: string; to: string; reason: string }) {
  return db.transaction(async (tx) => {
    const room = await activeRoom(tx, v.roomId);
    const [a] = await tx.insert(roomAllocations).values({ roomId: v.roomId, period: period(v.from, v.to), kind: 'block' }).returning();
    const [b] = await tx.insert(roomBlocks).values({ allocationId: a!.id, reason: v.reason }).returning();
    await record(tx, actor, { action: 'create', entity: 'block', entityId: b!.id, after: { room: room.number, from: v.from, to: v.to, reason: v.reason } });
    return { id: b!.id };
  });
}

export async function updateBlock(db: Db, actor: Actor, id: string, v: { roomId: string; from: string; to: string; reason: string; version: number }) {
  return db.transaction(async (tx) => {
    const [b] = await tx.select().from(roomBlocks).where(eq(roomBlocks.id, id)).for('update');
    if (!b) throw notFound('Sperre');
    const [a] = await tx.select().from(roomAllocations).where(eq(roomAllocations.id, b.allocationId)).for('update');
    if (!a!.active) throw conflict('Diese Sperre wurde bereits aufgehoben');
    if (a!.version !== v.version) throw stale();
    const room = await activeRoom(tx, v.roomId);
    await tx.update(roomAllocations).set({ roomId: v.roomId, period: period(v.from, v.to), version: a!.version + 1, updatedAt: new Date() }).where(eq(roomAllocations.id, a!.id));
    await tx.update(roomBlocks).set({ reason: v.reason, updatedAt: new Date() }).where(eq(roomBlocks.id, id));
    await record(tx, actor, { action: 'update', entity: 'block', entityId: id, before: { period: a!.period, reason: b.reason }, after: { room: room.number, from: v.from, to: v.to, reason: v.reason } });
    return { id };
  });
}

/** Sperre aufheben – das Zimmer ist wieder buchbar; der Eintrag bleibt zur Nachvollziehbarkeit erhalten. */
export async function removeBlock(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(roomBlocks).where(eq(roomBlocks.id, id));
    if (!b) throw notFound('Sperre');
    await tx.update(roomAllocations).set({ active: false, updatedAt: new Date(), version: sql`${roomAllocations.version} + 1` }).where(eq(roomAllocations.id, b.allocationId));
    await record(tx, actor, { action: 'remove', entity: 'block', entityId: id, before: { reason: b.reason } });
  });
}

export { period };

/** Housekeeping-Status setzen (sauber / zu reinigen). */
export async function setHousekeeping(db: Db, actor: Actor, id: string, status: 'clean' | 'dirty') {
  await db.transaction(async (tx) => {
    const [r] = await tx.update(rooms).set({ housekeeping: status, updatedAt: new Date() }).where(eq(rooms.id, id)).returning({ number: rooms.number });
    if (!r) throw notFound('Zimmer');
    await record(tx, actor, { action: status === 'clean' ? 'cleaned' : 'dirty', entity: 'room', entityId: id, after: { room: r.number, housekeeping: status } });
  });
}
