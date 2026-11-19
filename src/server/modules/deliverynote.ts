import { and, desc, eq, sql } from 'drizzle-orm';
import type { DeliveryNoteDto, DeliveryNoteInput, DeliveryOverviewDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { auditLog, numberSequences, settings } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { columns, wrap, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { bonTarget, preview, printJobs } from './quickprint.js';
import { getHotel } from './settings.js';
import { recordDelivery } from './stock.js';

/**
 * Lieferschein auf dem Bondrucker – z. B. für Fassbier, das zu einer Feier geliefert wird.
 * Keine eigene Tabelle: die Nummer kommt aus der vorhandenen Nummernfolge (Schlüssel „delivery_note“),
 * der Inhalt jedes Lieferscheins steht im Änderungsprotokoll (daraus kommen Liste und Nachdruck).
 * Ein Lieferschein ist keine Rechnung und kein Kassenbeleg.
 */

export const ARTICLES_DEFAULT = ['Pils – Fass 50 l', 'Hefe – Fass 20 l', 'Kupfer – Fass 30 l'];
const KEY = 'delivery_articles';

export async function getArticles(db: Exec): Promise<string[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return Array.isArray(row?.value) ? (row.value as string[]) : ARTICLES_DEFAULT;
}
export async function saveArticles(db: Db, actor: Actor, articles: string[]) {
  const v = [...new Set(articles.map((a) => a.trim()).filter(Boolean))];
  await db.insert(settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: KEY, after: v });
  return v;
}

const de = (d: string) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const center = (t: string, w: number, o: { bold?: boolean; big?: boolean } = {}): Line[] => wrap(t, o.big ? Math.floor(w / 2) : w).map((text) => ({ text, align: 'center' as const, ...o }));

type Copy = 'recipient' | 'sign' | 'single' | 'reprint';
async function makeLines(db: Exec, n: DeliveryNoteInput & { number: string }, copy: Copy) {
  const h = await getHotel(db);
  const address = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const total = n.lines.reduce((s, l) => s + l.qty, 0);
  return (w: number): Line[] => [
    ...center(h.name, w, { bold: true }), ...(address ? center(address, w) : []), ...(h.phone ? center(`Telefon: ${h.phone}`, w) : []),
    { rule: true, char: '=' },
    ...center('LIEFERSCHEIN', w, { bold: true, big: true }),
    ...(copy === 'reprint' ? center('– Nachdruck –', w, { bold: true }) : []),
    { rule: true, char: '=' },
    { text: columns('Nr.', n.number, w), bold: true },
    { text: columns('Lieferdatum', de(n.date), w) },
    ...(n.returnBy ? [{ text: columns('Leergut zurück bis', de(n.returnBy), w) } as Line] : []),
    { feed: 1 }, { text: 'Empfänger', bold: true },
    ...wrap(n.recipient, w).map((text) => ({ text })),
    ...n.address.split('\n').flatMap((a) => wrap(a, w)).filter(Boolean).map((text) => ({ text })),
    { rule: true },
    { text: columns('Ware', 'Menge', w), bold: true },
    { rule: true },
    ...n.lines.flatMap((l) => {
      const q = `${l.qty} x`;
      const parts = wrap(l.article, w - q.length - 1);
      return parts.map((p, i) => ({ text: i === 0 ? columns(p, q, w) : p }));
    }),
    { rule: true },
    { text: columns('Stück gesamt', String(total), w), bold: true },
    ...(n.note ? [{ feed: 1 } as Line, { text: 'Hinweis', bold: true } as Line, ...n.note.split('\n').flatMap((a) => wrap(a, w)).map((text) => ({ text }))] : []),
    { feed: 1 },
    ...(copy === 'recipient' ? center('Exemplar für den Empfänger', w)
      : [{ text: 'Ware vollständig und einwandfrei erhalten:' } as Line, { feed: 2 }, { text: '_'.repeat(w) } as Line, { text: 'Datum, Unterschrift' } as Line, { feed: 2 },
        { text: '_'.repeat(w) } as Line, { text: 'Name in Druckbuchstaben' } as Line,
        ...(copy === 'sign' ? [{ feed: 1 } as Line, ...center('Exemplar für uns – bitte unterschrieben zurück', w)] : [])]),
    { feed: 1 }, ...center('Kein Kassenbeleg – die Rechnung folgt gesondert.', w),
  ];
}

/** Welche Exemplare: 1 = eines zum Unterschreiben; 2 = Empfänger + zum Unterschreiben; 3 = zusätzlich ein weiteres zum Unterschreiben. */
const copiesFor = (n: number): Copy[] => (n === 1 ? ['single'] : n === 2 ? ['recipient', 'sign'] : ['recipient', 'sign', 'sign']);

export async function overview(db: Exec): Promise<DeliveryOverviewDto> {
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, 'delivery_note'), eq(auditLog.action, 'print'))).orderBy(desc(auditLog.id)).limit(30);
  const recent = rows.map((r) => ({ ...(r.after as DeliveryNoteInput & { number: string }), auditId: r.id, userName: r.userName, printedAt: r.at.toISOString() }));
  const t = await bonTarget(db);
  const w = t?.printer.width ?? 48;
  const sample = await makeLines(db, { number: 'LS-2026-0001', recipient: 'Beispiel: Musterverein e. V.', address: 'Musterstraße 1\n12345 Musterstadt', date: '2026-01-01', returnBy: '2026-01-03', lines: [{ qty: 2, article: ARTICLES_DEFAULT[0]! }, { qty: 1, article: ARTICLES_DEFAULT[2]! }], note: '', copies: 1 }, 'single');
  return { articles: await getArticles(db), recent, preview: preview(sample(w), w) };
}

/** Vergibt die nächste Nummer, druckt und protokolliert. Schlägt der Druck fehl, wird die Nummer nicht verbraucht. */
export async function create(db: Db, actor: Actor, v: DeliveryNoteInput) {
  return db.transaction(async (tx) => {
    const year = Number(v.date.slice(0, 4));
    const [seq] = await tx.insert(numberSequences).values({ key: 'delivery_note', year, last: 1 })
      .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
    const number = `LS-${year}-${String(seq!.last).padStart(4, '0')}`;
    const note = { ...v, number };
    await printJobs(tx, await Promise.all(copiesFor(v.copies).map((c) => makeLines(tx, note, c))));
    await record(tx, actor, { action: 'print', entity: 'delivery_note', entityId: number, after: note });
    // Ware ist jetzt beim Kunden – erscheint unter Einkauf → Leergut als offen
    await recordDelivery(tx, actor, { date: v.date, recipient: v.recipient, number, note: v.note, lines: v.lines });
    return { number };
  });
}

export async function reprint(db: Db, actor: Actor, auditId: number) {
  const [row] = await db.select().from(auditLog).where(and(eq(auditLog.id, auditId), eq(auditLog.entity, 'delivery_note'), eq(auditLog.action, 'print')));
  if (!row) throw notFound('Lieferschein');
  const note = row.after as DeliveryNoteInput & { number: string };
  await printJobs(db, [await makeLines(db, note, 'reprint')]);
  await record(db, actor, { action: 'reprint', entity: 'delivery_note', entityId: note.number });
  return { ok: true };
}
