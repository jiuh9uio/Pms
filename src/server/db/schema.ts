import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, customType, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid,
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
  sort: integer('sort').notNull().default(0),
  ...stamps,
});

export const rooms = pgTable('rooms', {
  id: id(),
  number: text('number').notNull().unique(),
  categoryId: uuid('category_id').notNull().references(() => roomCategories.id),
  floor: text('floor').notNull().default(''),
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
