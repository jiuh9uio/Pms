import { eq, sql } from 'drizzle-orm';
import { addDays, type BreakfastDto, type KitchenPrinter } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { buildJob, columns, isPrivateIp, sendToPrinter, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { getHotel } from './settings.js';

/** Frühstücksliste des Hotels und Druck auf dem Bondrucker in der Küche. */

const PRINTER_DEFAULT: KitchenPrinter = { enabled: false, host: '', port: 9100, width: 48 };
export async function getPrinter(db: Exec): Promise<KitchenPrinter> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'kitchen_printer'));
  return { ...PRINTER_DEFAULT, ...((row?.value as Partial<KitchenPrinter>) ?? {}) };
}
export async function savePrinter(db: Db, actor: Actor, v: KitchenPrinter) {
  if (v.host && !isPrivateIp(v.host)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { host: 'Bitte die IP-Adresse des Druckers im Hausnetz eintragen, z. B. 192.168.1.50' });
  await db.insert(settings).values({ key: 'kitchen_printer', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'kitchen_printer', after: v });
  return v;
}
const ready = (p: KitchenPrinter) => p.enabled && !!p.host;

async function print(db: Exec, lines: Line[]) {
  const p = await getPrinter(db);
  if (!ready(p)) throw conflict('Der Küchendrucker ist noch nicht eingerichtet (Verwaltung → Einstellungen → Küchendrucker)', 'printer_not_configured');
  try { await sendToPrinter(p.host, p.port, buildJob(lines, p.width)); }
  catch (e) { throw new AppError(502, 'printer_failed', e instanceof Error ? e.message : 'Druckfehler'); }
}

export async function testPrint(db: Exec) {
  const h = await getHotel(db);
  await print(db, [{ text: h.name, align: 'center', bold: true }, { text: 'Testdruck Küchendrucker', align: 'center' }, { rule: true }, { text: 'Umlaute: ä ö ü Ä Ö Ü ß  Euro: €' }, { text: new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) }]);
}

/**
 * Wer frühstückt am Morgen des Tages? Alle Zimmer, die in der Nacht davor belegt sind (Anreise vor dem Tag, Abreise frühestens am Tag),
 * mit der Angabe, ob Frühstück gebucht ist (Leistung mit Kennzeichen „Frühstück“ am Zimmer oder an der ganzen Reservierung).
 */
export async function breakfastList(db: Exec, date: string): Promise<BreakfastDto> {
  const rows = await db.execute(sql`
    select r.number as room, trim(g.first_name || ' ' || g.last_name) as guest, br.adults, br.children, br.status, b.id as booking_id, b.number, b.notes,
      upper(a.period) = ${date}::date as departing,
      exists (select 1 from charges c join services s on s.id = c.service_id
              where c.booking_id = b.id and s.is_breakfast and (c.booking_room_id = br.id or c.booking_room_id is null)) as breakfast
    from booking_rooms br
    join room_allocations a on a.id = br.allocation_id join rooms r on r.id = a.room_id
    join bookings b on b.id = br.booking_id join guests g on g.id = b.guest_id
    where br.status in ('confirmed', 'checked_in', 'checked_out') and lower(a.period) < ${date}::date and upper(a.period) >= ${date}::date
    order by r.number`);
  const list = Array.from(rows).map((x) => ({
    bookingId: x.booking_id as string, room: x.room as string, guest: x.guest as string, adults: x.adults as number, children: x.children as number, bookingNumber: x.number as string,
    notes: x.notes as string, departing: x.departing as boolean, breakfast: x.breakfast as boolean, arrived: x.status !== 'confirmed',
  }));
  const with_ = list.filter((r) => r.breakfast);
  return {
    date, rooms: list, printerReady: ready(await getPrinter(db)),
    total: { rooms: with_.length, adults: with_.reduce((s, r) => s + r.adults, 0), children: with_.reduce((s, r) => s + r.children, 0), without: list.length - with_.length },
  };
}

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

export function breakfastLines(d: BreakfastDto, hotelName: string, width: number): Line[] {
  const persons = d.total.adults + d.total.children;
  const lines: Line[] = [
    { text: hotelName, align: 'center' }, { text: 'FRÜHSTÜCK', align: 'center', bold: true, big: true },
    { text: `${WEEKDAY[new Date(`${d.date}T12:00:00Z`).getUTCDay()]}, ${de(d.date)}`, align: 'center', bold: true }, { rule: true },
  ];
  const rows = d.rooms.filter((r) => r.breakfast);
  if (rows.length === 0) lines.push({ text: 'Kein Frühstück gebucht.' });
  for (const r of rows) {
    const count = `${r.adults} Erw.${r.children ? ` + ${r.children} Ki.` : ''}`;
    lines.push({ text: columns(`Zi. ${r.room}  ${r.guest}`, count, width), bold: true });
    const info = [r.departing ? 'reist heute ab' : '', !r.arrived ? 'noch nicht angereist' : '', r.notes].filter(Boolean).join(' · ');
    if (info) lines.push({ text: `  ${info}`.slice(0, width * 2) });
  }
  lines.push({ rule: true }, { text: columns('Gesamt', `${persons} ${persons === 1 ? 'Person' : 'Personen'}`, width), bold: true, big: false });
  lines.push({ text: columns(`${d.total.rooms} Zimmer`, `${d.total.adults} Erw. / ${d.total.children} Ki.`, width) });
  if (d.total.without) lines.push({ text: `${d.total.without} belegte${d.total.without === 1 ? 's' : ''} Zimmer ohne Frühstück` });
  lines.push({ feed: 1 }, { text: `Gedruckt ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`, align: 'center' });
  return lines;
}

export async function printBreakfast(db: Db, actor: Actor, date: string) {
  const [d, h, p] = [await breakfastList(db, date), await getHotel(db), await getPrinter(db)];
  await print(db, breakfastLines(d, h.name, p.width));
  await record(db, actor, { action: 'print', entity: 'breakfast', entityId: date, after: { rooms: d.total.rooms, persons: d.total.adults + d.total.children } });
  return { ok: true, date: addDays(date, 0) };
}
