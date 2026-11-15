import { eq, sql } from 'drizzle-orm';
import { FLOOR_PLAN_DEFAULT, type FloorPlan, type FloorPlanDto, type PlanRoom, type RoomPlanStatus } from '../../shared/floorplan.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { record, type Actor } from './audit.js';

/** Etagenplan: Lage-Einstellungen lesen/speichern und den Zimmerstatus eines Tages aus den bestehenden Belegungen ermitteln (nur lesend). */
export async function getFloorPlan(db: Exec): Promise<FloorPlan> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'floor_plan'));
  return row ? { ...FLOOR_PLAN_DEFAULT, ...(row.value as Partial<FloorPlan>) } : FLOOR_PLAN_DEFAULT;
}
export async function saveFloorPlan(db: Db, actor: Actor, v: FloorPlan) {
  await db.insert(settings).values({ key: 'floor_plan', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'floor_plan', after: { flure: v.corridors.length } });
  return getFloorPlan(db);
}

/**
 * Status je Zimmer für eine Nacht (date): Sperre/stillgelegt → gesperrt, eingecheckt → belegt, bestätigt/vorläufig → reserviert, sonst frei.
 * Grundlage sind dieselben Belegungen (room_allocations), mit denen Belegungsplan und Buchung arbeiten.
 */
export async function floorPlanStatus(db: Exec, date: string): Promise<FloorPlanDto> {
  const rows = await db.execute(sql`
    select r.id, r.number, r.floor, r.active, r.housekeeping, c.name as category,
      x.kind, x.status, x.booking_id, x.guest, x.reason, lower(x.period)::text as "from", upper(x.period)::text as "to"
    from rooms r join room_categories c on c.id = r.category_id
    left join lateral (
      select a.kind, a.period, br.status::text as status, b.id as booking_id, trim(coalesce(g.first_name, '') || ' ' || coalesce(g.last_name, '')) as guest, rb.reason
      from room_allocations a
      left join booking_rooms br on br.allocation_id = a.id
      left join bookings b on b.id = br.booking_id
      left join guests g on g.id = b.guest_id
      left join room_blocks rb on rb.allocation_id = a.id
      where a.room_id = r.id and a.active and a.period @> ${date}::date
      order by (a.kind = 'block') desc limit 1) x on true
    order by r.number`) as unknown as Record<string, unknown>[];
  const rooms: PlanRoom[] = rows.map((x) => {
    const status: RoomPlanStatus = !x.active || x.kind === 'block' ? 'blocked'
      : x.status === 'checked_in' ? 'occupied'
      : x.status === 'confirmed' || x.status === 'tentative' ? 'reserved' : 'free';
    return {
      id: String(x.id), number: String(x.number), category: String(x.category), floor: String(x.floor ?? ''), status,
      bookingId: status === 'occupied' || status === 'reserved' ? String(x.booking_id) : null, guest: String(x.guest ?? ''),
      from: (x.from as string | null) ?? null, to: (x.to as string | null) ?? null,
      blockNote: !x.active ? 'Zimmer ist nicht aktiv' : x.kind === 'block' ? String(x.reason ?? '') || 'Zimmersperre' : '',
      housekeeping: (x.housekeeping === 'dirty' ? 'dirty' : 'clean') as PlanRoom['housekeeping'],
    };
  }).sort((a, b) => a.number.localeCompare(b.number, 'de', { numeric: true }));
  return { date, plan: await getFloorPlan(db), rooms };
}
