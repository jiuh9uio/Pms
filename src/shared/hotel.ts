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
  singleDiscountCents: cents.default(0), extraAdultCents: cents.default(0), extraChildCents: cents.default(0),
  /** Nachlass je Nacht ab so vielen Nächten; 0 = aus */
  longStayNights: z.number('Bitte eine Zahl eingeben').int().min(0).max(60).default(0), longStayDiscountCents: cents.default(0),
}).refine((v) => v.longStayNights !== 1, { message: 'Bitte mindestens 2 Nächte (oder 0 für keinen Nachlass)', path: ['longStayNights'] })
  .refine((v) => v.longStayDiscountCents <= v.basePriceCents, { message: 'Darf nicht höher als der Grundpreis sein', path: ['longStayDiscountCents'] }).refine((v) => v.singleDiscountCents <= v.basePriceCents, { message: 'Darf nicht höher als der Grundpreis sein', path: ['singleDiscountCents'] }).refine((v) => v.maxPersons >= v.stdOccupancy, { message: 'Darf nicht kleiner als die Standardbelegung sein', path: ['maxPersons'] });
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
  guestId: z.uuid().optional(), guest: guestInput.optional(), companyId: z.uuid().optional(),
  groupName: text(120), source: text(60), paymentMethod: text(60), notes: text(2000),
  rooms: z.array(bookingRoomInput).min(1, 'Mindestens ein Zimmer').max(30),
  breakfast: z.boolean(),
  /** Optionsfrist für vorläufige Reservierungen */
  optionUntil: z.union([isoDate, z.literal('').transform(() => null), z.null()]).optional(),
}).refine((v) => !!v.guestId || !!v.guest, { message: 'Bitte einen Gast wählen oder anlegen', path: ['guest'] });
export const bookingUpdateInput = z.object({
  guestId: z.uuid().optional(), companyId: z.uuid().nullable().optional(), groupName: text(120).optional(), source: text(60).optional(), paymentMethod: text(60).optional(), notes: text(2000).optional(), optionUntil: z.union([isoDate, z.literal('').transform(() => null), z.null()]).optional(), version,
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
export interface CategoryDto extends PersonPricing { longStayNights: number; longStayDiscountCents: number; id: string; name: string; description: string; maxPersons: number; basePriceCents: number; sort: number; version: number }
/** Personenabhängige Preisbestandteile einer Kategorie, je Nacht in Cent (brutto). */
export interface PersonPricing { stdOccupancy: number; singleDiscountCents: number; extraAdultCents: number; extraChildCents: number }
/**
 * Auf- oder Abschlag je Nacht nach Personenzahl: eine Person allein in einem Mehrbettzimmer erhält den Einzelbelegungs-Nachlass;
 * jede Person über der Standardbelegung kostet den Aufpreis – dabei zählen zuerst die Kinder als zusätzliche Personen.
 */
export function personAdjust(c: PersonPricing, adults: number, children: number): { cents: number; label: string } {
  const persons = adults + children;
  if (persons === 1 && c.stdOccupancy > 1 && c.singleDiscountCents > 0) return { cents: -c.singleDiscountCents, label: 'Einzelbelegung' };
  const extra = Math.max(0, persons - c.stdOccupancy);
  const kids = Math.min(children, extra);
  const cents = (extra - kids) * c.extraAdultCents + kids * c.extraChildCents;
  return { cents, label: cents > 0 ? (extra === 1 ? 'Zusatzperson' : `${extra} Zusatzpersonen`) : '' };
}
export interface RoomDto { id: string; number: string; categoryId: string; categoryName: string; floor: string; note: string; active: boolean; priceOverrideCents: number | null; priceCents: number; housekeeping: 'clean' | 'dirty'; version: number }
/** quoteCents gilt für die Standardbelegung; pricing = Zu-/Abschläge der Kategorie (null bei Firmenpreis: fester Preis). */
export interface FreeRoomDto extends RoomDto { quoteCents: number; pricing: PersonPricing | null }
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
  /** Optionsfrist (nur bei vorläufigen Reservierungen von Bedeutung) */
  optionUntil: string | null;
  /** vom Gast über seinen Link mitgeteilt */
  arrivalTime: string; guestMessage: string;
  companyId: string | null; companyName: string | null;
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
export interface TaskDto { kind: 'arrival' | 'departure' | 'overdue_arrival' | 'overdue_departure' | 'tentative' | 'cleaning' | 'option'; text: string; bookingId: string; bookingRoomId: string }
export interface HousekeepingRow { roomId: string; number: string; categoryName: string; arrivalToday: string | null; occupied: boolean }
export interface DashboardDto {
  today: string; rooms: { total: number; occupied: number; free: number; blocked: number; occupancyPercent: number };
  arrivals: BookingListRow[]; departures: BookingListRow[]; inHouse: number;
  revenueTodayCents: number; revenueMonthCents: number; tasks: TaskDto[];
  dirty: HousekeepingRow[];
}

// ---------- Firmen ----------
export const companyInput = z.object({
  name: required(160), street: text(), zip: text(20), city: text(), country: text(80), vatId: text(40),
  contactName: text(120), email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]), phone: text(60),
  paymentTermDays: z.number('Bitte eine Zahl eingeben').int().min(0, 'Mindestens 0').max(120, 'Höchstens 120').nullable(),
  notes: text(2000), active: z.boolean(),
  /** vereinbarte Preise je Kategorie (brutto je Nacht); nicht aufgeführte Kategorien zum normalen Preis */
  rates: z.array(z.object({ categoryId: z.uuid(), priceCents: cents })).max(50),
});
export type CompanyInput = z.infer<typeof companyInput>;
export interface CompanyDto extends CompanyInput { id: string; version: number; bookingCount: number; lastStay: string | null; revenueCents: number }

// ---------- E-Mail an den Gast ----------
export const mailSendInput = z.object({ to: z.email('Ungültige E-Mail-Adresse'), subject: required(200), text: required(8000) });
/** Vorschlag für eine E-Mail; ready = der Versand ist in der Verwaltung eingerichtet. */
export interface MailDraft { to: string; subject: string; text: string; attachment: string | null; ready: boolean }

// ---------- Auswertung ----------
export interface ReportRow { nights: number; available: number; occupancyPercent: number; lodgingCents: number; invoicedCents: number; invoices: number }
export interface YearReport { year: number; rooms: number; months: (ReportRow & { month: number })[]; total: ReportRow }

// ---------- Online-Meldeschein (QR-Code) ----------
const pastDate = z.string().refine(isIsoDate, 'Bitte ein Datum wählen').refine((d) => d < todayBerlin() && d > '1900-01-01', 'Bitte das Geburtsdatum prüfen');
/** Was der Gast selbst einträgt. */
export const guestFormInput = z.object({
  firstName: required(80), lastName: required(80), birthdate: pastDate, nationality: required(80),
  street: required(200), zip: required(20), city: required(200), country: required(80), idNumber: text(60),
  companions: z.number('Bitte eine Zahl eingeben').int().min(0, 'Mindestens 0').max(20, 'Höchstens 20'),
});
export type GuestFormInput = z.infer<typeof guestFormInput>;
/** Öffentliche Ansicht für den Gast – bewusst ohne gespeicherte Adress- oder Ausweisdaten. */
export interface GuestFormPublic { hotelName: string; number: string; from: string; to: string; firstName: string; lastName: string; submitted: boolean }
export interface GuestFormLink { exists: boolean; url: string | null; qr: string | null; expiresAt: string | null; submittedAt: string | null; localOnly: boolean }

// ---------- Frühstücksliste und Küchendrucker ----------
export interface BreakfastRow { bookingId: string; room: string; guest: string; adults: number; children: number; bookingNumber: string; notes: string; departing: boolean; breakfast: boolean; arrived: boolean }
/** Frühstücksregel („Algorithmus“): Wenn die Messgröße die Bedingung erfüllt, gilt der Text – z. B. „Frühstück in der 1. Etage“. */
export const RULE_MEASURES = ['breakfast_persons', 'breakfast_rooms', 'house_persons', 'house_rooms'] as const;
export const RULE_MEASURE_LABEL: Record<(typeof RULE_MEASURES)[number], string> = {
  breakfast_persons: 'Frühstücksgäste (Personen)', breakfast_rooms: 'Zimmer mit Frühstück', house_persons: 'Gäste im Haus (Personen)', house_rooms: 'belegte Zimmer',
};
export const RULE_OPS = ['lt', 'lte', 'gte', 'gt'] as const;
export const RULE_OP_LABEL: Record<(typeof RULE_OPS)[number], string> = { lt: 'weniger als', lte: 'höchstens', gte: 'mindestens', gt: 'mehr als' };
export const breakfastRuleInput = z.object({
  name: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(60),
  measure: z.enum(RULE_MEASURES), op: z.enum(RULE_OPS), value: z.number('Bitte eine Zahl eintragen').int().min(0).max(999),
  /** leer = jeden Tag; 0 = Sonntag … 6 = Samstag */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  text: z.string().trim().min(1, 'Bitte eintragen, was dann gilt').max(200),
  active: z.boolean(),
});
export const breakfastRulesInput = z.object({ rules: z.array(breakfastRuleInput).max(30) });
export type BreakfastRule = z.infer<typeof breakfastRuleInput>;
/** Erste zutreffende Regel in der eingetragenen Reihenfolge. Ohne Frühstücksgäste gilt keine Regel. */
export function applyBreakfastRules(rules: BreakfastRule[], date: string, n: Record<(typeof RULE_MEASURES)[number], number>): BreakfastRule | null {
  if (n.breakfast_persons === 0) return null;
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return rules.find((r) => {
    if (!r.active || (r.weekdays.length && !r.weekdays.includes(wd))) return false;
    const x = n[r.measure];
    return r.op === 'lt' ? x < r.value : r.op === 'lte' ? x <= r.value : r.op === 'gte' ? x >= r.value : x > r.value;
  }) ?? null;
}
/** Vorschau für die Planung: je Tag Frühstücksgäste und geltende Regel */
export interface BreakfastDay { date: string; persons: number; rooms: number; variant: string | null }
export interface BreakfastDto { /** zutreffende Frühstücksregel des Tages */ variant: { name: string; text: string } | null; date: string; rooms: BreakfastRow[]; printerReady: boolean; /** Uhrzeit des täglichen automatischen Drucks, leer = aus */ autoTime: string; /** Tag, für den zuletzt automatisch gedruckt wurde */ autoLast: string | null; total: { rooms: number; adults: number; children: number; without: number } }
export const kitchenPrinterInput = z.object({
  enabled: z.boolean(), host: z.string().trim().max(15).regex(/^(\d{1,3}(\.\d{1,3}){3})?$/, 'IP-Adresse im Format 192.168.1.50'),
  port: count(1, 65535), width: z.union([z.literal(32), z.literal(42), z.literal(48)]),
  /** Frühstücksliste täglich um diese Uhrzeit von selbst drucken; leer = nur auf Knopfdruck */
  autoBreakfastTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Uhrzeit im Format HH:MM').default(''),
});
export type KitchenPrinter = z.infer<typeof kitchenPrinterInput>;

// ---------- Nachricht vor der Anreise (Einstellungen → Algorithmen → Gäste-E-Mail) ----------
export const prearrivalInput = z.object({
  enabled: z.boolean(),
  /** so viele Tage vor der Anreise */
  daysBefore: z.number('Bitte eine Zahl eingeben').int().min(1).max(14),
  /** frühestens zu dieser Uhrzeit */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM'),
  /** eigener Zusatztext, z. B. Anfahrt, Parken, Schlüsselübergabe bei später Anreise */
  extraText: z.string().trim().max(2000),
});
export type PrearrivalSettings = z.infer<typeof prearrivalInput>;
export interface PrearrivalState { settings: PrearrivalSettings; mailReady: boolean; /** Beispieltext mit erfundenen Angaben */ sample: { subject: string; text: string }; lastRun: string | null; sentTotal: number; dueNow: number }

// ---------- Belegungsvorschau ----------
export interface ForecastDay {
  date: string; occupied: number; tentative: number; blocked: number; free: number; arrivals: number; departures: number; occupancyPercent: number;
  /** freie Zimmer je Kategorie (Reihenfolge wie categories) */
  freeByCategory: number[];
}
export interface ForecastDto { from: string; rooms: number; categories: { id: string; name: string; rooms: number }[]; days: ForecastDay[] }

// ---------- Statistik ----------
export interface OriginRow { country: string; arrivals: number; nights: number }
export interface OriginStats { year: number; month: number; rows: OriginRow[]; total: { arrivals: number; nights: number }; beds: number; openDays: number; bedOccupancyPercent: number }
export interface SourceRow { source: string; bookings: number; nights: number; lodgingCents: number }
export interface SourceStats { year: number; rows: SourceRow[] }

// ---------- Doppelte Gäste ----------
export interface GuestDuplicate { keep: GuestDto; other: GuestDto; reason: string }
export const guestMergeInput = z.object({ otherId: z.uuid() });

// ---------- Stornobedingungen und Gäste-Link ----------
export const cancelPolicyInput = z.object({
  /** Bedingungen anwenden und anzeigen */
  enabled: z.boolean(),
  /** kostenfrei stornierbar bis so viele Tage vor der Anreise */
  freeDays: z.number('Bitte eine Zahl eingeben').int().min(0).max(365),
  /** danach: Anteil des Zimmerpreises in Prozent */
  feePercent: z.number('Bitte eine Zahl eingeben').int().min(0).max(100),
  /** Gäste dürfen über ihren Link selbst stornieren */
  online: z.boolean(),
  /** … auch nach Ablauf der kostenfreien Frist (dann mit Hinweis auf die Ausfallgebühr) */
  onlineLate: z.boolean(),
  /** Adresse, unter der Gäste das Programm im Internet erreichen (leer = Link nicht in E-Mails aufnehmen) */
  publicUrl: z.union([z.literal(''), z.url('Bitte eine Adresse wie https://hotel.example.de eintragen')]).default(''),
  extraText: z.string().trim().max(600),
});
export type CancelPolicy = z.infer<typeof cancelPolicyInput>;
/** Stand der Bedingungen für eine bestimmte Reservierung */
export interface CancelTerms { enabled: boolean; freeUntil: string | null; free: boolean; feePercent: number; feeCents: number; text: string }
export const cancelFreeUntil = (arrival: string, freeDays: number) => addDays(arrival, -freeDays);
export function cancelTerms(p: CancelPolicy, arrival: string, lodgingCents: number, today: string): CancelTerms {
  if (!p.enabled) return { enabled: false, freeUntil: null, free: true, feePercent: 0, feeCents: 0, text: '' };
  const freeUntil = cancelFreeUntil(arrival, p.freeDays), free = today <= freeUntil;
  const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  const text = [`Kostenfreie Stornierung bis einschließlich ${de(freeUntil)}.`, p.feePercent > 0 ? `Danach und bei Nichtanreise berechnen wir ${p.feePercent} % des Zimmerpreises.` : 'Auch danach berechnen wir bei Stornierung nichts.', p.extraText].filter(Boolean).join(' ');
  return { enabled: true, freeUntil, free, feePercent: p.feePercent, feeCents: free ? 0 : Math.round(lodgingCents * p.feePercent / 100), text };
}
export interface GuestLinkDto { url: string; qr: string; /** true = Adresse nur im Hausnetz erreichbar */ localOnly: boolean }
export interface PublicBooking {
  hotelName: string; hotelPhone: string; number: string; guestName: string;
  rooms: { category: string; from: string; to: string; nights: number; adults: number; children: number; status: RoomStatus }[];
  from: string; to: string; totalCents: number;
  state: 'active' | 'cancelled' | 'arrived' | 'past';
  arrivalTime: string; guestMessage: string; checkinTime: string;
  terms: CancelTerms; canCancel: boolean; /** warum nicht online storniert werden kann */ cancelHint: string;
}
export const publicArrivalInput = z.object({ time: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM')]), message: z.string().trim().max(500).default('') });
