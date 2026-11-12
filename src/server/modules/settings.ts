import { and, asc, eq, ne } from 'drizzle-orm';
import { HOTEL_DEFAULTS, type HotelSettings, type TaxRateDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { settings, taxRates } from '../db/schema.js';
import { notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

// ---------- Hotel-Stammdaten ----------
export async function getHotel(db: Exec): Promise<HotelSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'hotel'));
  return { ...HOTEL_DEFAULTS, ...((row?.value as Partial<HotelSettings>) ?? {}) };
}

export async function saveHotel(db: Db, actor: Actor, value: HotelSettings) {
  return db.transaction(async (tx) => {
    const before = await getHotel(tx);
    await tx.insert(settings).values({ key: 'hotel', value })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await record(tx, actor, { action: 'update', entity: 'settings', entityId: 'hotel', before, after: value });
    return value;
  });
}

// ---------- Steuersätze ----------
type TaxRow = typeof taxRates.$inferSelect;
const toDto = (r: TaxRow): TaxRateDto => ({ id: r.id, name: r.name, ratePercent: r.ratePercent, defaultFor: r.defaultFor, active: r.active, version: r.version });

export async function listTaxRates(db: Exec) {
  return (await db.select().from(taxRates).orderBy(asc(taxRates.ratePercent), asc(taxRates.name))).map(toDto);
}

/** Je Verwendung (Übernachtung / Leistungen) gibt es höchstens einen Standardsatz. */
async function clearDefault(tx: Exec, defaultFor: 'lodging' | 'services', exceptId?: string) {
  await tx.update(taxRates).set({ defaultFor: null, updatedAt: new Date() })
    .where(and(eq(taxRates.defaultFor, defaultFor), exceptId ? ne(taxRates.id, exceptId) : undefined));
}

export async function createTaxRate(db: Db, actor: Actor, input: { name: string; ratePercent: number; defaultFor: 'lodging' | 'services' | null }) {
  return db.transaction(async (tx) => {
    if (input.defaultFor) await clearDefault(tx, input.defaultFor);
    const [row] = await tx.insert(taxRates).values(input).returning();
    await record(tx, actor, { action: 'create', entity: 'tax_rate', entityId: row!.id, after: toDto(row!) });
    return toDto(row!);
  });
}

export async function updateTaxRate(
  db: Db, actor: Actor, id: string,
  input: { name?: string; ratePercent?: number; defaultFor?: 'lodging' | 'services' | null; active?: boolean; version: number },
) {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(taxRates).where(eq(taxRates.id, id)).for('update');
    if (!before) throw notFound('Steuersatz');
    if (before.version !== input.version) throw stale();
    const active = input.active ?? before.active;
    // ein deaktivierter Satz kann kein Standard sein
    const defaultFor = !active ? null : input.defaultFor === undefined ? before.defaultFor : input.defaultFor;
    if (defaultFor) await clearDefault(tx, defaultFor, id);
    const [after] = await tx.update(taxRates)
      .set({ name: input.name ?? before.name, ratePercent: input.ratePercent ?? before.ratePercent, defaultFor, active, updatedAt: new Date(), version: before.version + 1 })
      .where(eq(taxRates.id, id)).returning();
    await record(tx, actor, { action: 'update', entity: 'tax_rate', entityId: id, before: toDto(before), after: toDto(after!) });
    return toDto(after!);
  });
}
