import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { addDays, todayBerlin } from '../../shared/hotel.js';
import { MANUAL_CLEAN_LABEL, type ManualClean } from '../../shared/team.js';
import type { Db, Exec } from '../db/client.js';
import { rooms, settings } from '../db/schema.js';
import { columns, wrap, type Line } from '../lib/escpos.js';
import { notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { printLines } from './quickprint.js';
import { getHotel } from './settings.js';
import { cleanList } from './team.js';

/**
 * Von Hand eingetragene Reinigungen (Komplett- oder Zwischenreinigung) je Tag – z. B. wenn Gäste eine zusätzliche Reinigung wünschen.
 * Gespeichert als kleine Liste in den Einstellungen; Einträge älter als 60 Tage werden beim Speichern weggeräumt.
 */
const KEY = 'clean_manual';
async function all(db: Exec): Promise<ManualClean[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return Array.isArray(row?.value) ? (row.value as ManualClean[]) : [];
}
async function save(db: Exec, list: ManualClean[]) {
  const keepFrom = addDays(todayBerlin(), -60);
  const value = list.filter((m) => m.date >= keepFrom).slice(-500);
  await db.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
/** Lesen–Ändern–Speichern unter Sperre: zwei gleichzeitige Einträge überschreiben sich nicht gegenseitig */
const locked = <T>(db: Db, fn: (tx: Exec) => Promise<T>) => db.transaction(async (tx) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('clean_manual'))`);
  return fn(tx);
});
export const manualFor = async (db: Exec, date: string) => (await all(db)).filter((m) => m.date === date);

export async function addManualClean(db: Db, actor: Actor, v: { date: string; roomId: string; kind: ManualClean['kind']; note: string }) {
  const [room] = await db.select({ number: rooms.number }).from(rooms).where(eq(rooms.id, v.roomId));
  if (!room) throw notFound('Zimmer');
  const entry: ManualClean = { id: randomUUID(), date: v.date, roomId: v.roomId, room: room.number, kind: v.kind, note: v.note, by: actor.userName, at: new Date().toISOString(), done: false };
  await locked(db, async (tx) => save(tx, [...(await all(tx)), entry]));
  await record(db, actor, { action: 'create', entity: 'housekeeping', entityId: v.roomId, after: { tag: v.date, zimmer: room.number, art: MANUAL_CLEAN_LABEL[v.kind], notiz: v.note } });
  return entry;
}
export async function setManualDone(db: Db, actor: Actor, id: string, done: boolean) {
  const e = await locked(db, async (tx) => {
    const list = await all(tx);
    const x = list.find((m) => m.id === id);
    if (!x) throw notFound('Eintrag');
    x.done = done;
    await save(tx, list);
    return x;
  });
  await record(db, actor, { action: 'update', entity: 'housekeeping', entityId: e.roomId, after: { tag: e.date, zimmer: e.room, art: MANUAL_CLEAN_LABEL[e.kind], erledigt: done } });
  return e;
}
export async function removeManualClean(db: Db, actor: Actor, id: string) {
  const e = await locked(db, async (tx) => {
    const list = await all(tx);
    const x = list.find((m) => m.id === id);
    if (!x) throw notFound('Eintrag');
    await save(tx, list.filter((m) => m.id !== id));
    return x;
  });
  await record(db, actor, { action: 'remove', entity: 'housekeeping', entityId: e.roomId, before: { tag: e.date, zimmer: e.room, art: MANUAL_CLEAN_LABEL[e.kind] } });
  return { ok: true };
}

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
/** Reinigungsliste des Tages auf dem Bondrucker: was laut Belegung ansteht und was von Hand eingetragen wurde. */
export async function printCleanList(db: Db, actor: Actor, date: string) {
  const [list, h] = await Promise.all([cleanList(db, date), getHotel(db)]);
  const manual = list.manual.filter((m) => !m.done);
  const work = list.rows.filter((r) => r.departing || r.staying || r.housekeeping === 'dirty');
  const day = `${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}, ${date.split('-').reverse().join('.')}`;
  await printLines(db, (w) => [
    { text: h.name, align: 'center', bold: true }, { text: 'REINIGUNG', align: 'center', bold: true, big: true }, { text: day, align: 'center' }, { rule: true },
    ...(work.length ? work.flatMap((r): Line[] => [
      { text: columns(`Zimmer ${r.room}`, r.departing ? 'Endreinigung' : r.staying ? 'Zwischenreinigung' : 'Reinigen', w), bold: true },
      ...(r.arriving ? [{ text: `  danach Anreise ${r.nextGuest} (${r.nextPersons})` } as Line] : []),
      ...(r.staying ? [{ text: `  Gast bleibt: ${r.guest} (${r.persons})` } as Line] : []),
      { text: '  [ ] erledigt' },
    ]) : [{ text: 'Laut Belegung nichts zu reinigen.' } as Line]),
    ...(manual.length ? [{ rule: true } as Line, { text: 'Zusätzlich (von Hand eingetragen)', bold: true } as Line, ...manual.flatMap((m): Line[] => [
      { text: columns(`Zimmer ${m.room}`, MANUAL_CLEAN_LABEL[m.kind], w), bold: true },
      ...(m.note ? wrap(m.note, w - 2).map((t) => ({ text: `  ${t}` })) : []),
      { text: '  [ ] erledigt' },
    ])] : []),
    { rule: true }, { text: `Gedruckt von ${actor.userName}` },
  ]);
  await record(db, actor, { action: 'print', entity: 'housekeeping', entityId: date, after: { zimmer: work.length, vonHand: manual.length } });
  return { ok: true };
}
