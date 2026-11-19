import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { StockKind, StockMoveDto, StockOpenDto, StockOverviewDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { stockMoves } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getArticles } from './deliverynote.js';

/**
 * Einkauf: Warenzugang und Leergut. Offene Mengen werden aus den Bewegungen berechnet:
 * bei Kunden = geliefert − zurückbekommen, beim Lieferanten = erhalten − zurückgegeben (jeweils je Name und Artikel).
 * Nur Stückzahlen, kein Pfand in Euro.
 */
type Line = { qty: number; article: string };
const key = (s: string) => s.trim().toLowerCase();

/** offene Mengen je Partner und Artikel; plus = Ausgang (out/in), minus = Rückgabe */
async function openList(db: Exec, plus: StockKind, minus: StockKind): Promise<StockOpenDto[]> {
  const rows = await db.execute(sql`
    select min(partner) as partner, min(article) as article,
      sum(case when kind = ${plus} then qty else -qty end)::int as qty,
      min(date) filter (where kind = ${plus})::text as since
    from stock_moves where voided_at is null and kind in (${plus}, ${minus})
    group by lower(trim(partner)), lower(trim(article))
    having sum(case when kind = ${plus} then qty else -qty end) <> 0
    order by min(partner), min(article)`) as unknown as StockOpenDto[];
  return rows.map((r) => ({ ...r, since: r.since ?? '' }));
}

const dto = (r: typeof stockMoves.$inferSelect): StockMoveDto => ({
  id: r.id, date: r.date, kind: r.kind as StockKind, partner: r.partner, article: r.article, qty: r.qty, ref: r.ref, note: r.note, userName: r.userName,
  voided: !!r.voidedAt, voidedBy: r.voidedBy,
});

export async function overview(db: Exec): Promise<StockOverviewDto> {
  const sup = await db.execute(sql`select partner from stock_moves where kind = 'in' group by partner order by max(created_at) desc limit 30`) as unknown as { partner: string }[];
  const recent = await db.select().from(stockMoves).orderBy(desc(stockMoves.createdAt)).limit(60);
  return {
    articles: await getArticles(db), suppliers: sup.map((s) => s.partner),
    customers: await openList(db, 'out', 'empty_back'), atSuppliers: await openList(db, 'in', 'empty_return'),
    recent: recent.map(dto),
  };
}

async function insert(tx: Exec, actor: Actor, kind: StockKind, v: { date: string; partner: string; ref?: string; note: string }, lines: Line[]) {
  // gleiche Artikel zusammenfassen
  const merged = new Map<string, Line>();
  for (const l of lines) { const k = key(l.article); const m = merged.get(k); merged.set(k, m ? { ...m, qty: m.qty + l.qty } : { qty: l.qty, article: l.article.trim() }); }
  const rows = [...merged.values()].map((l) => ({ date: v.date, kind, partner: v.partner.trim(), article: l.article, qty: l.qty, ref: v.ref ?? '', note: v.note, userName: actor.userName }));
  if (rows.length) await tx.insert(stockMoves).values(rows);
  return rows;
}

/** Lieferschein gedruckt → Ware ist beim Kunden (wird vom Lieferschein aufgerufen, gleiche Transaktion). */
export const recordDelivery = (tx: Exec, actor: Actor, v: { date: string; recipient: string; number: string; note: string; lines: Line[] }) =>
  insert(tx, actor, 'out', { date: v.date, partner: v.recipient, ref: v.number, note: '' }, v.lines);

export async function addReceipt(db: Db, actor: Actor, v: { date: string; supplier: string; ref: string; note: string; lines: Line[]; empties: Line[] }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_moves'))`);
    await checkEnough(tx, 'in', 'empty_return', v.supplier, v.empties, v.lines);
    const a = await insert(tx, actor, 'in', { date: v.date, partner: v.supplier, ref: v.ref, note: v.note }, v.lines);
    const b = await insert(tx, actor, 'empty_return', { date: v.date, partner: v.supplier, ref: v.ref, note: v.note }, v.empties);
    await record(tx, actor, { action: 'create', entity: 'stock_receipt', entityId: v.ref || null, after: { ...v } });
    return { added: a.length + b.length };
  });
}

/** Rückgabe darf nicht mehr sein, als offen ist (sonst stimmt die Übersicht nicht mehr). */
async function checkEnough(tx: Exec, plus: StockKind, minus: StockKind, partner: string, back: Line[], alsoNow: Line[] = []) {
  if (!back.length) return;
  const open = await openList(tx, plus, minus);
  for (const l of back) {
    const have = (open.find((o) => key(o.partner) === key(partner) && key(o.article) === key(l.article))?.qty ?? 0)
      + alsoNow.filter((x) => key(x.article) === key(l.article)).reduce((s, x) => s + x.qty, 0);
    const want = back.filter((x) => key(x.article) === key(l.article)).reduce((s, x) => s + x.qty, 0);
    if (want > have) {
      throw conflict(plus === 'out'
        ? `Bei „${partner}“ sind von „${l.article}“ nur ${have} offen, nicht ${want}. Ältere Lieferungen aus der Zeit vor dem Programm bitte zuerst als Lieferschein nachtragen.`
        : `Von „${l.article}“ sind bei „${partner}“ nur ${have} offen, nicht ${want}. Fässer aus der Zeit vor dem Programm bitte zuerst als Warenzugang („Anfangsbestand“) nachtragen.`, 'stock_not_open');
    }
  }
}

export async function addEmpties(db: Db, actor: Actor, v: { kind: 'empty_back' | 'empty_return'; date: string; partner: string; note: string; lines: Line[] }) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_moves'))`);
    await checkEnough(tx, v.kind === 'empty_back' ? 'out' : 'in', v.kind, v.partner, v.lines);
    const rows = await insert(tx, actor, v.kind, v, v.lines);
    await record(tx, actor, { action: 'create', entity: 'stock_empties', entityId: null, after: { ...v } });
    return { added: rows.length };
  });
}

/** Fehleintrag stornieren – die Zeile bleibt sichtbar (durchgestrichen). */
export async function voidMove(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(stockMoves).where(eq(stockMoves.id, id)).for('update');
    if (!row) throw notFound('Eintrag');
    if (row.voidedAt) throw conflict('Dieser Eintrag ist bereits storniert', 'already_voided');
    // Ausgang/Zugang erst stornieren, wenn dazu kein Leergut mehr als zurück gebucht ist (sonst würde die Übersicht negativ)
    if (row.kind === 'in' || row.kind === 'out') {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('stock_moves'))`);
      const open = await openList(tx, row.kind, row.kind === 'out' ? 'empty_back' : 'empty_return');
      const have = open.find((o) => key(o.partner) === key(row.partner) && key(o.article) === key(row.article))?.qty ?? 0;
      if (have < row.qty) throw conflict(`Von „${row.article}“ ist schon Leergut als zurück eingetragen. Bitte zuerst diese Rückgabe stornieren.`, 'stock_in_use');
    }
    await tx.update(stockMoves).set({ voidedAt: new Date(), voidedBy: actor.userName }).where(and(eq(stockMoves.id, id), isNull(stockMoves.voidedAt)));
    await record(tx, actor, { action: 'void', entity: 'stock_move', entityId: id, before: dto(row) });
    return { ok: true };
  });
}
