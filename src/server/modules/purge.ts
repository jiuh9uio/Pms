import { eq, sql } from 'drizzle-orm';
import { todayBerlin } from '../../shared/hotel.js';
import type { PurgeInput, PurgeResult } from '../../shared/schemas.js';
import { getBackupStatus, runBackup } from '../backup.js';
import type { Db, Tx } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { record, type Actor } from './audit.js';

/** Tabellen, die sonst per Trigger gegen Ändern und Löschen geschützt sind */
const PROTECTED = ['invoices', 'invoice_lines', 'payments', 'invoice_documents'];
class DryRun extends Error { constructor(public result: PurgeResult) { super('dry run'); } }

const count = async (tx: Tx, q: ReturnType<typeof sql>) => Number(((await tx.execute(q))[0] as { n: number }).n);
const del = (tx: Tx, q: ReturnType<typeof sql>) => count(tx, sql`with d as (${q} returning 1) select count(*)::int as n from d`);

async function work(tx: Tx, v: PurgeInput): Promise<Omit<PurgeResult, 'dryRun' | 'backupFile'>> {
  const r = { invoices: 0, payments: 0, einvoices: 0, bookings: 0, keptBookings: 0, blocks: 0, guests: 0 };
  const today = todayBerlin();
  if (v.billing) {
    // Der Schutz wird nur innerhalb dieser Transaktion aufgehoben; scheitert etwas, bleibt alles wie zuvor.
    for (const t of PROTECTED) await tx.execute(sql.raw(`alter table "${t}" disable trigger user`));
    await tx.execute(sql`delete from card_terminal_log`);
    r.einvoices = await del(tx, sql`delete from einvoices where invoice_id is not null`);
    await tx.execute(sql`delete from invoice_documents`);
    r.payments = await del(tx, sql`delete from payments`);
    await tx.execute(sql`delete from invoice_lines`);
    r.invoices = await del(tx, sql`delete from invoices`);
    for (const t of PROTECTED) await tx.execute(sql.raw(`alter table "${t}" enable trigger user`));
    if (v.resetNumbers) await tx.execute(sql`delete from number_sequences where key = 'invoice'`);
  }
  if (v.bookings !== 'none') {
    const all = v.bookings === 'all';
    // vergangen = kein Zimmer der Buchung reist heute oder später ab
    await tx.execute(sql`create temp table purge_candidates on commit drop as
      select b.id from bookings b where ${all} or not exists (
        select 1 from booking_rooms br join room_allocations a on a.id = br.allocation_id where br.booking_id = b.id and upper(a.period) >= ${today}::date)`);
    // Buchungen mit Rechnungen oder Zahlungen bleiben, solange diese nicht mit gelöscht werden
    await tx.execute(sql`create temp table purge_ids on commit drop as
      select c.id from purge_candidates c where not exists (select 1 from invoices i where i.booking_id = c.id) and not exists (select 1 from payments p where p.booking_id = c.id)`);
    await tx.execute(sql`create temp table purge_allocs on commit drop as select allocation_id as id from booking_rooms where booking_id in (select id from purge_ids)`);
    r.bookings = await del(tx, sql`delete from bookings where id in (select id from purge_ids)`);
    r.keptBookings = (await count(tx, sql`select count(*)::int as n from purge_candidates`)) - r.bookings;
    await tx.execute(sql`delete from room_allocations where id in (select id from purge_allocs)`);
    r.blocks = await del(tx, sql`delete from room_allocations where kind = 'block' and (${all} or not active or upper(period) < ${today}::date)`);
    await tx.execute(sql`drop table purge_candidates, purge_ids, purge_allocs`);
    if (all && v.resetNumbers && (await count(tx, sql`select count(*)::int as n from bookings`)) === 0) await tx.execute(sql`delete from number_sequences where key = 'booking'`);
  }
  if (v.guests) r.guests = await del(tx, sql`delete from guests g where not exists (select 1 from bookings b where b.guest_id = g.id)`);
  return r;
}

/**
 * Hotel-Daten löschen (Rechnungen/Zahlungen, Buchungen, Gäste) – gedacht zum Aufräumen von Probedaten vor dem echten Betrieb.
 * dryRun zählt nur (alles wird zurückgerollt). Der echte Lauf verlangt das Passwort und schreibt vorher eine Datensicherung.
 */
export async function purge(db: Db, actor: Actor, v: PurgeInput): Promise<PurgeResult> {
  if (!v.billing && v.bookings === 'none' && !v.guests) throw new AppError(400, 'validation', 'Bitte auswählen, was gelöscht werden soll');
  let backupFile: string | null = null;
  if (!v.dryRun) {
    const [user] = await db.select().from(users).where(eq(users.id, actor.userId!));
    if (!user || !(await verifyPassword(v.password, user.passwordHash))) throw new AppError(400, 'validation', 'Eingaben prüfen', { password: 'Das Passwort stimmt nicht' });
    if (v.confirm !== 'LÖSCHEN') throw new AppError(400, 'validation', 'Eingaben prüfen', { confirm: 'Bitte das Wort LÖSCHEN eintippen' });
    // ohne geglückte Sicherung wird nicht gelöscht (nur die Windows-Version hat die eingebaute Sicherung)
    if (getBackupStatus().supported) backupFile = runBackup().last?.file ?? null;
  }
  try {
    return await db.transaction(async (tx) => {
      const r = { ...(await work(tx, v)), dryRun: v.dryRun, backupFile };
      if (v.dryRun) throw new DryRun(r);
      await record(tx, actor, { action: 'purge', entity: 'program', after: { auswahl: { rechnungen: v.billing, buchungen: v.bookings, gaeste: v.guests, nummernNeu: v.resetNumbers }, geloescht: r } });
      return r;
    });
  } catch (e) {
    if (e instanceof DryRun) return e.result;
    throw e;
  }
}
