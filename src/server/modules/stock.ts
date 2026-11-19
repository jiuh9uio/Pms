import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { formatMoney } from '../../shared/hotel.js';
import type { StockArticle, StockBonDto, StockEmptiesInput, StockKind, StockMoveDto, StockOpenDto, StockOverviewDto, StockReceiptInput, StockSaveResult } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { auditLog, numberSequences, settings, stockMoves } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { columns, wrap, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { bonTarget, printJobs } from './quickprint.js';
import { getHotel } from './settings.js';

/**
 * Einkauf aus Sicht des Betriebs: Warenzugang vom Lieferanten (z. B. Brauerei) und Leergut, das an den Lieferanten zurückgeht.
 * Zu beidem gibt es einen Bon für den Bondrucker – beim Leergut mit Unterschrift des Fahrers als Nachweis fürs Pfand.
 * Offen beim Lieferanten = erhalten − als Leergut abgegeben (nur Stückzahlen, kein Pfand in Euro).
 * Bewegungen werden nie gelöscht, nur storniert. Der Inhalt jedes Bons steht im Änderungsprotokoll (für den Nachdruck).
 */

export const ARTICLES_DEFAULT: StockArticle[] = ['Pils – Fass 50 l', 'Hefe – Fass 20 l', 'Kupfer – Fass 30 l'].map((name) => ({ name, depositCents: 0 }));
const ART_KEY = 'delivery_articles';
export async function getArticles(db: Exec): Promise<StockArticle[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, ART_KEY));
  if (!Array.isArray(row?.value)) return ARTICLES_DEFAULT;
  // frühere Versionen speicherten nur Namen
  return (row.value as (string | StockArticle)[]).map((a) => (typeof a === 'string' ? { name: a, depositCents: 0 } : a));
}
export async function saveArticles(db: Db, actor: Actor, articles: StockArticle[]) {
  const seen = new Set<string>();
  const v = articles.map((a) => ({ name: a.name.trim(), depositCents: a.depositCents })).filter((a) => a.name && !seen.has(key(a.name)) && seen.add(key(a.name)));
  await db.insert(settings).values({ key: ART_KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: ART_KEY, after: v });
  return v;
}

type Line_ = { qty: number; article: string };
const key = (s: string) => s.trim().toLowerCase();

/** Beim Lieferanten noch offen (erhalten − abgegeben), nur positive Mengen – Leergut aus der Zeit vor dem Programm macht nichts kaputt. */
async function atSuppliers(db: Exec): Promise<StockOpenDto[]> {
  const rows = await db.execute(sql`
    select min(partner) as partner, min(article) as article,
      sum(case when kind = 'in' then qty else -qty end)::int as qty,
      min(date) filter (where kind = 'in')::text as since
    from stock_moves where voided_at is null and kind in ('in', 'empty_return')
    group by lower(trim(partner)), lower(trim(article))
    having sum(case when kind = 'in' then qty else -qty end) > 0
    order by min(partner), min(article)`) as unknown as StockOpenDto[];
  const arts = await getArticles(db);
  return rows.map((r) => {
    const dep = arts.find((a) => key(a.name) === key(r.article))?.depositCents ?? 0;
    return { ...r, since: r.since ?? '', depositCents: dep > 0 ? dep * r.qty : null };
  });
}

const dto = (r: typeof stockMoves.$inferSelect): StockMoveDto => ({
  id: r.id, date: r.date, kind: r.kind as StockKind, partner: r.partner, article: r.article, qty: r.qty, ref: r.ref, note: r.note, userName: r.userName,
  voided: !!r.voidedAt, voidedBy: r.voidedBy,
});

type BonRecord = { kind: 'receipt'; v: StockReceiptInput; number: string } | { kind: 'empties'; v: StockEmptiesInput; number: string };
const BON_ENTITIES = ['stock_receipt', 'stock_empties'];

export async function overview(db: Exec): Promise<StockOverviewDto> {
  const sup = await db.execute(sql`select partner from stock_moves where kind in ('in', 'empty_return') group by partner order by max(created_at) desc limit 30`) as unknown as { partner: string }[];
  const recent = await db.select().from(stockMoves).orderBy(desc(stockMoves.createdAt)).limit(60);
  const audit = await db.select().from(auditLog).where(and(inArray(auditLog.entity, BON_ENTITIES), eq(auditLog.action, 'create'))).orderBy(desc(auditLog.id)).limit(30);
  // nur Einträge mit Bon-Inhalt (Version 1.92.0 hat dieselben Namen ohne Bon-Nummer protokolliert)
  const isBon = (x: unknown): x is BonRecord => !!x && typeof x === 'object' && 'number' in x && 'v' in x && 'kind' in x;
  const bons: StockBonDto[] = audit.filter((r) => isBon(r.after)).map((r) => {
    const b = r.after as BonRecord;
    const lines = b.kind === 'receipt' ? [...b.v.lines, ...b.v.empties.map((e) => ({ ...e, article: `Leergut ${e.article}` }))] : b.v.lines;
    return { auditId: r.id, kind: b.kind, number: b.number, date: b.v.date, supplier: b.v.supplier, summary: lines.map((l) => `${l.qty}× ${l.article}`).join(', '), userName: r.userName, depositCents: depositSaldo(b) };
  });
  const t = await bonTarget(db);
  return {
    articles: await getArticles(db), suppliers: sup.map((s) => s.partner),
    atSuppliers: await atSuppliers(db), recent: recent.map(dto), bons, printerReady: !!t, printerName: t?.name ?? '',
  };
}

async function insert(tx: Exec, actor: Actor, kind: StockKind, v: { date: string; partner: string; ref: string; note: string }, lines: Line_[]) {
  // gleiche Artikel zusammenfassen
  const merged = new Map<string, Line_>();
  for (const l of lines) { const k = key(l.article); const m = merged.get(k); merged.set(k, m ? { ...m, qty: m.qty + l.qty } : { qty: l.qty, article: l.article.trim() }); }
  // gleiche Schreibweise wie beim ersten Eintrag dieses Lieferanten (z. B. „brauerei x“ → „Brauerei X“)
  const [known] = await tx.select({ partner: stockMoves.partner }).from(stockMoves).where(sql`lower(trim(${stockMoves.partner})) = ${key(v.partner)}`).orderBy(stockMoves.createdAt).limit(1);
  const partner = known?.partner ?? v.partner.trim();
  const rows = [...merged.values()].map((l) => ({ date: v.date, kind, partner, article: l.article, qty: l.qty, ref: v.ref, note: v.note, userName: actor.userName }));
  if (rows.length) await tx.insert(stockMoves).values(rows);
  return rows;
}
async function nextNumber(tx: Exec, seq: 'stock_receipt' | 'stock_empties', prefix: string, date: string) {
  const year = Number(date.slice(0, 4));
  const [row] = await tx.insert(numberSequences).values({ key: seq, year, last: 1 })
    .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
  return `${prefix}-${year}-${String(row!.last).padStart(4, '0')}`;
}

/** Pfand eines Bons: + bezahlt (erhaltene Ware), − gutgeschrieben (Leergut); null = nichts eingetragen */
function depositSaldo(b: BonRecord): number | null {
  const paid = b.kind === 'receipt' ? b.v.depositCents ?? null : null;
  const credit = b.kind === 'receipt' ? b.v.emptiesDepositCents ?? null : b.v.depositCents ?? null;
  return paid == null && credit == null ? null : (paid ?? 0) - (credit ?? 0);
}

// ---------- Bon ----------
const de = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const center = (t: string, w: number, o: { bold?: boolean; big?: boolean } = {}): Line[] => wrap(t, o.big ? Math.floor(w / 2) : w).map((text) => ({ text, align: 'center' as const, ...o }));
const lineRows = (lines: Line_[], w: number): Line[] => lines.flatMap((l) => {
  const q = `${l.qty} x`;
  return wrap(l.article, w - q.length - 1).map((p, i) => ({ text: i === 0 ? columns(p, q, w) : p }));
});
const sign = (label: string, w: number): Line[] => [{ feed: 2 }, { text: '_'.repeat(w) }, { text: label }];

async function bon(db: Exec, b: BonRecord, copy: 'driver' | 'ours' | 'single' | 'reprint') {
  const h = await getHotel(db);
  const address = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const empties = b.kind === 'receipt' ? b.v.empties : b.v.lines;
  const received = b.kind === 'receipt' ? b.v.lines : [];
  return (w: number): Line[] => [
    ...center(h.name, w, { bold: true }), ...(address ? center(address, w) : []),
    { rule: true, char: '=' },
    ...center(b.kind === 'receipt' ? 'WARENZUGANG' : 'LEERGUT-RÜCKGABE', w, { bold: true, big: true }),
    ...(copy === 'reprint' ? center('– Nachdruck –', w, { bold: true }) : []),
    { rule: true, char: '=' },
    { text: columns('Nr.', b.number, w), bold: true },
    { text: columns('Datum', de(b.v.date), w) },
    ...(b.v.supplier.length <= w - 11 ? [{ text: columns('Lieferant', b.v.supplier, w) } as Line] : [{ text: 'Lieferant' } as Line, ...wrap(b.v.supplier, w).map((text) => ({ text }))]),
    ...(b.kind === 'receipt' && b.v.ref ? [{ text: columns('Lieferschein-Nr.', b.v.ref, w) } as Line] : []),
    ...(received.length ? [{ rule: true } as Line, { text: 'Erhalten', bold: true } as Line, ...lineRows(received, w), { text: columns('Stück gesamt', String(received.reduce((s, l) => s + l.qty, 0)), w) } as Line] : []),
    ...(empties.length ? [{ rule: true } as Line, { text: 'Leergut abgegeben', bold: true } as Line, ...lineRows(empties, w), { text: columns('Stück gesamt', String(empties.reduce((s, l) => s + l.qty, 0)), w) } as Line] : []),
    ...depositLines(b, w),
    ...(b.v.note ? [{ rule: true } as Line, ...b.v.note.split('\n').flatMap((a) => wrap(a, w)).map((text) => ({ text }))] : []),
    { rule: true },
    ...(empties.length ? [{ text: 'Leergut vollständig übernommen:' } as Line, ...sign('Unterschrift Fahrer / Lieferant', w), { feed: 1 } as Line, { text: '_'.repeat(w) } as Line, { text: 'Name in Druckbuchstaben' } as Line] : []),
    ...(received.length ? [{ feed: 1 } as Line, { text: 'Ware angenommen:' } as Line, ...sign('Unterschrift ' + h.name, w)] : []),
    ...(copy === 'driver' ? [{ feed: 1 } as Line, ...center('Exemplar für den Fahrer', w)] : copy === 'ours' ? [{ feed: 1 } as Line, ...center('Exemplar für uns – bitte abheften', w)] : []),
  ];
}
function depositLines(b: BonRecord, w: number): Line[] {
  const paid = b.kind === 'receipt' ? b.v.depositCents ?? null : null;
  const credit = b.kind === 'receipt' ? b.v.emptiesDepositCents ?? null : b.v.depositCents ?? null;
  if (paid == null && credit == null) return [];
  const out: Line[] = [{ rule: true }, { text: 'Pfand', bold: true }];
  if (paid != null) out.push({ text: columns('Pfand für erhaltene Ware', formatMoney(paid), w) });
  if (credit != null) out.push({ text: columns('Pfand Leergut (Gutschrift)', formatMoney(-credit), w) });
  if (paid != null && credit != null) out.push({ text: columns('Pfand Saldo', formatMoney(paid - credit), w), bold: true });
  return out;
}
/** Druckt den Bon; Fehler beim Drucken werden zurückgemeldet, die Daten sind trotzdem gespeichert. */
async function printBon(db: Exec, b: BonRecord, reprint = false): Promise<{ printed: boolean; printError?: string }> {
  const twoCopies = !reprint && (b.kind === 'empties' || b.v.empties.length > 0);
  const copies = reprint ? (['reprint'] as const) : twoCopies ? (['driver', 'ours'] as const) : (['single'] as const);
  try {
    await printJobs(db, await Promise.all(copies.map((c) => bon(db, b, c))));
    return { printed: true };
  } catch (e) {
    if (reprint) throw e;
    return { printed: false, printError: e instanceof Error ? e.message : 'Druckfehler' };
  }
}

export async function addReceipt(db: Db, actor: Actor, v: StockReceiptInput): Promise<StockSaveResult> {
  const b = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'stock_receipt', 'WE', v.date);
    await insert(tx, actor, 'in', { date: v.date, partner: v.supplier, ref: v.ref || number, note: v.note }, v.lines);
    await insert(tx, actor, 'empty_return', { date: v.date, partner: v.supplier, ref: number, note: v.note }, v.empties);
    const rec: BonRecord = { kind: 'receipt', v, number };
    await record(tx, actor, { action: 'create', entity: 'stock_receipt', entityId: number, after: rec });
    return rec;
  });
  return { number: b.number, ...(v.print ? await printBon(db, b) : { printed: false }) };
}

export async function addEmpties(db: Db, actor: Actor, v: StockEmptiesInput): Promise<StockSaveResult> {
  const b = await db.transaction(async (tx) => {
    const number = await nextNumber(tx, 'stock_empties', 'LG', v.date);
    await insert(tx, actor, 'empty_return', { date: v.date, partner: v.supplier, ref: number, note: v.note }, v.lines);
    const rec: BonRecord = { kind: 'empties', v, number };
    await record(tx, actor, { action: 'create', entity: 'stock_empties', entityId: number, after: rec });
    return rec;
  });
  return { number: b.number, ...(v.print ? await printBon(db, b) : { printed: false }) };
}

export async function reprint(db: Db, actor: Actor, auditId: number) {
  const [row] = await db.select().from(auditLog).where(and(eq(auditLog.id, auditId), inArray(auditLog.entity, BON_ENTITIES), eq(auditLog.action, 'create')));
  if (!row) throw notFound('Bon');
  const b = row.after as BonRecord;
  if (!b || typeof b !== 'object' || !('number' in b) || !('v' in b)) throw notFound('Bon');
  try { await printBon(db, b, true); } catch (e) { throw e instanceof AppError ? e : new AppError(502, 'printer_failed', 'Druckfehler'); }
  await record(db, actor, { action: 'reprint', entity: row.entity, entityId: b.number });
  return { ok: true };
}

/** Fehleintrag stornieren – die Zeile bleibt sichtbar (durchgestrichen). */
export async function voidMove(db: Db, actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(stockMoves).where(eq(stockMoves.id, id)).for('update');
    if (!row) throw notFound('Eintrag');
    if (row.voidedAt) throw conflict('Dieser Eintrag ist bereits storniert', 'already_voided');
    await tx.update(stockMoves).set({ voidedAt: new Date(), voidedBy: actor.userName }).where(and(eq(stockMoves.id, id), isNull(stockMoves.voidedAt)));
    await record(tx, actor, { action: 'void', entity: 'stock_move', entityId: id, before: dto(row) });
    return { ok: true };
  });
}
