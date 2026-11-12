import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { fakeVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { record, type Actor } from './audit.js';
import { toUserDto } from './users.js';

const IDLE_MS = 12 * 60 * 60 * 1000; // Abmeldung nach 12 Stunden ohne Aktivität
const MAX_MS = 30 * 24 * 60 * 60 * 1000; // spätestens nach 30 Tagen neu anmelden
const TOUCH_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 10 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const BAD_LOGIN = () => new AppError(401, 'bad_credentials', 'Benutzername oder Passwort ist falsch');

export interface Meta { ip: string | null; userAgent: string | null }

async function createSession(db: Db | Parameters<Parameters<Db['transaction']>[0]>[0], userId: string, meta: Meta) {
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({
    tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + IDLE_MS), ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return token;
}

export async function needsSetup(db: Db) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return row!.n === 0;
}

/** Ersteinrichtung: legt den ersten Administrator an. Nur möglich, solange es keinen Benutzer gibt. */
export async function setup(db: Db, input: { username: string; name: string; password: string }, meta: Meta) {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4711)`);
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (row!.n > 0) throw new AppError(403, 'already_setup', 'Die Ersteinrichtung ist bereits abgeschlossen');
    const [user] = await tx.insert(users).values({ username: input.username, name: input.name, passwordHash, role: 'admin' }).returning();
    await record(tx, { userId: user!.id, userName: user!.name, ip: meta.ip }, { action: 'setup', entity: 'user', entityId: user!.id, after: toUserDto(user!) });
    return { token: await createSession(tx, user!.id, meta), user: toUserDto(user!) };
  });
}

export async function login(db: Db, input: { username: string; password: string }, meta: Meta) {
  const [user] = await db.select().from(users).where(eq(users.username, input.username));
  if (!user) {
    await fakeVerify(input.password);
    await record(db, { userId: null, userName: input.username.slice(0, 100), ip: meta.ip }, { action: 'login_failed', entity: 'session' });
    throw BAD_LOGIN();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const min = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(429, 'locked', `Zu viele Fehlversuche. Bitte in ${min} Minute(n) erneut versuchen.`);
  }
  const actor: Actor = { userId: user.id, userName: user.name, ip: meta.ip };
  const ok = (await verifyPassword(input.password, user.passwordHash)) && user.active;
  if (!ok) {
    const fails = user.failedLogins + 1;
    const lock = fails >= MAX_FAILS;
    await db.update(users).set({ failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null }).where(eq(users.id, user.id));
    await record(db, actor, { action: lock ? 'login_locked' : 'login_failed', entity: 'session', entityId: user.id });
    throw BAD_LOGIN();
  }
  return db.transaction(async (tx) => {
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
    await record(tx, actor, { action: 'login', entity: 'session', entityId: user.id });
    return { token: await createSession(tx, user.id, meta), user: toUserDto({ ...user, lastLoginAt: new Date() }) };
  });
}

/** Prüft das Sitzungs-Cookie und verlängert die Sitzung bei Aktivität. */
export async function authenticate(db: Db, token: string | undefined) {
  if (!token) return null;
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row) return null;
  const now = Date.now();
  if (row.session.expiresAt.getTime() < now || !row.user.active) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (now - row.session.lastSeenAt.getTime() > TOUCH_MS) {
    const expiresAt = new Date(Math.min(now + IDLE_MS, row.session.createdAt.getTime() + MAX_MS));
    await db.update(sessions).set({ lastSeenAt: new Date(now), expiresAt }).where(eq(sessions.id, row.session.id));
  }
  return { user: row.user, sessionId: row.session.id };
}

export async function logout(db: Db, actor: Actor, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
  await record(db, actor, { action: 'logout', entity: 'session', entityId: actor.userId });
}

/** Eigenes Passwort ändern; alle anderen Sitzungen des Benutzers werden beendet. */
export async function changeOwnPassword(db: Db, actor: Actor, sessionId: string, input: { current: string; password: string }) {
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId!));
  if (!user || !(await verifyPassword(input.current, user.passwordHash)))
    throw new AppError(400, 'validation', 'Eingaben prüfen', { current: 'Das aktuelle Passwort stimmt nicht' });
  const passwordHash = await hashPassword(input.password);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(sql`${sessions.userId} = ${user.id} and ${sessions.id} <> ${sessionId}`);
    await record(tx, actor, { action: 'password_changed', entity: 'user', entityId: user.id });
  });
}
