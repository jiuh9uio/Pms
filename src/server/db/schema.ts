import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn, bigserial, boolean, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const stamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  /** Zähler gegen gegenseitiges Überschreiben bei gleichzeitiger Bearbeitung */
  version: integer('version').notNull().default(1),
};

/** PostgreSQL-Zeitraum '[Anreise,Abreise)' */
export const daterange = customType<{ data: string }>({ dataType: () => 'daterange' });

// ---------- Benutzer ----------
export const userRole = pgEnum('user_role', ['admin', 'user']);

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull().default('user'),
  active: boolean('active').notNull().default(true),
  /** Bereiche, auf die der Benutzer zugreifen darf (Administratoren dürfen immer alles) */
  modules: text('modules').array().notNull().default(sql`'{hotel,kontrollen}'`),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  /** Zwei-Faktor-Anmeldung: Geheimnis (verschlüsselt); gilt erst, wenn totpEnabled gesetzt ist */
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  /** zuletzt verwendeter Zeitschritt – derselbe Code gilt nicht zweimal */
  totpLastStep: integer('totp_last_step'),
  ...stamps,
});

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

// ---------- Änderungsprotokoll (nur anfügbar, siehe Migration 0001) ----------
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  // bewusst ohne Fremdschlüssel: Einträge bleiben unverändert erhalten
  userId: uuid('user_id'),
  userName: text('user_name').notNull().default(''),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: text('ip'),
}, (t) => [index('audit_at_idx').on(t.at), index('audit_entity_idx').on(t.entity, t.entityId)]);

// ---------- Einstellungen und Steuersätze ----------
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const taxRates = pgTable('tax_rates', {
  id: id(),
  name: text('name').notNull(),
  ratePercent: numeric('rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  /** Vorbelegung für Übernachtungen bzw. für Frühstück/Zusatzleistungen */
  defaultFor: text('default_for', { enum: ['lodging', 'services'] }),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

// ---------- Zimmer (Grundlage für Phase 2) ----------
export const roomCategories = pgTable('room_categories', {
  id: id(),
  name: text('name').notNull().unique(),
  description: text('description').notNull().default(''),
  stdOccupancy: integer('std_occupancy').notNull().default(2),
  maxPersons: integer('max_persons').notNull().default(2),
  /** Grundpreis je Nacht in Cent (brutto) */
  basePriceCents: integer('base_price_cents').notNull().default(0),
  /** Personenabhängige Preise je Nacht (brutto): Nachlass bei Einzelbelegung, Aufpreis je Person über der Standardbelegung */
  singleDiscountCents: integer('single_discount_cents').notNull().default(0),
  extraAdultCents: integer('extra_adult_cents').notNull().default(0),
  extraChildCents: integer('extra_child_cents').notNull().default(0),
  /** Nachlass je Nacht bei längerem Aufenthalt: ab so vielen Nächten (0 = kein Nachlass) */
  longStayNights: integer('long_stay_nights').notNull().default(0),
  longStayDiscountCents: integer('long_stay_discount_cents').notNull().default(0),
  /** derselbe Nachlass, wenn nur eine Person im Zimmer ist (Einzelnutzung eines Mehrbettzimmers) */
  longStaySingleDiscountCents: integer('long_stay_single_discount_cents').notNull().default(0),
  sort: integer('sort').notNull().default(0),
  ...stamps,
});

export const rooms = pgTable('rooms', {
  id: id(),
  number: text('number').notNull().unique(),
  categoryId: uuid('category_id').notNull().references(() => roomCategories.id),
  floor: text('floor').notNull().default(''),
  /** Abweichender Preis nur für dieses Zimmer; leer = Preis der Kategorie */
  priceOverrideCents: integer('price_override_cents'),
  /** Housekeeping: sauber oder zu reinigen */
  housekeeping: text('housekeeping', { enum: ['clean', 'dirty'] }).notNull().default('clean'),
  active: boolean('active').notNull().default(true),
  note: text('note').notNull().default(''),
  ...stamps,
});

/**
 * Jede Belegung eines Zimmers – Aufenthalt oder Sperre. Ein Ausschluss-Constraint (Migration 0001)
 * verhindert in der Datenbank, dass sich zwei aktive Belegungen desselben Zimmers überschneiden.
 */
export const roomAllocations = pgTable('room_allocations', {
  id: id(),
  roomId: uuid('room_id').notNull().references(() => rooms.id),
  period: daterange('period').notNull(),
  kind: text('kind', { enum: ['stay', 'block'] }).notNull(),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

// =====================================================================================
// Phase 2: Preise, Gäste, Reservierungen
// =====================================================================================

const day = (name: string) => date(name, { mode: 'string' });

export const roomBlocks = pgTable('room_blocks', {
  id: id(),
  allocationId: uuid('allocation_id').notNull().unique().references(() => roomAllocations.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull().default(''),
  ...stamps,
});

// ---------- Preise ----------
export const rateRuleMode = pgEnum('rate_rule_mode', ['percent', 'amount', 'fixed']);

/** Preisregel: Saison, Wochenende, Aktion. Wird in Reihenfolge der Priorität auf den Grundpreis angewendet. */
export const rateRules = pgTable('rate_rules', {
  id: id(),
  name: text('name').notNull(),
  startDate: day('start_date').notNull(),
  endDate: day('end_date').notNull(),
  /** 0 = Sonntag … 6 = Samstag; leer = alle Tage */
  weekdays: integer('weekdays').array().notNull().default(sql`'{}'`),
  categoryId: uuid('category_id').references(() => roomCategories.id, { onDelete: 'cascade' }),
  mode: rateRuleMode('mode').notNull(),
  /** Prozent bzw. Betrag in Euro */
  value: numeric('value', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  priority: integer('priority').notNull().default(10),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

export const servicePer = pgEnum('service_per', ['stay', 'night', 'person', 'person_night']);

/** Frühstück und Zusatzleistungen */
export const services = pgTable('services', {
  id: id(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  per: servicePer('per').notNull().default('stay'),
  taxRateId: uuid('tax_rate_id').notNull().references(() => taxRates.id),
  isBreakfast: boolean('is_breakfast').notNull().default(false),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

// ---------- Gäste ----------
export const guests = pgTable('guests', {
  id: id(),
  salutation: text('salutation').notNull().default(''),
  firstName: text('first_name').notNull().default(''),
  lastName: text('last_name').notNull(),
  company: text('company').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  street: text('street').notNull().default(''),
  zip: text('zip').notNull().default(''),
  city: text('city').notNull().default(''),
  country: text('country').notNull().default(''),
  birthdate: day('birthdate'),
  nationality: text('nationality').notNull().default(''),
  idNumber: text('id_number').notNull().default(''),
  notes: text('notes').notNull().default(''),
  ...stamps,
}, (t) => [index('guests_name_idx').on(t.lastName, t.firstName)]);

// ---------- Reservierungen ----------
export const numberSequences = pgTable('number_sequences', {
  key: text('key').notNull(),
  year: integer('year').notNull(),
  last: integer('last').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.key, t.year] })]);

export const bookings = pgTable('bookings', {
  id: id(),
  number: text('number').notNull().unique(),
  guestId: uuid('guest_id').notNull().references(() => guests.id),
  /** Firmenbuchung: vereinbarte Preise und Rechnung an die Firma */
  companyId: uuid('company_id').references((): AnyPgColumn => companies.id),
  groupName: text('group_name').notNull().default(''),
  source: text('source').notNull().default(''),
  paymentMethod: text('payment_method').notNull().default(''),
  notes: text('notes').notNull().default(''),
  /** Zeitpunkt, zu dem die Nachricht vor der Anreise verschickt wurde (höchstens einmal je Reservierung) */
  prearrivalSentAt: ts('prearrival_sent_at'),
  /** Optionsfrist einer vorläufigen Reservierung: bis zu diesem Tag wird das Zimmer freigehalten */
  optionUntil: date('option_until', { mode: 'string' }),
  /** vom Gast über seinen Link mitgeteilt: voraussichtliche Ankunftszeit (HH:MM) und Nachricht */
  arrivalTime: text('arrival_time').notNull().default(''),
  guestMessage: text('guest_message').notNull().default(''),
  /** Gäste-Link: Ausgabe-Nummer (ein neuer Link macht den alten ungültig) und Sperre */
  linkVersion: integer('link_version').notNull().default(0),
  linkBlocked: boolean('link_blocked').notNull().default(false),
  ...stamps,
}, (t) => [index('bookings_guest_idx').on(t.guestId)]);

export const bookingRoomStatus = pgEnum('booking_room_status', ['tentative', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show']);

/** Ein Zimmer innerhalb einer Buchung. Zimmer und Zeitraum stehen in der zugehörigen Belegung (room_allocations). */
export const bookingRooms = pgTable('booking_rooms', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  allocationId: uuid('allocation_id').notNull().unique().references(() => roomAllocations.id),
  /** Preiskategorie zum Zeitpunkt der Buchung */
  categoryId: uuid('category_id').notNull().references(() => roomCategories.id),
  status: bookingRoomStatus('status').notNull().default('confirmed'),
  adults: integer('adults').notNull().default(1),
  children: integer('children').notNull().default(0),
  priceManual: boolean('price_manual').notNull().default(false),
  checkedInAt: ts('checked_in_at'),
  checkedOutAt: ts('checked_out_at'),
  ...stamps,
}, (t) => [index('booking_rooms_booking_idx').on(t.bookingId)]);

/** Preis je Nacht als Kopie zum Buchungszeitpunkt – spätere Preisänderungen wirken hier nicht. */
export const bookingRoomNights = pgTable('booking_room_nights', {
  bookingRoomId: uuid('booking_room_id').notNull().references(() => bookingRooms.id, { onDelete: 'cascade' }),
  date: day('date').notNull(),
  priceCents: integer('price_cents').notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  /** Herkunft des Preises, z. B. „Grundpreis“, „Wochenende“, „manuell“ */
  source: text('source').notNull().default(''),
}, (t) => [primaryKey({ columns: [t.bookingRoomId, t.date] })]);

/** Gebuchte Zusatzleistung (Frühstück, Parkplatz …) mit Preis- und Steuersatz-Kopie */
export const charges = pgTable('charges', {
  id: id(),
  bookingId: uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  bookingRoomId: uuid('booking_room_id').references(() => bookingRooms.id, { onDelete: 'set null' }),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  quantity: numeric('quantity', { precision: 10, scale: 2, mode: 'number' }).notNull().default(1),
  unitPriceCents: integer('unit_price_cents').notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  ...stamps,
}, (t) => [index('charges_booking_idx').on(t.bookingId)]);

// =====================================================================================
// Kontrollen (Hygieneamt, Finanzamt …) und Temperatur-Eigenkontrolle
// =====================================================================================

/** Art einer behördlichen Kontrolle. kind 'hygiene' zeigt zusätzlich die Temperaturprotokolle. */
export const inspectionTypes = pgTable('inspection_types', {
  id: id(),
  name: text('name').notNull().unique(),
  kind: text('kind', { enum: ['hygiene', 'generic'] }).notNull().default('generic'),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Unterlage, die für eine Kontrolle bereitliegen soll */
export const inspectionItems = pgTable('inspection_items', {
  id: id(),
  typeId: uuid('type_id').notNull().references(() => inspectionTypes.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  ready: boolean('ready').notNull().default(false),
  note: text('note').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  ...stamps,
});

/** Stattgefundene Kontrolle */
export const inspectionVisits = pgTable('inspection_visits', {
  id: id(),
  typeId: uuid('type_id').notNull().references(() => inspectionTypes.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  inspector: text('inspector').notNull().default(''),
  result: text('result').notNull().default(''),
  notes: text('notes').notNull().default(''),
  recordedBy: text('recorded_by').notNull().default(''),
  ...stamps,
});

export const hygieneAreas = pgTable('hygiene_areas', {
  id: id(),
  name: text('name').notNull().unique(),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Messstelle, z. B. Kühltruhe, mit Sollbereich in °C */
export const hygienePoints = pgTable('hygiene_points', {
  id: id(),
  areaId: uuid('area_id').notNull().references(() => hygieneAreas.id),
  name: text('name').notNull(),
  minC: numeric('min_c', { precision: 5, scale: 1, mode: 'number' }),
  maxC: numeric('max_c', { precision: 5, scale: 1, mode: 'number' }),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Gemessener Wert: je Messstelle und Tag ein Eintrag; enteredAt zeigt, wann er tatsächlich erfasst wurde. */
export const hygieneReadings = pgTable('hygiene_readings', {
  pointId: uuid('point_id').notNull().references(() => hygienePoints.id),
  date: date('date', { mode: 'string' }).notNull(),
  /** Messwert; leer, wenn nur bestätigt wurde, dass die Messstelle im Sollbereich liegt */
  valueC: numeric('value_c', { precision: 5, scale: 1, mode: 'number' }),
  confirmed: boolean('confirmed').notNull().default(false),
  /** Bemerkung bzw. ergriffene Maßnahme bei Abweichung */
  note: text('note').notNull().default(''),
  userName: text('user_name').notNull(),
  enteredAt: ts('entered_at').notNull().defaultNow(),
  /** Sollbereich, der beim Eintragen galt (spätere Änderungen an der Messstelle ändern die Bewertung alter Werte nicht) */
  minC: numeric('min_c', { precision: 5, scale: 1, mode: 'number' }),
  maxC: numeric('max_c', { precision: 5, scale: 1, mode: 'number' }),
  /** false = Eintrag aus der Zeit vor dieser Speicherung (dann gilt der Sollbereich der Messstelle) */
  rangeSaved: boolean('range_saved').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.pointId, t.date] })]);

// ---------- Reinigungsprotokoll ----------
/** Wiederkehrende Reinigungsaufgabe eines Bereichs, z. B. „Arbeitsflächen desinfizieren“ täglich */
export const cleaningTasks = pgTable('cleaning_tasks', {
  id: id(),
  areaId: uuid('area_id').notNull().references(() => hygieneAreas.id),
  name: text('name').notNull(),
  /** Intervall in Tagen: 1 = täglich, 7 = wöchentlich … */
  intervalDays: integer('interval_days').notNull().default(1),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Erledigte Reinigung: je Aufgabe und Tag ein Eintrag mit Namen und Zeitpunkt */
export const cleaningLog = pgTable('cleaning_log', {
  taskId: uuid('task_id').notNull().references(() => cleaningTasks.id),
  date: date('date', { mode: 'string' }).notNull(),
  userName: text('user_name').notNull(),
  doneAt: ts('done_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.taskId, t.date] })]);

/** EC-Gerät: jeder Zahlungsversuch über die Kassenschnittstelle mit Ausgang – auch abgelehnte und ungeklärte. */
export const cardTerminalLog = pgTable('card_terminal_log', {
  id: id(),
  at: ts('at').notNull().defaultNow(),
  amountCents: integer('amount_cents').notNull(),
  /** approved = gezahlt und gebucht, unrecorded = gezahlt, aber nicht gebucht, declined = nicht gezahlt, unknown = ungeklärt */
  outcome: text('outcome', { enum: ['approved', 'unrecorded', 'declined', 'unknown'] }).notNull(),
  message: text('message').notNull().default(''),
  trace: text('trace').notNull().default(''),
  receiptNo: text('receipt_no').notNull().default(''),
  cardName: text('card_name').notNull().default(''),
  bookingId: uuid('booking_id'),
  invoiceId: uuid('invoice_id'),
  paymentId: uuid('payment_id'),
  userName: text('user_name').notNull(),
}, (t) => [index('card_terminal_log_at_idx').on(t.at)]);

/** Schnelldruck: eigene Info-Zettel (Titel und Text) für den Bondrucker. */
export const printTemplates = pgTable('print_templates', {
  id: id(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  sort: integer('sort').notNull().default(0),
  ...stamps,
});

/** Ausfälle der Internetverbindung des PMS-Rechners (nur Beginn und Ende, erfasst solange das Programm läuft). */
export const netOutages = pgTable('net_outages', {
  id: id(),
  startedAt: ts('started_at').notNull(),
  endedAt: ts('ended_at'),
  /** Ende nicht beobachtet, weil das Programm währenddessen beendet wurde */
  uncertain: boolean('uncertain').notNull().default(false),
});

// ---------- Restaurant: Tische und Tischreservierungen ----------
export const restaurantTables = pgTable('restaurant_tables', {
  id: id(),
  name: text('name').notNull().unique(),
  seats: integer('seats').notNull(),
  /** Raum oder Bereich, z. B. Gaststube, Saal, Terrasse */
  area: text('area').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

export const tableReservations = pgTable('table_reservations', {
  id: id(),
  date: date('date', { mode: 'string' }).notNull(),
  /** Uhrzeit HH:MM und Dauer in Minuten */
  time: text('time').notNull(),
  durationMin: integer('duration_min').notNull().default(120),
  persons: integer('persons').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull().default(''),
  note: text('note').notNull().default(''),
  /** leer = noch kein Tisch zugewiesen */
  tableId: uuid('table_id').references(() => restaurantTables.id),
  status: text('status', { enum: ['booked', 'seated', 'done', 'cancelled', 'no_show'] }).notNull().default('booked'),
  createdBy: text('created_by').notNull(),
  ...stamps,
}, (t) => [index('table_reservations_date_idx').on(t.date)]);

/** Vom Administrator benannte Netzwerkgeräte (z. B. „Kasse“, „Drucker“). Gefundene Geräte selbst werden nicht gespeichert. */
export const netDevices = pgTable('net_devices', {
  mac: text('mac').primaryKey(),
  name: text('name').notNull(),
  /** vom Administrator festgelegte Geräteart; leer = automatisch schätzen */
  kind: text('kind').notNull().default(''),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Online-Meldeschein: einmaliger Link (QR-Code) je Reservierung, über den der Gast seine Angaben selbst einträgt. */
export const guestForms = pgTable('guest_forms', {
  id: id(),
  bookingId: uuid('booking_id').notNull().unique().references(() => bookings.id, { onDelete: 'cascade' }),
  /** SHA-256 des Zugangscodes – der Code selbst steht nur im Link */
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  submittedAt: ts('submitted_at'),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Wareneingangskontrolle: je Lieferung ein Eintrag mit Befund; Korrektur nur am selben Tag (danach bleibt der Eintrag stehen). */
export const goodsReceipts = pgTable('goods_receipts', {
  id: id(),
  date: date('date', { mode: 'string' }).notNull(),
  supplier: text('supplier').notNull(),
  goods: text('goods').notNull(),
  /** gemessene Temperatur bei Kühl-/Tiefkühlware; leer = nicht gemessen */
  tempC: numeric('temp_c', { precision: 5, scale: 1, mode: 'number' }),
  ok: boolean('ok').notNull(),
  note: text('note').notNull().default(''),
  userName: text('user_name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('goods_receipts_date_idx').on(t.date)]);

// =====================================================================================
// Abrechnung: Rechnungen, Stornobelege, Zahlungen
// =====================================================================================

/** Rechnung bzw. Stornobeleg. Nach der Ausstellung unveränderlich (Trigger in Migration 0008). */
export const invoices = pgTable('invoices', {
  id: id(),
  /** Rechnungsnummer – erst bei Ausstellung vergeben, lückenlos je Jahr */
  number: text('number').unique(),
  /** Nummer des Kostenvoranschlags (KV-Jahr-Nr.), falls der Entwurf als Kostenvoranschlag geführt wird/wurde – eigener Nummernkreis, keine Rechnungsnummer */
  estimateNumber: text('estimate_number').unique(),
  kind: text('kind', { enum: ['invoice', 'cancellation'] }).notNull().default('invoice'),
  status: text('status', { enum: ['draft', 'issued', 'cancelled'] }).notNull().default('draft'),
  bookingId: uuid('booking_id').references(() => bookings.id),
  /** Beim Stornobeleg: die stornierte Rechnung */
  cancelsId: uuid('cancels_id'),
  // Empfänger – Kopie, unabhängig von späteren Änderungen am Gast
  recipientCompany: text('recipient_company').notNull().default(''),
  recipientName: text('recipient_name').notNull().default(''),
  recipientStreet: text('recipient_street').notNull().default(''),
  recipientZip: text('recipient_zip').notNull().default(''),
  recipientCity: text('recipient_city').notNull().default(''),
  recipientCountry: text('recipient_country').notNull().default(''),
  recipientVatId: text('recipient_vat_id').notNull().default(''),
  serviceFrom: date('service_from', { mode: 'string' }),
  serviceTo: date('service_to', { mode: 'string' }),
  issueDate: date('issue_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  notes: text('notes').notNull().default(''),
  /** Zahlungsziel dieser Rechnung; leer = aus den Einstellungen */
  paymentTermDays: integer('payment_term_days'),
  /** Kopie der Absenderangaben zum Ausstellungszeitpunkt */
  issuer: jsonb('issuer'),
  grossCents: integer('gross_cents').notNull().default(0),
  createdBy: text('created_by').notNull().default(''),
  issuedBy: text('issued_by').notNull().default(''),
  issuedAt: ts('issued_at'),
  cancelReason: text('cancel_reason').notNull().default(''),
  ...stamps,
}, (t) => [index('invoices_booking_idx').on(t.bookingId), index('invoices_issue_idx').on(t.issueDate)]);

export const invoiceLines = pgTable('invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  pos: integer('pos').notNull(),
  description: text('description').notNull(),
  detail: text('detail').notNull().default(''),
  quantity: numeric('quantity', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  /** Bruttopreis je Einheit */
  unitPriceCents: integer('unit_price_cents').notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  totalCents: integer('total_cents').notNull(),
  /** Herkunft aus der Reservierung, damit nichts doppelt berechnet wird: Nächte eines Zimmers (von–bis, bis exklusiv) oder eine Leistung */
  sourceKind: text('source_kind', { enum: ['night', 'charge'] }),
  sourceId: uuid('source_id'),
  sourceFrom: date('source_from', { mode: 'string' }),
  sourceTo: date('source_to', { mode: 'string' }),
}, (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)]);

/** Archivkopie: das PDF einer Rechnung, wie es beim Ausstellen erzeugt wurde. Wird nie überschrieben. */
export const invoiceDocuments = pgTable('invoice_documents', {
  invoiceId: uuid('invoice_id').primaryKey().references(() => invoices.id),
  pdf: bytea('pdf').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Zahlung (negativer Betrag = Erstattung bzw. Gegenbuchung). Nicht änderbar oder löschbar. */
export const payments = pgTable('payments', {
  id: id(),
  bookingId: uuid('booking_id').references(() => bookings.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  amountCents: integer('amount_cents').notNull(),
  method: text('method').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  payer: text('payer').notNull().default(''),
  note: text('note').notNull().default(''),
  /** Barzahlung: vom Gast gegebener Betrag (Rückgeld = gegeben − Betrag) */
  givenCents: integer('given_cents'),
  /** Bei einer Gegenbuchung: die korrigierte Zahlung */
  reversesId: uuid('reverses_id'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('payments_booking_idx').on(t.bookingId), index('payments_invoice_idx').on(t.invoiceId)]);

/** TSE-Aufzeichnung einer Zahlung (Kassenbeleg-V1). Eine Barzahlung, die auf mehrere Rechnungen verteilt wurde, teilt sich einen Vorgang. */
export const tseRecords = pgTable('tse_records', {
  id: id(),
  paymentId: uuid('payment_id').notNull().unique().references(() => payments.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['signed', 'failed'] }).notNull(),
  clientId: text('client_id').notNull().default(''),
  serialHex: text('serial_hex').notNull().default(''),
  transactionNumber: integer('transaction_number'),
  signatureCounter: integer('signature_counter'),
  startTime: text('start_time').notNull().default(''),
  finishTime: text('finish_time').notNull().default(''),
  signature: text('signature').notNull().default(''),
  processType: text('process_type').notNull().default(''),
  processData: text('process_data').notNull().default(''),
  publicKey: text('public_key').notNull().default(''),
  algorithm: text('algorithm').notNull().default(''),
  error: text('error').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// =====================================================================================
// Firmen: Rechnungsanschrift, Ansprechpartner, vereinbarte Preise, Zahlungsbedingungen
// =====================================================================================
export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  street: text('street').notNull().default(''),
  zip: text('zip').notNull().default(''),
  city: text('city').notNull().default(''),
  country: text('country').notNull().default('Deutschland'),
  vatId: text('vat_id').notNull().default(''),
  contactName: text('contact_name').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  /** leer = Zahlungsziel aus den Einstellungen */
  paymentTermDays: integer('payment_term_days'),
  notes: text('notes').notNull().default(''),
  active: boolean('active').notNull().default(true),
  ...stamps,
}, (t) => [index('companies_name_idx').on(t.name)]);

/** Vereinbarter Preis je Nacht für eine Zimmerkategorie */
export const companyRates = pgTable('company_rates', {
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id').notNull().references(() => roomCategories.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
}, (t) => [primaryKey({ columns: [t.companyId, t.categoryId] })]);

// =====================================================================================
// E-Rechnung (ZUGFeRD/Factur-X) und E-Mail-Versand
// =====================================================================================

export const einvoices = pgTable('einvoices', {
  id: id(),
  /** 'invoice' = aus einer Rechnung des PMS erzeugt, 'upload' = hochgeladene PDF-Datei umgewandelt */
  source: text('source', { enum: ['upload', 'invoice'] }).notNull(),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  number: text('number').notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  buyerName: text('buyer_name').notNull(),
  buyerEmail: text('buyer_email').notNull().default(''),
  grossCents: integer('gross_cents').notNull(),
  originalName: text('original_name').notNull().default(''),
  /** true, wenn das PMS die PDF-Datei selbst erzeugt hat (Schrift und Farbprofil eingebettet) */
  generatedPdf: boolean('generated_pdf').notNull().default(false),
  data: jsonb('data').notNull(),
  xml: text('xml').notNull(),
  pdf: bytea('pdf').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  sentAt: ts('sent_at'),
  sentTo: text('sent_to').notNull().default(''),
}, (t) => [index('einvoices_created_idx').on(t.createdAt)]);

export const mailLog = pgTable('mail_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  toAddr: text('to_addr').notNull(),
  subject: text('subject').notNull(),
  attachments: text('attachments').notNull().default(''),
  status: text('status', { enum: ['sent', 'failed'] }).notNull(),
  error: text('error').notNull().default(''),
  userName: text('user_name').notNull(),
  einvoiceId: uuid('einvoice_id'),
});

// =====================================================================================
// E-Mail-Posteingang: abgerufene Nachrichten des Geschäftspostfachs (Kopie; das Postfach selbst bleibt unverändert)
// =====================================================================================
/** Vorgang: ein E-Mail-Wechsel mit eigener Nummer (V-Jahr-Nr.), die im Betreff der Antworten steht */
export const mailCases = pgTable('mail_cases', {
  id: id(),
  number: text('number').notNull().unique(),
  kind: text('kind', { enum: ['hotel', 'table', 'event', 'meeting', 'voucher', 'question', 'other'] }).notNull().default('other'),
  title: text('title').notNull().default(''),
  contactName: text('contact_name').notNull().default(''),
  contactAddr: text('contact_addr').notNull().default(''),
  /** open = offen, working = in Bearbeitung, done = erledigt, archived = archiviert (Textspalte ohne Datenbank-Einschränkung) */
  status: text('status', { enum: ['open', 'working', 'done', 'archived'] }).notNull().default('open'),
  createdBy: text('created_by').notNull().default(''),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('mail_cases_addr_idx').on(t.contactAddr)]);
/** Gesendete Antworten eines Vorgangs (mit Text) */
export const mailCaseOut = pgTable('mail_case_out', {
  id: id(),
  caseId: uuid('case_id').notNull().references(() => mailCases.id, { onDelete: 'cascade' }),
  at: ts('at').notNull().defaultNow(),
  by: text('by').notNull().default(''),
  toAddr: text('to_addr').notNull().default(''),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
}, (t) => [index('mail_case_out_case_idx').on(t.caseId, t.at)]);

export const inboxMails = pgTable('inbox_mails', {
  id: id(),
  uidValidity: text('uid_validity').notNull(),
  uid: integer('uid').notNull(),
  messageId: text('message_id').notNull().default(''),
  fromName: text('from_name').notNull().default(''),
  fromAddr: text('from_addr').notNull().default(''),
  subject: text('subject').notNull().default(''),
  receivedAt: ts('received_at').notNull(),
  body: text('body').notNull().default(''),
  kind: text('kind', { enum: ['hotel', 'table', 'event', 'meeting', 'voucher', 'question', 'other'] }).notNull(),
  extract: jsonb('extract').notNull(),
  status: text('status', { enum: ['new', 'done', 'ignored'] }).notNull().default('new'),
  linkKind: text('link_kind', { enum: ['booking', 'table'] }),
  linkId: uuid('link_id'),
  handledBy: text('handled_by').notNull().default(''),
  repliedAt: ts('replied_at'),
  repliedBy: text('replied_by').notNull().default(''),
  fetchedAt: ts('fetched_at').notNull().defaultNow(),
  /** Vorgang, zu dem die Nachricht gehört */
  caseId: uuid('case_id').references(() => mailCases.id, { onDelete: 'set null' }),
}, (t) => [uniqueIndex('inbox_mails_uid_idx').on(t.uidValidity, t.uid), index('inbox_mails_received_idx').on(t.receivedAt), index('inbox_mails_case_idx').on(t.caseId)]);

// =====================================================================================
// Team: Übergabebuch, Aufgaben und Reparaturmeldungen – für alle angemeldeten Benutzer
// =====================================================================================
export const teamNotes = pgTable('team_notes', {
  id: id(),
  kind: text('kind', { enum: ['note', 'task', 'repair'] }).notNull(),
  text: text('text').notNull(),
  /** Zimmer oder Ort, frei eingetragen (z. B. „Zimmer 12“, „Küche“) */
  place: text('place').notNull().default(''),
  dueDate: date('due_date', { mode: 'string' }),
  status: text('status', { enum: ['open', 'done'] }).notNull().default('open'),
  createdBy: text('created_by').notNull(),
  createdById: uuid('created_by_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  doneBy: text('done_by').notNull().default(''),
  doneAt: ts('done_at'),
  doneNote: text('done_note').notNull().default(''),
}, (t) => [index('team_notes_created_idx').on(t.createdAt)]);

/** Lesebestätigung: wer einen Eintrag zur Kenntnis genommen hat */
export const teamNoteReads = pgTable('team_note_reads', {
  noteId: uuid('note_id').notNull().references(() => teamNotes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull(),
  userName: text('user_name').notNull(),
  at: ts('at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.noteId, t.userId] })]);

/** Wiederkehrende Aufgaben: legen am fälligen Tag von selbst eine Aufgabe im Team-Bereich an. */
export const teamRecurring = pgTable('team_recurring', {
  id: id(),
  text: text('text').notNull(),
  place: text('place').notNull().default(''),
  repeat: text('repeat', { enum: ['daily', 'weekly', 'monthly'] }).notNull(),
  day: integer('day').notNull().default(0),
  lastCreated: date('last_created', { mode: 'string' }),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Foto einer Zimmerkategorie für die Gästeseite (ein Bild je Kategorie, verkleinert hochgeladen) */
export const categoryPhotos = pgTable('category_photos', {
  categoryId: uuid('category_id').primaryKey().references(() => roomCategories.id, { onDelete: 'cascade' }),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Bilder der Gästeseite (Startbild, Restaurant, Hotel, Feiern) */
export const siteImages = pgTable('site_images', {
  key: text('key').primaryKey(),
  mime: text('mime').notNull(),
  data: bytea('data').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------- Angebote (Tagungen, Feiern, Gruppen) ----------
/** Katalog: Leistungen mit Preis, Abrechnungsart und Steuersatz */
export const offerItems = pgTable('offer_items', {
  id: id(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** person, day, person_day, night, person_night, flat */
  unit: text('unit', { enum: ['person', 'day', 'person_day', 'night', 'person_night', 'flat'] }).notNull(),
  priceCents: integer('price_cents').notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  area: text('area', { enum: ['hotel', 'restaurant', 'both'] }).notNull().default('both'),
  /** Gruppe für den Konfigurator und den Katalog (z. B. Raum, Verpflegung, Technik); leer = „Weitere Leistungen“ */
  itemGroup: text('item_group').notNull().default(''),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Hochgeladene Dokumente (z. B. AGB als PDF) – werden nicht überschrieben, damit nachvollziehbar bleibt, welche Fassung ein Kunde bekam */
export const offerDocuments = pgTable('offer_documents', {
  id: id(),
  name: text('name').notNull(),
  fileName: text('file_name').notNull(),
  data: bytea('data').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  active: boolean('active').notNull().default(true),
  uploadedBy: text('uploaded_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Vorlagen: Texte, Fragenkatalog, vorausgewählte Leistungen, Gültigkeit, Anzahlung, angehängte Dokumente */
export const offerTemplates = pgTable('offer_templates', {
  id: id(),
  name: text('name').notNull(),
  area: text('area', { enum: ['hotel', 'restaurant', 'both'] }).notNull().default('both'),
  title: text('title').notNull().default(''),
  intro: text('intro').notNull().default(''),
  closing: text('closing').notNull().default(''),
  questions: jsonb('questions').notNull().default(sql`'[]'::jsonb`),
  items: jsonb('items').notNull().default(sql`'[]'::jsonb`),
  /** Schritte der Absprache am Tisch: [{ title, hint, kind, options: [{ label, itemId }] }] */
  talkSteps: jsonb('talk_steps').notNull().default(sql`'[]'::jsonb`),
  validDays: integer('valid_days').notNull().default(14),
  depositPercent: integer('deposit_percent').notNull().default(0),
  documentIds: jsonb('document_ids').notNull().default(sql`'[]'::jsonb`),
  sort: integer('sort').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...stamps,
});

/** Verlauf eines Kostenvoranschlags / einer Rechnung: gesendete E-Mails (mit Text) und zugeordnete Antworten aus dem Posteingang */
export const invoiceEvents = pgTable('invoice_events', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references((): AnyPgColumn => invoices.id, { onDelete: 'cascade' }),
  at: ts('at').notNull().defaultNow(),
  kind: text('kind', { enum: ['mail_out', 'mail_in'] }).notNull(),
  /** bei mail_out: estimate | invoice | reminder */
  what: text('what').notNull().default(''),
  who: text('who').notNull().default(''),
  /** bei mail_out: Empfängeradresse (Vorbelegung für die nächste E-Mail, z. B. die Rechnung) */
  toAddr: text('to_addr').notNull().default(''),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  inboxMailId: uuid('inbox_mail_id'),
}, (t) => [index('invoice_events_invoice_idx').on(t.invoiceId, t.at), uniqueIndex('invoice_events_inbox_idx').on(t.inboxMailId)]);

/** Verlauf eines Angebots: gesendete E-Mails (mit Text) und zugeordnete Antworten aus dem Posteingang (Kopie des Textes) */
export const offerEvents = pgTable('offer_events', {
  id: id(),
  offerId: uuid('offer_id').notNull().references((): AnyPgColumn => offers.id, { onDelete: 'cascade' }),
  at: ts('at').notNull().defaultNow(),
  kind: text('kind', { enum: ['mail_out', 'mail_in'] }).notNull(),
  /** bei mail_out: questions | catalog | offer */
  what: text('what').notNull().default(''),
  /** bei mail_out: Mitarbeiter und Empfänger; bei mail_in: Absender */
  who: text('who').notNull().default(''),
  subject: text('subject').notNull().default(''),
  body: text('body').notNull().default(''),
  /** Nachricht im Posteingang (ohne Fremdschlüssel: der Posteingang räumt nach Frist auf, der Verlauf bleibt) */
  inboxMailId: uuid('inbox_mail_id'),
}, (t) => [index('offer_events_offer_idx').on(t.offerId, t.at), uniqueIndex('offer_events_inbox_idx').on(t.inboxMailId)]);

export const offers = pgTable('offers', {
  id: id(),
  number: text('number').notNull().unique(),
  status: text('status', { enum: ['draft', 'sent', 'accepted', 'declined'] }).notNull().default('draft'),
  /** 'questions' = erst nur Fragen an den Kunden (ohne Leistungen und Preise); 'offer' = Angebot mit Leistungen */
  mode: text('mode', { enum: ['offer', 'questions'] }).notNull().default('offer'),
  /** Antworten des Kunden auf den Fragenkatalog (online über den Link): { at, name, items: [{ q, a }] } */
  answers: jsonb('answers'),
  /** Absprache am Tisch: { at, by, template, steps: [{ title, answers, text }] } */
  talk: jsonb('talk'),
  area: text('area', { enum: ['hotel', 'restaurant', 'both'] }).notNull().default('both'),
  templateId: uuid('template_id').references(() => offerTemplates.id, { onDelete: 'set null' }),
  customerCompany: text('customer_company').notNull().default(''),
  customerName: text('customer_name').notNull().default(''),
  email: text('email').notNull().default(''),
  phone: text('phone').notNull().default(''),
  street: text('street').notNull().default(''),
  zip: text('zip').notNull().default(''),
  city: text('city').notNull().default(''),
  eventDate: date('event_date', { mode: 'string' }),
  eventEnd: date('event_end', { mode: 'string' }),
  persons: integer('persons').notNull().default(1),
  title: text('title').notNull().default(''),
  intro: text('intro').notNull().default(''),
  closing: text('closing').notNull().default(''),
  questions: jsonb('questions').notNull().default(sql`'[]'::jsonb`),
  validUntil: date('valid_until', { mode: 'string' }),
  depositPercent: integer('deposit_percent').notNull().default(0),
  documentIds: jsonb('document_ids').notNull().default(sql`'[]'::jsonb`),
  notes: text('notes').notNull().default(''),
  sentAt: ts('sent_at'),
  sentTo: text('sent_to').notNull().default(''),
  /** die zuletzt versendete Fassung als PDF und ihr Prüfwert (SHA-256) – so ist belegbar, was angenommen wurde */
  sentPdf: bytea('sent_pdf'),
  sentHash: text('sent_hash').notNull().default(''),
  /** Annahme: wie (E-Mail/Telefon von Hand vermerkt oder online), wann, durch wen; Prüfwert der angenommenen Fassung */
  acceptedAt: ts('accepted_at'),
  acceptedBy: text('accepted_by').notNull().default(''),
  acceptedMethod: text('accepted_method').notNull().default(''),
  acceptedIp: text('accepted_ip'),
  acceptedHash: text('accepted_hash').notNull().default(''),
  declinedAt: ts('declined_at'),
  bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  tableReservationId: uuid('table_reservation_id').references(() => tableReservations.id, { onDelete: 'set null' }),
  linkVersion: integer('link_version').notNull().default(0),
  createdBy: text('created_by').notNull(),
  ...stamps,
}, (t) => [index('offers_status_idx').on(t.status), index('offers_event_idx').on(t.eventDate)]);

export const offerLines = pgTable('offer_lines', {
  id: id(),
  offerId: uuid('offer_id').notNull().references(() => offers.id, { onDelete: 'cascade' }),
  pos: integer('pos').notNull(),
  itemId: uuid('item_id').references(() => offerItems.id, { onDelete: 'set null' }),
  description: text('description').notNull(),
  detail: text('detail').notNull().default(''),
  unit: text('unit').notNull().default('flat'),
  quantity: numeric('quantity', { precision: 10, scale: 2, mode: 'number' }).notNull(),
  unitPriceCents: integer('unit_price_cents').notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  totalCents: integer('total_cents').notNull(),
}, (t) => [index('offer_lines_offer_idx').on(t.offerId)]);

// =====================================================================================
// Einkauf: Warenbewegungen (Warenzugang, Lieferschein-Ausgang, Leergut)
// =====================================================================================

/**
 * Eine Zeile je Artikel und Vorgang. kind: in = Warenzugang vom Lieferanten, out = an Kunden geliefert (Lieferschein),
 * empty_back = Leergut vom Kunden zurück, empty_return = Leergut an den Lieferanten zurückgegeben.
 * Wird nie gelöscht – Fehleinträge werden storniert (voided_at), damit nachvollziehbar bleibt, was war.
 */
export const stockMoves = pgTable('stock_moves', {
  id: id(),
  date: date('date', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(),
  partner: text('partner').notNull(),
  article: text('article').notNull(),
  qty: integer('qty').notNull(),
  /** Belegnummer: eigener Lieferschein (LS-…) oder Lieferschein-Nr. des Lieferanten */
  ref: text('ref').notNull().default(''),
  note: text('note').notNull().default(''),
  userName: text('user_name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  voidedAt: ts('voided_at'),
  voidedBy: text('voided_by'),
}, (t) => [index('stock_moves_partner_idx').on(t.partner), index('stock_moves_date_idx').on(t.date)]);

// =====================================================================================
// Gutscheine (Geschenkkarten aus dem Kassenprogramm)
// =====================================================================================

/** Hochgeladene Gutschein-Motive (Hintergrundbild für Druck und PDF) */
export const voucherDesigns = pgTable('voucher_designs', {
  id: id(),
  name: text('name').notNull(),
  /** Hintergrundbild (freiwillig, seit dem Design-Editor) */
  mime: text('mime'),
  data: bytea('data'),
  /** Lage des Textfelds auf dem Motiv: right | left | bottom (nur ohne eigene Gestaltung) */
  textPos: text('text_pos').notNull().default('right'),
  /** Gestaltung aus dem Design-Editor (Elemente mit Lage, Größe, Farbe …); leer = einfaches Motiv mit Textfeld */
  layout: jsonb('layout'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * Gutschein: interne Nummer (fortlaufend mit Kürzel), PIN aus dem Kassenprogramm (verschlüsselt),
 * Wert, Käufer (für Rechnung und Versand), Beschenkter und Grußtext. Wird nicht gelöscht, nur storniert.
 */
export const vouchers = pgTable('vouchers', {
  id: id(),
  number: text('number').notNull(),
  pinEnc: text('pin_enc'),
  /** letzte zwei Stellen des PIN – für die Anzeige in Listen */
  pinHint: text('pin_hint').notNull().default(''),
  /** Nummer der Geschenkkarte im Kassenprogramm (falls vorhanden) */
  posCardNo: text('pos_card_no').notNull().default(''),
  valueCents: integer('value_cents').notNull(),
  issuedOn: date('issued_on', { mode: 'string' }).notNull(),
  validUntil: date('valid_until', { mode: 'string' }),
  buyerName: text('buyer_name').notNull().default(''),
  buyerCompany: text('buyer_company').notNull().default(''),
  buyerStreet: text('buyer_street').notNull().default(''),
  buyerZip: text('buyer_zip').notNull().default(''),
  buyerCity: text('buyer_city').notNull().default(''),
  buyerCountry: text('buyer_country').notNull().default('Deutschland'),
  buyerEmail: text('buyer_email').notNull().default(''),
  recipientName: text('recipient_name').notNull().default(''),
  message: text('message').notNull().default(''),
  designId: uuid('design_id').references(() => voucherDesigns.id, { onDelete: 'set null' }),
  /** active | redeemed | cancelled */
  status: text('status').notNull().default('active'),
  invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  sentAt: ts('sent_at'),
  sentTo: text('sent_to'),
  /** Gutscheinbuch: wie bezahlt und wer kassiert hat; wann und von wem eingelöst */
  payMethod: text('pay_method').notNull().default(''),
  cashier: text('cashier').notNull().default(''),
  redeemedAt: ts('redeemed_at'),
  redeemedBy: text('redeemed_by'),
  note: text('note').notNull().default(''),
  createdBy: text('created_by').notNull(),
  ...stamps,
}, (t) => [uniqueIndex('vouchers_number_idx').on(t.number), index('vouchers_status_idx').on(t.status)]);
