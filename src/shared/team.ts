import { z } from 'zod';

export const NOTE_KINDS = ['note', 'task', 'repair'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export const NOTE_KIND_LABEL: Record<NoteKind, string> = { note: 'Übergabe', task: 'Aufgabe', repair: 'Reparatur' };
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ungültiges Datum');
export const teamNoteInput = z.object({
  kind: z.enum(NOTE_KINDS), text: z.string().trim().min(1, 'Bitte einen Text eintragen').max(2000),
  place: z.string().trim().max(80).default(''), dueDate: z.union([isoDate, z.literal('').transform(() => null), z.null()]).default(null),
});
export const teamDoneInput = z.object({ done: z.boolean(), note: z.string().trim().max(500).default('') });
export const teamListQuery = z.object({ view: z.enum(['open', 'note', 'task', 'repair', 'done']).default('open') });
export interface TeamNoteDto {
  id: string; kind: NoteKind; text: string; place: string; dueDate: string | null; status: 'open' | 'done';
  createdBy: string; createdAt: string; doneBy: string; doneAt: string | null; doneNote: string;
  /** wer den Eintrag gelesen hat (ohne die Verfasserin oder den Verfasser) */
  readBy: string[]; readByMe: boolean; mine: boolean; overdue: boolean;
}
export interface TeamState { unread: number; openTasks: number }

// ---------- Reinigungsliste ----------
export type CleanKind = 'departure' | 'stay' | 'arrival' | 'free';
export const CLEAN_KIND_LABEL: Record<CleanKind, string> = { departure: 'Abreise', stay: 'Bleibt', arrival: 'Anreise', free: 'frei' };
export interface CleanRow {
  roomId: string; room: string; floor: string; category: string; housekeeping: 'clean' | 'dirty';
  /** was heute mit dem Zimmer passiert: reist jemand ab, bleibt jemand, reist jemand an */
  departing: boolean; staying: boolean; arriving: boolean; guest: string; persons: number; nextGuest: string; nextPersons: number; note: string;
}
export interface CleanList { date: string; rows: CleanRow[]; total: { departures: number; stays: number; arrivals: number; dirty: number } }

// ---------- Tagesabschluss ----------
export interface DayReport {
  date: string;
  payments: { method: string; count: number; cents: number }[];
  paymentList: { time: string; method: string; cents: number; payer: string; ref: string; by: string; reversal: boolean }[];
  totalCents: number; cashCents: number;
  invoices: { count: number; cents: number; cancelled: number };
  arrivals: { expected: number; checkedIn: number; open: { room: string; guest: string; bookingId: string }[] };
  departures: { expected: number; checkedOut: number; open: { room: string; guest: string; bookingId: string }[] };
  occupied: number; rooms: number;
}

// ---------- Wiederkehrende Aufgaben ----------
export const REPEATS = ['daily', 'weekly', 'monthly'] as const;
export const REPEAT_LABEL: Record<(typeof REPEATS)[number], string> = { daily: 'täglich', weekly: 'wöchentlich', monthly: 'monatlich' };
export const recurringInput = z.object({
  text: z.string().trim().min(1, 'Bitte eintragen, was zu tun ist').max(500), place: z.string().trim().max(80).default(''),
  repeat: z.enum(REPEATS),
  /** wöchentlich: 0 = Sonntag … 6 = Samstag; monatlich: Tag 1–28 */
  day: z.number('Bitte wählen').int().min(0).max(28),
}).refine((v) => v.repeat !== 'weekly' || v.day <= 6, { message: 'Bitte einen Wochentag wählen', path: ['day'] })
  .refine((v) => v.repeat !== 'monthly' || v.day >= 1, { message: 'Bitte einen Tag von 1 bis 28 wählen', path: ['day'] });
export interface RecurringDto { id: string; text: string; place: string; repeat: (typeof REPEATS)[number]; day: number; lastCreated: string | null }
