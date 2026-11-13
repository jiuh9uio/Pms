import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { GoodsReceiptDto } from '../../shared/controls.js';
import { todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { goodsReceipts } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

/** Wareneingangskontrolle (Eigenkontrolle): Lieferung, Ware, ggf. Temperatur, Befund. */

const toDto = (r: typeof goodsReceipts.$inferSelect): GoodsReceiptDto =>
  ({ id: r.id, date: r.date, supplier: r.supplier, goods: r.goods, tempC: r.tempC, ok: r.ok, note: r.note, userName: r.userName, createdAt: r.createdAt.toISOString() });

export async function listReceipts(db: Exec, month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const rows = await db.select().from(goodsReceipts).where(and(gte(goodsReceipts.date, `${month}-01`), lt(goodsReceipts.date, next)))
    .orderBy(desc(goodsReceipts.date), desc(goodsReceipts.createdAt));
  return rows.map(toDto);
}

/** Bisher verwendete Lieferanten als Eingabehilfe. */
export async function suppliers(db: Exec) {
  const rows = await db.execute(sql`select supplier from goods_receipts group by supplier order by max(created_at) desc limit 30`);
  return Array.from(rows).map((r) => r.supplier as string);
}

export async function addReceipt(db: Db, actor: Actor, v: { supplier: string; goods: string; tempC: number | null; ok: boolean; note: string }) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(goodsReceipts).values({ ...v, date: todayBerlin(), userName: actor.userName }).returning();
    await record(tx, actor, { action: 'create', entity: 'goods_receipt', entityId: row!.id, after: v });
    return toDto(row!);
  });
}

/** Löschen nur am Tag des Eintrags (Tippfehler); ältere Einträge bleiben im Protokoll. */
export async function removeReceipt(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.id, id));
    if (!row) throw notFound('Wareneingang');
    if (row.date !== todayBerlin()) throw conflict('Einträge früherer Tage können nicht mehr gelöscht werden');
    await tx.delete(goodsReceipts).where(eq(goodsReceipts.id, id));
    await record(tx, actor, { action: 'remove', entity: 'goods_receipt', entityId: id, before: toDto(row) });
  });
}
