import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import {
  outOfRange, type HygieneAreaDto, type HygieneReadingDto, type InspectionDetailDto, type InspectionTypeDto,
} from '../../shared/controls.js';
import { todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { hygieneAreas, hygienePoints, hygieneReadings, inspectionItems, inspectionTypes, inspectionVisits } from '../db/schema.js';
import { AppError, notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

// ---------- Kontrollarten, Unterlagen, Besuche ----------
export async function listTypes(db: Exec): Promise<InspectionTypeDto[]> {
  const rows = await db.execute(sql`
    select t.id, t.name, t.kind, t.active, t.version,
      (select count(*) from inspection_items i where i.type_id = t.id)::int as items_total,
      (select count(*) from inspection_items i where i.type_id = t.id and i.ready)::int as items_ready,
      (select max(v.date)::text from inspection_visits v where v.type_id = t.id) as last_visit
    from inspection_types t order by t.sort, t.name`);
  return Array.from(rows).map((r) => {
    const x = r as Record<string, unknown>;
    return { id: x.id, name: x.name, kind: x.kind, active: x.active, version: x.version, itemsTotal: x.items_total, itemsReady: x.items_ready, lastVisit: x.last_visit } as InspectionTypeDto;
  });
}

export async function getType(db: Exec, id: string): Promise<InspectionDetailDto> {
  const type = (await listTypes(db)).find((t) => t.id === id);
  if (!type) throw notFound('Kontrollart');
  const items = await db.select().from(inspectionItems).where(eq(inspectionItems.typeId, id)).orderBy(asc(inspectionItems.sort), asc(inspectionItems.createdAt));
  const visits = await db.select().from(inspectionVisits).where(eq(inspectionVisits.typeId, id)).orderBy(desc(inspectionVisits.date), desc(inspectionVisits.createdAt));
  return {
    type,
    items: items.map((i) => ({ id: i.id, text: i.text, ready: i.ready, note: i.note, version: i.version })),
    visits: visits.map((v) => ({ id: v.id, date: v.date, inspector: v.inspector, result: v.result, notes: v.notes, recordedBy: v.recordedBy })),
  };
}

export async function saveType(db: Db, actor: Actor, id: string | null, v: { name: string; active: boolean }, version?: number) {
  return db.transaction(async (tx) => {
    if (!id) {
      const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${inspectionTypes.sort}), 0)::int` }).from(inspectionTypes)) as [{ n: number }];
      const [row] = await tx.insert(inspectionTypes).values({ name: v.name, active: v.active, sort: n + 1 }).returning();
      await record(tx, actor, { action: 'create', entity: 'inspection_type', entityId: row!.id, after: { name: v.name } });
      return { id: row!.id };
    }
    const [before] = await tx.select().from(inspectionTypes).where(eq(inspectionTypes.id, id)).for('update');
    if (!before) throw notFound('Kontrollart');
    if (before.version !== version) throw stale();
    await tx.update(inspectionTypes).set({ ...v, version: before.version + 1, updatedAt: new Date() }).where(eq(inspectionTypes.id, id));
    await record(tx, actor, { action: 'update', entity: 'inspection_type', entityId: id, before: { name: before.name, active: before.active }, after: v });
    return { id };
  });
}

export async function addItem(db: Db, actor: Actor, typeId: string, text: string) {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(inspectionTypes).where(eq(inspectionTypes.id, typeId));
    if (!t) throw notFound('Kontrollart');
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${inspectionItems.sort}), 0)::int` }).from(inspectionItems).where(eq(inspectionItems.typeId, typeId))) as [{ n: number }];
    const [row] = await tx.insert(inspectionItems).values({ typeId, text, sort: n + 1 }).returning();
    await record(tx, actor, { action: 'create', entity: 'inspection_item', entityId: row!.id, after: { type: t.name, text } });
  });
}

export async function updateItem(db: Db, actor: Actor, id: string, v: { ready: boolean; note: string; version: number }) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(inspectionItems).where(eq(inspectionItems.id, id)).for('update');
    if (!before) throw notFound('Unterlage');
    if (before.version !== v.version) throw stale();
    await tx.update(inspectionItems).set({ ready: v.ready, note: v.note, version: before.version + 1, updatedAt: new Date() }).where(eq(inspectionItems.id, id));
    await record(tx, actor, { action: 'update', entity: 'inspection_item', entityId: id, before: { text: before.text, ready: before.ready, note: before.note }, after: { text: before.text, ready: v.ready, note: v.note } });
    return { typeId: before.typeId };
  });
}

export async function removeItem(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.delete(inspectionItems).where(eq(inspectionItems.id, id)).returning();
    if (!row) throw notFound('Unterlage');
    await record(tx, actor, { action: 'remove', entity: 'inspection_item', entityId: id, before: { text: row.text } });
    return { typeId: row.typeId };
  });
}

export async function addVisit(db: Db, actor: Actor, typeId: string, v: { date: string; inspector: string; result: string; notes: string }) {
  if (v.date > todayBerlin()) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { date: 'Das Datum liegt in der Zukunft' });
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(inspectionTypes).where(eq(inspectionTypes.id, typeId));
    if (!t) throw notFound('Kontrollart');
    const [row] = await tx.insert(inspectionVisits).values({ typeId, ...v, recordedBy: actor.userName }).returning();
    await record(tx, actor, { action: 'create', entity: 'inspection_visit', entityId: row!.id, after: { type: t.name, ...v } });
  });
}

// ---------- Temperatur-Eigenkontrolle ----------
export async function listAreas(db: Exec): Promise<HygieneAreaDto[]> {
  const areas = await db.select().from(hygieneAreas).orderBy(asc(hygieneAreas.sort), asc(hygieneAreas.name));
  const points = await db.select().from(hygienePoints).orderBy(asc(hygienePoints.sort), asc(hygienePoints.createdAt));
  return areas.map((a) => ({
    id: a.id, name: a.name, active: a.active, version: a.version,
    points: points.filter((p) => p.areaId === a.id).map((p) => ({ id: p.id, areaId: p.areaId, name: p.name, minC: p.minC, maxC: p.maxC, active: p.active, version: p.version })),
  }));
}

async function saveRow(db: Db, actor: Actor, table: typeof hygieneAreas | typeof hygienePoints, entity: string, id: string | null, values: Record<string, unknown>, version?: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = table as any;
  return db.transaction(async (tx) => {
    if (!id) {
      const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(${t.sort}), 0)::int` }).from(t)) as [{ n: number }];
      const [row] = await tx.insert(t).values({ ...values, sort: n + 1 }).returning();
      await record(tx, actor, { action: 'create', entity, entityId: row.id, after: values });
      return { id: row.id as string };
    }
    const [before] = await tx.select().from(t).where(eq(t.id, id)).for('update');
    if (!before) throw notFound();
    if (before.version !== version) throw stale();
    await tx.update(t).set({ ...values, version: before.version + 1, updatedAt: new Date() }).where(eq(t.id, id));
    await record(tx, actor, { action: 'update', entity, entityId: id, before, after: values });
    return { id };
  });
}
export const saveArea = (db: Db, actor: Actor, id: string | null, v: { name: string; active: boolean }, version?: number) =>
  saveRow(db, actor, hygieneAreas, 'hygiene_area', id, v, version);
export const savePoint = (db: Db, actor: Actor, id: string | null, v: { areaId: string; name: string; minC: number | null; maxC: number | null; active: boolean }, version?: number) =>
  saveRow(db, actor, hygienePoints, 'hygiene_point', id, v, version);

export async function listReadings(db: Exec, from: string, to: string): Promise<HygieneReadingDto[]> {
  const rows = await db.select().from(hygieneReadings).where(and(gte(hygieneReadings.date, from), lte(hygieneReadings.date, to))).orderBy(asc(hygieneReadings.date));
  return rows.map((r) => ({ pointId: r.pointId, date: r.date, valueC: r.valueC, note: r.note, userName: r.userName, enteredAt: r.enteredAt.toISOString() }));
}

/**
 * Messwerte eintragen. Regeln: kein Datum in der Zukunft; liegt ein Wert außerhalb des Sollbereichs, muss die
 * ergriffene Maßnahme vermerkt sein. Wer wann eingetragen hat, wird gespeichert; Korrekturen stehen im Protokoll.
 */
export async function saveReadings(db: Db, actor: Actor, entries: { pointId: string; date: string; valueC: number; note: string }[]) {
  const today = todayBerlin();
  return db.transaction(async (tx) => {
    const points = new Map((await tx.select().from(hygienePoints)).map((p) => [p.id, p]));
    const fields: Record<string, string> = {};
    entries.forEach((e, i) => {
      const p = points.get(e.pointId);
      if (!p) fields[`entries.${i}.pointId`] = 'Messstelle nicht gefunden';
      else if (e.date > today) fields[`entries.${i}.date`] = 'Das Datum liegt in der Zukunft';
      else if (outOfRange(e.valueC, p) && !e.note) fields[`entries.${i}.note`] = `${p.name}: Wert außerhalb des Sollbereichs – bitte die ergriffene Maßnahme eintragen`;
    });
    if (Object.keys(fields).length) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', fields);
    for (const e of entries) {
      const [before] = await tx.select().from(hygieneReadings).where(and(eq(hygieneReadings.pointId, e.pointId), eq(hygieneReadings.date, e.date))).for('update');
      if (before && before.valueC === e.valueC && before.note === e.note) continue;
      const p = points.get(e.pointId)!;
      if (before) {
        await tx.update(hygieneReadings).set({ valueC: e.valueC, note: e.note, userName: actor.userName, enteredAt: new Date() })
          .where(and(eq(hygieneReadings.pointId, e.pointId), eq(hygieneReadings.date, e.date)));
        await record(tx, actor, { action: 'correct', entity: 'hygiene_reading', entityId: e.pointId, before: { point: p.name, date: e.date, valueC: before.valueC, note: before.note, enteredBy: before.userName }, after: { point: p.name, date: e.date, valueC: e.valueC, note: e.note } });
      } else {
        await tx.insert(hygieneReadings).values({ ...e, userName: actor.userName });
        await record(tx, actor, { action: 'create', entity: 'hygiene_reading', entityId: e.pointId, after: { point: p.name, date: e.date, valueC: e.valueC, note: e.note } });
      }
    }
    return { saved: entries.length };
  });
}
