import { and, asc, eq, sql } from 'drizzle-orm';
import type { Role, UserDto } from '../../shared/schemas.js';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { conflict, notFound, stale } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { record, type Actor } from './audit.js';

type UserRow = typeof users.$inferSelect;

/** Für Antworten und Protokoll – niemals mit Passwort-Hash. */
export const toUserDto = (u: UserRow): UserDto => ({
  id: u.id, username: u.username, name: u.name, role: u.role, active: u.active,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
  createdAt: u.createdAt.toISOString(), version: u.version,
});
const forAudit = (u: UserRow) => ({ username: u.username, name: u.name, role: u.role, active: u.active });

export async function listUsers(db: Db) {
  return (await db.select().from(users).orderBy(asc(users.name))).map(toUserDto);
}

export async function createUser(db: Db, actor: Actor, input: { username: string; name: string; password: string; role: Role }) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: users.id }).from(users).where(eq(users.username, input.username));
    if (dup) throw conflict('Dieser Benutzername ist bereits vergeben', 'username_taken');
    const [user] = await tx.insert(users).values({ username: input.username, name: input.name, role: input.role, passwordHash }).returning();
    await record(tx, actor, { action: 'create', entity: 'user', entityId: user!.id, after: forAudit(user!) });
    return toUserDto(user!);
  });
}

export async function updateUser(
  db: Db, actor: Actor, id: string, input: { name?: string; role?: Role; active?: boolean; version: number },
) {
  return db.transaction(async (tx) => {
    // Alle Administratoren sperren, damit zwei gleichzeitige Änderungen nicht den letzten Administrator entfernen.
    const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.active, true))).for('update');
    const [before] = await tx.select().from(users).where(eq(users.id, id)).for('update');
    if (!before) throw notFound('Benutzer');
    if (before.version !== input.version) throw stale();

    const role = input.role ?? before.role;
    const active = input.active ?? before.active;
    const losesAdmin = before.role === 'admin' && before.active && (role !== 'admin' || !active);
    if (losesAdmin && admins.length <= 1) throw conflict('Es muss mindestens ein aktiver Administrator bestehen bleiben', 'last_admin');

    const [after] = await tx.update(users)
      .set({ name: input.name ?? before.name, role, active, updatedAt: new Date(), version: before.version + 1, ...(active && !before.active ? { failedLogins: 0, lockedUntil: null } : {}) })
      .where(eq(users.id, id)).returning();
    if (!active) await tx.delete(sessions).where(eq(sessions.userId, id));
    await record(tx, actor, { action: 'update', entity: 'user', entityId: id, before: forAudit(before), after: forAudit(after!) });
    return toUserDto(after!);
  });
}

/** Administrator setzt ein neues Passwort; der Benutzer wird überall abgemeldet und entsperrt. */
export async function resetPassword(db: Db, actor: Actor, id: string, password: string) {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [user] = await tx.update(users)
      .set({ passwordHash, failedLogins: 0, lockedUntil: null, updatedAt: new Date(), version: sql`${users.version} + 1` })
      .where(eq(users.id, id)).returning({ id: users.id });
    if (!user) throw notFound('Benutzer');
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await record(tx, actor, { action: 'password_reset', entity: 'user', entityId: id });
  });
}
