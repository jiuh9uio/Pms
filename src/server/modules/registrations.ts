import { sql } from 'drizzle-orm';
import { todayBerlin, type RegistrationRow } from '../../shared/hotel.js';
import type { Exec } from '../db/client.js';

/** Jahr dazuzählen (29.02. → 28.02.) */
const addYears = (d: string, n: number) => { const y = Number(d.slice(0, 4)) + n; const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5); return `${y}-${md}`; };
const addMonths = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00Z`); const day = dt.getUTCDate();
  dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + n);
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  dt.setUTCDate(Math.min(day, last));
  return dt.toISOString().slice(0, 10);
};

/**
 * Meldeschein-Archiv: je Reservierung mit Check-in eine Zeile. Die Angaben kommen aus Reservierung und Gästeprofil
 * (so, wie der Meldeschein gedruckt wird) – es wird keine eigene Kopie gespeichert.
 * Frist: § 30 Abs. 4 BMG – ein Jahr ab Anreise aufbewahren, danach innerhalb von drei Monaten vernichten.
 */
export async function listRegistrations(db: Exec, f: { from?: string; to?: string; q: string; expired: '0' | '1' }): Promise<RegistrationRow[]> {
  const today = todayBerlin();
  const q = f.q ? `%${f.q}%` : null;
  const rows = await db.execute(sql`
    select b.id, b.number, g.first_name, g.last_name, g.birthdate::text as birthdate, g.nationality, g.id_number, g.street, g.zip, g.city, g.country,
      min(lower(a.period))::text as "from", max(upper(a.period))::text as "to", min(br.checked_in_at) as checked_in_at,
      string_agg(distinct r.number, ', ' order by r.number) as rooms, sum(br.adults + br.children)::int as persons,
      max(gf.submitted_at) as online_at
    from booking_rooms br
    join bookings b on b.id = br.booking_id
    join guests g on g.id = b.guest_id
    join room_allocations a on a.id = br.allocation_id
    join rooms r on r.id = a.room_id
    left join guest_forms gf on gf.booking_id = b.id
    where br.checked_in_at is not null and br.status in ('checked_in', 'checked_out')
      ${q ? sql`and (g.last_name ilike ${q} or g.first_name ilike ${q} or b.number ilike ${q} or g.city ilike ${q} or r.number ilike ${q})` : sql``}
    group by b.id, g.id
    having true
      ${f.from ? sql`and min(lower(a.period)) >= ${f.from}::date` : sql``}
      ${f.to ? sql`and min(lower(a.period)) <= ${f.to}::date` : sql``}
      ${f.expired === '1' ? sql`and min(lower(a.period)) < (${today}::date - interval '1 year')` : sql``}
    order by min(lower(a.period)) desc, b.number desc
    limit 500`) as unknown as Record<string, unknown>[];
  return rows.map((r) => {
    const from = String(r.from);
    const missing = [
      ...(!(r.street && r.zip && r.city) ? ['Anschrift'] : []), ...(!r.birthdate ? ['Geburtsdatum'] : []), ...(!r.nationality ? ['Staatsangehörigkeit'] : []),
    ];
    const keepUntil = addYears(from, 1);
    return {
      bookingId: String(r.id), number: String(r.number), guest: [r.first_name, r.last_name].filter(Boolean).join(' '),
      birthdate: (r.birthdate as string | null) ?? null, nationality: String(r.nationality ?? ''), city: String(r.city ?? ''), country: String(r.country ?? ''),
      rooms: String(r.rooms ?? ''), from, to: String(r.to), checkedInAt: new Date(r.checked_in_at as string).toISOString(), persons: Number(r.persons ?? 0),
      onlineAt: r.online_at ? new Date(r.online_at as string).toISOString() : null, missing,
      keepUntil, destroyBy: addMonths(keepUntil, 3),
      purged: keepUntil < today && !r.birthdate && !r.nationality && !r.id_number,
    };
  });
}

// ---------- Automatisch löschen nach Ablauf der Aufbewahrungsfrist ----------
import { eq as eqOp } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { settings as settingsTable } from '../db/schema.js';
import { record, type Actor } from './audit.js';

export interface RegistrationPurge { enabled: boolean; lastRun: string | null; lastGuests: number }
const PKEY = 'registration_purge';
const SYSTEM: Actor = { userId: null, userName: 'Automatisch (Meldeschein-Frist)', ip: null };
export async function getRegistrationPurge(db: Exec): Promise<RegistrationPurge> {
  const [row] = await db.select().from(settingsTable).where(eqOp(settingsTable.key, PKEY));
  return { enabled: true, lastRun: null, lastGuests: 0, ...((row?.value as Partial<RegistrationPurge>) ?? {}) };
}
async function putPurge(db: Exec, v: RegistrationPurge) {
  await db.insert(settingsTable).values({ key: PKEY, value: v }).onConflictDoUpdate({ target: settingsTable.key, set: { value: v, updatedAt: new Date() } });
}
export async function setRegistrationPurge(db: Db, actor: Actor, enabled: boolean) {
  const cur = await getRegistrationPurge(db);
  await putPurge(db, { ...cur, enabled });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: PKEY, after: { enabled } });
  return { ...cur, enabled };
}

/**
 * Meldeschein-Angaben löschen, deren Aufbewahrungsfrist (ein Jahr ab Anreise) abgelaufen ist: Geburtsdatum,
 * Staatsangehörigkeit und Ausweisnummer im Gästeprofil – nur bei Gästen ohne laufende/künftige Reservierung und ohne
 * Anreise innerhalb des letzten Jahres. Name und Anschrift bleiben (Rechnungen, Reservierungen). In älteren
 * Protokolleinträgen dieser Gäste, die solche Angaben enthalten, wird der Inhalt anonymisiert (wie beim Anonymisieren).
 * Ein Meldeschein auf Papier muss weiterhin von Hand vernichtet werden.
 */
export async function purgeExpiredRegistrations(db: Db, now = new Date()): Promise<{ guests: number }> {
  const cfg = await getRegistrationPurge(db);
  if (!cfg.enabled) return { guests: 0 };
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const limit = addYears(today, -1);
  const idData = (col: 'before' | 'after') => sql.raw(`(coalesce(l.${col}->>'birthdate', '') <> '' or coalesce(l.${col}->>'idNumber', '') <> '' or coalesce(l.${col}->>'nationality', '') <> '')`);
  // Gäste mit Meldeschein-Angaben im Profil oder noch im Änderungsprotokoll,
  //  - ohne laufende oder künftige Reservierung (alte, nie abgeschlossene Reservierungen zählen nicht),
  //  - ohne Anreise (auch stornierte) innerhalb des letzten Jahres,
  //  - Gäste ganz ohne Reservierung: seit mehr als einem Jahr angelegt.
  const ids = (await db.execute(sql`
    select g.id from guests g
    where ((g.birthdate is not null or g.nationality <> '' or g.id_number <> '')
        or exists (select 1 from audit_log l where l.entity = 'guest' and l.entity_id = g.id::text and (${idData('before')} or ${idData('after')})))
      and (g.created_at < ${limit}::date or exists (select 1 from bookings b where b.guest_id = g.id))
      and not exists (select 1 from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
        where b.guest_id = g.id and br.status in ('tentative', 'confirmed', 'checked_in') and upper(a.period) >= ${today}::date)
      and not exists (select 1 from bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
        where b.guest_id = g.id and lower(a.period) >= ${limit}::date)
    limit 500`) as unknown as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    await db.transaction(async (tx) => {
      for (const id of ids) {
        await tx.execute(sql`update guests set birthdate = null, nationality = '', id_number = '', version = version + 1, updated_at = now() where id = ${id}`);
        // alle Protokolleinträge dieses Gastes mit Meldeschein-Angaben (auch jüngere Änderungen, z. B. der E-Mail-Adresse)
        await tx.execute(sql`select set_config('pms.audit_scrub', ${id}, true)`);
        await tx.execute(sql`update audit_log set
            before = case when before is null then null else '{"anonymisiert": true}'::jsonb end,
            after = case when after is null then null else '{"anonymisiert": true}'::jsonb end
          where entity = 'guest' and entity_id = ${id}
            and (coalesce(before->>'birthdate', '') <> '' or coalesce(after->>'birthdate', '') <> '' or coalesce(before->>'idNumber', '') <> '' or coalesce(after->>'idNumber', '') <> ''
              or coalesce(before->>'nationality', '') <> '' or coalesce(after->>'nationality', '') <> '')`);
        await tx.execute(sql`select set_config('pms.audit_scrub', '', true)`);
      }
      await record(tx, SYSTEM, { action: 'purge_registrations', entity: 'guest', after: { gaeste: ids.length, frist: limit } });
    });
  }
  // abgelaufene Links zum Online-Meldeschein (enthalten keine Gästedaten) aufräumen
  await db.execute(sql`delete from guest_forms gf using bookings b join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
    where gf.booking_id = b.id and upper(a.period) < ${limit}::date`);
  await putPurge(db, { ...cfg, lastRun: now.toISOString(), lastGuests: ids.length });
  return { guests: ids.length };
}
export function startRegistrationPurgeScheduler(db: Db) {
  const run = () => void purgeExpiredRegistrations(db).catch((e) => console.error('Meldescheine löschen:', e instanceof Error ? e.message : e));
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 3600_000).unref();
}
