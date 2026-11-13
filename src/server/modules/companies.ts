import { eq, sql } from 'drizzle-orm';
import type { CompanyDto, CompanyInput } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { companies, companyRates } from '../db/schema.js';
import { notFound, stale } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { selectRooms } from './bookings.js';

type Raw = Record<string, unknown>;

export async function listCompanies(db: Exec, q = ''): Promise<CompanyDto[]> {
  const like = '%' + q.replace(/[%_\\]/g, '') + '%';
  const rows = await db.execute(sql`
    select c.*,
      (select count(*) from bookings b where b.company_id = c.id)::int as booking_count,
      (select max(upper(a.period))::text from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
        where b.company_id = c.id and br.status in ('checked_in','checked_out')) as last_stay,
      (select coalesce(sum(i.gross_cents), 0) from invoices i join bookings b on b.id = i.booking_id
        where b.company_id = c.id and i.status <> 'draft')::int as revenue_cents
    from companies c
    where ${q ? sql`(c.name ilike ${like} or c.city ilike ${like} or c.contact_name ilike ${like})` : sql`true`}
    order by lower(c.name) limit 300`);
  const rates = await db.select().from(companyRates);
  return Array.from(rows).map((r) => {
    const x = r as Raw;
    return {
      id: x.id as string, name: x.name as string, street: x.street as string, zip: x.zip as string, city: x.city as string, country: x.country as string,
      vatId: x.vat_id as string, contactName: x.contact_name as string, email: x.email as string, phone: x.phone as string,
      paymentTermDays: (x.payment_term_days as number) ?? null, notes: x.notes as string, active: x.active as boolean, version: x.version as number,
      bookingCount: x.booking_count as number, lastStay: (x.last_stay as string) ?? null, revenueCents: x.revenue_cents as number,
      rates: rates.filter((t) => t.companyId === x.id).map((t) => ({ categoryId: t.categoryId, priceCents: t.priceCents })),
    };
  });
}

export async function getCompany(db: Exec, id: string) {
  const c = (await listCompanies(db)).find((x) => x.id === id);
  if (!c) throw notFound('Firma');
  return { company: c, bookings: await selectRooms(db, sql`b.company_id = ${id}`, sql`lower(a.period) desc`, 200) };
}

export async function saveCompany(db: Db, actor: Actor, id: string | null, v: CompanyInput, version?: number) {
  const { rates, ...data } = v;
  return db.transaction(async (tx) => {
    let companyId = id;
    let before: unknown = null;
    if (!id) {
      const [row] = await tx.insert(companies).values(data).returning();
      companyId = row!.id;
    } else {
      const [b] = await tx.select().from(companies).where(eq(companies.id, id)).for('update');
      if (!b) throw notFound('Firma');
      if (b.version !== version) throw stale();
      before = { ...b, rates: await tx.select().from(companyRates).where(eq(companyRates.companyId, id)) };
      await tx.update(companies).set({ ...data, version: b.version + 1, updatedAt: new Date() }).where(eq(companies.id, id));
      await tx.delete(companyRates).where(eq(companyRates.companyId, id));
    }
    const unique = [...new Map(rates.map((r) => [r.categoryId, r])).values()];
    if (unique.length) await tx.insert(companyRates).values(unique.map((r) => ({ ...r, companyId: companyId! })));
    await record(tx, actor, { action: id ? 'update' : 'create', entity: 'company', entityId: companyId, before, after: v });
    return { id: companyId! };
  });
}
