import { and, eq } from 'drizzle-orm';
import { addDays, todayBerlin } from '../../shared/hotel.js';
import { holdsTable } from '../../shared/restaurant.js';
import { hasModule, type OverviewItem, type Role } from '../../shared/schemas.js';
import type { Db } from '../db/client.js';
import { tableReservations } from '../db/schema.js';
import { openSummary } from './billing.js';
import { dashboard } from './bookings.js';
import { breakfastList } from './breakfast.js';
import { listAreas, listCleaningTasks, openToday } from './controls.js';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** „Heute im Haus“ für das Startmenü: das Wichtigste des Tages aus den Bereichen, die der Benutzer sehen darf. */
export async function overview(db: Db, user: { role: Role; modules: string[] }): Promise<OverviewItem[]> {
  const today = todayBerlin();
  const out: OverviewItem[] = [];
  if (hasModule(user, 'hotel')) {
    const [d, bf, open] = await Promise.all([dashboard(db), breakfastList(db, addDays(today, 1)), openSummary(db)]);
    out.push({ key: 'arrivals', label: 'Anreisen heute', value: String(d.arrivals.length), sub: d.arrivals.length ? 'noch nicht eingecheckt' : 'keine offen', to: '/hotel', tone: 'neutral' });
    out.push({ key: 'departures', label: 'Abreisen heute', value: String(d.departures.length), sub: d.departures.length ? 'noch nicht ausgecheckt' : 'keine offen', to: '/hotel', tone: 'neutral' });
    out.push({ key: 'inhouse', label: 'Belegte Zimmer', value: `${d.rooms.occupied} / ${d.rooms.total}`, sub: `${d.rooms.free} frei`, to: '/plan', tone: 'neutral' });
    const persons = bf.total.adults + bf.total.children;
    out.push({ key: 'breakfast', label: 'Frühstück morgen', value: String(persons), sub: persons ? plural(bf.total.rooms, 'Zimmer', 'Zimmer') : 'keines gebucht', to: '/fruehstueck', tone: 'neutral' });
    if (open.overdue > 0) out.push({ key: 'overdue', label: 'Überfällige Rechnungen', value: String(open.overdue), sub: 'Zahlungsziel überschritten', to: '/rechnungen', tone: 'warn' });
  }
  if (hasModule(user, 'restaurant')) {
    const rows = (await db.select().from(tableReservations).where(and(eq(tableReservations.date, today)))).filter((r) => holdsTable(r.status));
    out.push({ key: 'tables', label: 'Tischreservierungen heute', value: String(rows.length), sub: rows.length ? plural(rows.reduce((s, r) => s + r.persons, 0), 'Person', 'Personen') : 'keine', to: '/restaurant', tone: 'neutral' });
  }
  if (hasModule(user, 'kontrollen')) {
    const [temps, tasks, areas] = await Promise.all([openToday(db), listCleaningTasks(db), listAreas(db)]);
    const configured = areas.filter((a) => a.active).reduce((n, a) => n + a.points.filter((p) => p.active).length, 0);
    const points = temps.reduce((s, a) => s + a.points.length, 0);
    const cleaning = tasks.filter((t) => t.active && t.due && !t.doneToday).length;
    out.push(configured === 0
      ? { key: 'temps', label: 'Temperaturen heute', value: '–', sub: 'noch keine Messstellen eingerichtet', to: '/kontrollen', tone: 'neutral' }
      : { key: 'temps', label: 'Temperaturen heute', value: points ? String(points) : '✓', sub: points ? 'Messstellen noch offen' : 'alles eingetragen', to: '/kontrollen', tone: points ? 'warn' : 'ok' });
    if (cleaning > 0) out.push({ key: 'cleaning', label: 'Reinigung fällig', value: String(cleaning), sub: plural(cleaning, 'Aufgabe offen', 'Aufgaben offen').replace(/^\d+ /, ''), to: '/kontrollen', tone: 'warn' });
  }
  return out;
}
