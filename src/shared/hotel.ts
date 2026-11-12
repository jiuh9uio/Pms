import { z } from 'zod';

// ---------- Datum (immer 'JJJJ-MM-TT', Anreise inklusive, Abreise exklusive) ----------
const DAY = 86_400_000;
const utc = (s: string) => new Date(s + 'T00:00:00Z');
export const addDays = (s: string, n: number) => new Date(utc(s).getTime() + n * DAY).toISOString().slice(0, 10);
export const diffDays = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / DAY);
export const weekdayOf = (s: string) => utc(s).getUTCDay();
export const eachNight = (from: string, to: string) => Array.from({ length: Math.max(0, diffDays(from, to)) }, (_, i) => addDays(from, i));
export const todayBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export const isIsoDate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(utc(s).getTime()) && utc(s).toISOString().slice(0, 10) === s;

// ---------- Status ----------
export const ROOM_STATUSES = ['tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];
export const STATUS_LABEL: Record<RoomStatus, string> = {
  tentative: 'Vorläufig', confirmed: 'Bestätigt', checked_in: 'Eingecheckt', checked_out: 'Ausgecheckt', cancelled: 'Storniert', no_show: 'Nicht angereist',
};
/** Erlaubte Statuswechsel */
export const TRANSITIONS: Record<RoomStatus, RoomStatus[]> = {
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'tentative', 'cancelled', 'no_show'],
  checked_in: ['checked_out', 'confirmed'],
  checked_out: ['checked_in'],
  cancelled: ['confirmed'],
  no_show: ['confirmed'],
};
export const isActiveStatus = (s: RoomStatus) => s !== 'cancelled' && s !== 'no_show';

export const SERVICE_PER = ['stay', 'night', 'person', 'person_night'] as const;
export type ServicePer = (typeof SERVICE_PER)[number];
export const PER_LABEL: Record<ServicePer, string> = { stay: 'pro Aufenthalt', night: 'pro Nacht', person: 'pro Person', person_night: 'pro Person und Nacht' };
export const perFactor = (per: ServicePer, nights: number, persons: number) =>
  ({ stay: 1, night: nights, person: persons, person_night: nights * persons })[per];

export const RULE_MODES = ['percent', 'amount', 'fixed'] as const;
export const MODE_LABEL: Record<(typeof RULE_MODES)[number], string> = { percent: 'Prozent (+/−)', amount: 'Betrag (+/−) in €', fixed: 'Festpreis in €' };
export const SOURCES = ['Direkt', 'Telefon', 'E-Mail', 'Website', 'Booking.com', 'Walk-in', 'Firma'];
export const PAYMENT_METHODS = ['Bar', 'Karte', 'Überweisung', 'Rechnung an Firma'];

// ---------- Geld ----------
export const formatMoney = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
/** „89,50“ → 8950; ungültig → NaN */
export const parseMoney = (s: string) => {
  const t = s.trim().replace(/\s|€/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  return t === '' || !/^-?\d+(\.\d{1,2})?$/.test(t) ? NaN : Math.round(Number(t) * 100);
};
export const moneyInput = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2).replace('.', ','));

// ---------- Eingabeschemas ----------
const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');
const isoDate = z.string().refine(isIsoDate, 'Ungültiges Datum');
const cents = z.number('Bitte einen Betrag eingeben').int('Ungültiger Betrag').min(0, 'Mindestens 0').max(10_000_000, 'Betrag zu hoch');
const count = (min: number, max: number) => z.number('Bitte eine Zahl eingeben').int('Ganze Zahl').min(min, `Mindestens ${min}`).max(max, `Höchstens ${max}`);
const version = z.number().int();
const period = <T extends { from: string; to: string }>(v: T) => v.from < v.to && diffDays(v.from, v.to) <= 365;
const PERIOD_MSG = { message: 'Abreise muss nach der Anreise liegen (höchstens 365 Nächte)', path: ['to'] };

export const categoryInput = z.object({
  name: required(80), description: text(300), stdOccupancy: count(1, 20), maxPersons: count(1, 20), basePriceCents: cents, sort: count(0, 999),
}).refine((v) => v.maxPersons >= v.stdOccupancy, { message: 'Darf nicht kleiner als die Standardbelegung sein', path: ['maxPersons'] });
export const roomInput = z.object({
  number: required(20), categoryId: z.uuid('Bitte wählen'), floor: text(20), note: text(300), active: z.boolean(), priceOverrideCents: cents.nullable(),
});
/** Mehrere Zimmer einer Kategorie auf einmal anlegen: fortlaufende Nummern ab firstNumber */
export const roomBulkInput = z.object({
  categoryId: z.uuid('Bitte wählen'), count: count(1, 50), firstNumber: count(1, 99_999), floor: text(20),
});
export const rateRuleInput = z.object({
  name: required(80), startDate: isoDate, endDate: isoDate, weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  categoryId: z.uuid().nullable(), mode: z.enum(RULE_MODES), value: z.number('Bitte eine Zahl eingeben').min(-100_000).max(100_000),
  priority: count(0, 999), active: z.boolean(),
}).refine((v) => v.startDate <= v.endDate, { message: 'Ende liegt vor dem Beginn', path: ['endDate'] })
  .refine((v) => v.mode !== 'fixed' || v.value >= 0, { message: 'Festpreis darf nicht negativ sein', path: ['value'] });
export const serviceInput = z.object({
  name: required(80), priceCents: cents, per: z.enum(SERVICE_PER), taxRateId: z.uuid('Bitte wählen'), isBreakfast: z.boolean(), active: z.boolean(),
});
export const guestInput = z.object({
  salutation: z.enum(['', 'Herr', 'Frau']), firstName: text(80), lastName: required(80), company: text(120),
  email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]), phone: text(60),
  street: text(), zip: text(20), city: text(), country: text(80),
  birthdate: z.union([isoDate, z.literal('').transform(() => null), z.null()]), nationality: text(80), idNumber: text(60), notes: text(2000),
});
export type GuestInput = z.infer<typeof guestInput>;
export const GUEST_EMPTY = {
  salutation: '' as '' | 'Herr' | 'Frau', firstName: '', lastName: '', company: '', email: '', phone: '', street: '', zip: '', city: '',
  country: 'Deutschland', birthdate: '' as string | null, nationality: '', idNumber: '', notes: '',
};

export const blockInput = z.object({ roomId: z.uuid('Bitte wählen'), from: isoDate, to: isoDate, reason: text(200) }).refine(period, PERIOD_MSG);
export const blockUpdateInput = z.object({ roomId: z.uuid(), from: isoDate, to: isoDate, reason: text(200), version }).refine(period, PERIOD_MSG);

const bookingRoomBase = z.object({
  roomId: z.uuid('Bitte ein Zimmer wählen'), from: isoDate, to: isoDate, adults: count(1, 20), children: count(0, 20),
  /** null = Preis automatisch nach Preisregeln */
  pricePerNightCents: cents.nullable(),
});
export const bookingRoomInput = bookingRoomBase.extend({ status: z.enum(['tentative', 'confirmed']) }).refine(period, PERIOD_MSG);
export const bookingCreateInput = z.object({
  guestId: z.uuid().optional(), guest: guestInput.optional(),
  groupName: text(120), source: text(60), paymentMethod: text(60), notes: text(2000),
  rooms: z.array(bookingRoomInput).min(1, 'Mindestens ein Zimmer').max(30),
  breakfast: z.boolean(),
}).refine((v) => !!v.guestId || !!v.guest, { message: 'Bitte einen Gast wählen oder anlegen', path: ['guest'] });
export const bookingUpdateInput = z.object({
  guestId: z.uuid().optional(), groupName: text(120).optional(), source: text(60).optional(), paymentMethod: text(60).optional(), notes: text(2000).optional(), version,
});
export const bookingRoomUpdateInput = z.object({
  roomId: z.uuid().optional(), from: isoDate.optional(), to: isoDate.optional(), adults: count(1, 20).optional(), children: count(0, 20).optional(),
  /** Zahl = manueller Preis je Nacht, null = neu nach Preisregeln berechnen, weggelassen = bisherige Preise behalten */
  pricePerNightCents: cents.nullable().optional(), version,
});
export const statusInput = z.object({ status: z.enum(ROOM_STATUSES), version });
export const chargeInput = z.object({
  serviceId: z.uuid().optional(), bookingRoomId: z.uuid().optional(),
  name: text(120).optional(), unitPriceCents: cents.optional(), taxRateId: z.uuid().optional(),
  quantity: z.number('Bitte eine Zahl eingeben').positive('Größer als 0').max(10_000).optional(),
}).refine((v) => !!v.serviceId || (!!v.name && v.unitPriceCents !== undefined && !!v.taxRateId), { message: 'Leistung wählen oder Bezeichnung, Preis und Steuersatz angeben', path: ['name'] });

// ---------- Antworttypen ----------
export interface CategoryDto { id: string; name: string; description: string; stdOccupancy: number; maxPersons: number; basePriceCents: number; sort: number; version: number }
export interface RoomDto { id: string; number: string; categoryId: string; categoryName: string; floor: string; note: string; active: boolean; priceOverrideCents: number | null; priceCents: number; version: number }
export interface FreeRoomDto extends RoomDto { quoteCents: number }
export interface RateRuleDto { id: string; name: string; startDate: string; endDate: string; weekdays: number[]; categoryId: string | null; mode: 'percent' | 'amount' | 'fixed'; value: number; priority: number; active: boolean; version: number }
export interface ServiceDto { id: string; name: string; priceCents: number; per: ServicePer; taxRateId: string; taxRatePercent: number; isBreakfast: boolean; active: boolean; version: number }
export interface GuestDto extends Omit<GuestInput, 'birthdate'> { id: string; birthdate: string | null; version: number; stays?: number; lastStay?: string | null }
export interface NightDto { date: string; priceCents: number; taxRatePercent: number; source: string }
export interface BookingRoomDto {
  id: string; bookingId: string; allocationId: string; roomId: string; roomNumber: string; categoryName: string; from: string; to: string; nights: number;
  status: RoomStatus; adults: number; children: number; priceManual: boolean; lodgingCents: number; version: number;
  checkedInAt: string | null; checkedOutAt: string | null; nightly?: NightDto[];
}
export interface ChargeDto { id: string; bookingRoomId: string | null; name: string; quantity: number; unitPriceCents: number; taxRatePercent: number; totalCents: number }
export interface BookingDto {
  id: string; number: string; groupName: string; source: string; paymentMethod: string; notes: string; version: number; createdAt: string;
  guest: GuestDto; rooms: BookingRoomDto[]; charges: ChargeDto[];
  lodgingCents: number; chargesCents: number; totalCents: number;
}
export interface BookingListRow extends BookingRoomDto { number: string; guestId: string; guestName: string; groupName: string; source: string; roomCount: number }
export interface CalendarEntry {
  allocationId: string; roomId: string; from: string; to: string; kind: 'stay' | 'block'; version: number;
  bookingRoomId?: string; bookingId?: string; status?: RoomStatus; guestName?: string; number?: string;
  blockId?: string; reason?: string;
}
export interface CalendarDto { from: string; days: number; rooms: RoomDto[]; entries: CalendarEntry[] }
export interface TaskDto { kind: 'arrival' | 'departure' | 'overdue_arrival' | 'overdue_departure' | 'tentative'; text: string; bookingId: string; bookingRoomId: string }
export interface DashboardDto {
  today: string; rooms: { total: number; occupied: number; free: number; blocked: number; occupancyPercent: number };
  arrivals: BookingListRow[]; departures: BookingListRow[]; inHouse: number;
  revenueTodayCents: number; revenueMonthCents: number; tasks: TaskDto[];
}
