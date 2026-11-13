import { z } from 'zod';
import { isIsoDate } from './hotel.js';

const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const count = (min: number, max: number) => z.number('Bitte eine Zahl eingeben').int('Ganze Zahl').min(min, `Mindestens ${min}`).max(max, `Höchstens ${max}`);

export const TABLE_STATUSES = ['booked', 'seated', 'done', 'cancelled', 'no_show'] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];
export const TABLE_STATUS_LABEL: Record<TableStatus, string> = { booked: 'Reserviert', seated: 'Am Tisch', done: 'Abgeschlossen', cancelled: 'Storniert', no_show: 'Nicht erschienen' };
/** Reservierungen in diesen Zuständen belegen ihren Tisch. */
export const holdsTable = (s: TableStatus) => s === 'booked' || s === 'seated';

export const restaurantTableInput = z.object({ name: required(40), seats: count(1, 200), area: text(60), sort: count(0, 999), active: z.boolean().default(true) });
export const tableReservationInput = z.object({
  date: z.string().refine(isIsoDate, 'Ungültiges Datum'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'),
  durationMin: count(15, 720), persons: count(1, 500), name: required(120), phone: text(60), note: text(500),
  tableId: z.uuid().nullable(),
});
export const tableReservationUpdateInput = tableReservationInput.extend({ version: z.number().int() });
export const tableStatusInput = z.object({ status: z.enum(TABLE_STATUSES), version: z.number().int() });

export interface RestaurantTableDto { id: string; name: string; seats: number; area: string; sort: number; active: boolean; version: number }
export interface TableReservationDto {
  id: string; date: string; time: string; durationMin: number; persons: number; name: string; phone: string; note: string;
  tableId: string | null; tableName: string | null; status: TableStatus; createdBy: string; version: number;
}

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const endTime = (time: string, durationMin: number) => {
  const m = (minutesOf(time) + durationMin) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** Überschneiden sich zwei Reservierungen am selben Tag? (Reservierungen über Mitternacht hinaus zählen bis Tagesende.) */
export const overlaps = (a: { time: string; durationMin: number }, b: { time: string; durationMin: number }) =>
  minutesOf(a.time) < minutesOf(b.time) + b.durationMin && minutesOf(b.time) < minutesOf(a.time) + a.durationMin;
