import { and, eq } from 'drizzle-orm';
import type { Db, Exec } from '../db/client.js';
import { offerItems, services, taxRates } from '../db/schema.js';
import { record, type Actor } from './audit.js';

/**
 * Prüfung der Steuersätze nach dem Stand der Recherche vom 18.11.2026 (Quellen in der Oberfläche):
 * Übernachtung 7 %; Speisen in Restaurant und Hotel (auch Frühstück) seit 1.1.2026 7 %; Getränke 19 %.
 * Es wird nichts automatisch geändert – nur auf Knopfdruck des Administrators.
 */
export interface TaxFinding { kind: 'service' | 'offer_item'; id: string; name: string; ratePercent: number; suggestPercent: number; reason: string }
export interface TaxCheck { lodgingPercent: number | null; findings: TaxFinding[]; has7: boolean; has19: boolean }

const FOOD = /fr(ü|ue)hst(ü|ue)ck|buffet|men(ü|ue)|essen|speise|halbpension|vollpension|lunch|dinner|kaffeepause|snack|kuchen|torte/i;
const DRINK = /getr(ä|ae)nk|wein|bier|sekt|kaffee(?!pause)|minibar|softdrink|wasser/i;

export async function check(db: Exec): Promise<TaxCheck> {
  const rates = await db.select().from(taxRates);
  const pct = new Map(rates.map((r) => [r.id, Number(r.ratePercent)]));
  const findings: TaxFinding[] = [];
  for (const s of await db.select().from(services).where(eq(services.active, true))) {
    const p = pct.get(s.taxRateId) ?? 0;
    if ((s.isBreakfast || FOOD.test(s.name)) && !DRINK.test(s.name) && p !== 7)
      findings.push({ kind: 'service', id: s.id, name: s.name, ratePercent: p, suggestPercent: 7, reason: 'Speise (z. B. Frühstück): seit 1.1.2026 in der Regel 7 %' });
  }
  for (const i of await db.select().from(offerItems).where(eq(offerItems.active, true))) {
    const p = Number(i.taxRatePercent);
    // gemischte Pauschalen (Speisen + Getränke, z. B. Tagungspauschale) nicht automatisch vorschlagen – dort muss aufgeteilt werden
    if (FOOD.test(i.name) && !DRINK.test(`${i.name} ${i.description}`) && !/pauschal/i.test(i.name) && p !== 7)
      findings.push({ kind: 'offer_item', id: i.id, name: i.name, ratePercent: p, suggestPercent: 7, reason: 'Speise im Angebotskatalog: seit 1.1.2026 in der Regel 7 %' });
  }
  const lodging = rates.find((r) => r.defaultFor === 'lodging');
  return { lodgingPercent: lodging ? Number(lodging.ratePercent) : null, findings, has7: rates.some((r) => r.active && Number(r.ratePercent) === 7), has19: rates.some((r) => r.active && Number(r.ratePercent) === 19) };
}

/** Ausgewählte Vorschläge übernehmen (Administrator). Bereits gebuchte Leistungen und Rechnungen behalten ihren Satz. */
export async function apply(db: Db, actor: Actor, ids: string[]) {
  return db.transaction(async (tx) => {
    const c = await check(tx);
    const chosen = c.findings.filter((f) => ids.includes(f.id));
    // ein aktiver 7-%-Satz für Speisen (vorhandenen nutzen, sonst „Speisen (ermäßigt)“ anlegen)
    let [rate] = await tx.select().from(taxRates).where(and(eq(taxRates.ratePercent, 7), eq(taxRates.active, true)));
    if (!rate && chosen.some((f) => f.kind === 'service')) [rate] = await tx.insert(taxRates).values({ name: 'Speisen (ermäßigt)', ratePercent: 7, defaultFor: null }).returning();
    for (const f of chosen) {
      if (f.kind === 'service') await tx.update(services).set({ taxRateId: rate!.id, updatedAt: new Date() }).where(eq(services.id, f.id));
      else await tx.update(offerItems).set({ taxRatePercent: 7, updatedAt: new Date() }).where(eq(offerItems.id, f.id));
    }
    await record(tx, actor, { action: 'tax_adjust', entity: 'tax_rate', after: { changed: chosen.map((f) => `${f.name}: ${f.ratePercent} % → 7 %`) } });
    return { changed: chosen.length };
  });
}
