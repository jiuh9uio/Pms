import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn, bigserial, boolean, customType, date, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
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
}, (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)]);

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
  /** Bei einer Gegenbuchung: die korrigierte Zahlung */
  reversesId: uuid('reverses_id'),
  recordedBy: text('recorded_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('payments_booking_idx').on(t.bookingId), index('payments_invoice_idx').on(t.invoiceId)]);

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
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

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
