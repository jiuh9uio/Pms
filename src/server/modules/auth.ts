import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { fakeVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { record, type Actor } from './audit.js';
import { toUserDto } from './users.js';
import QRCode from 'qrcode';
import type { SecuritySettings, TotpSetupDto } from '../../shared/schemas.js';
import { settings } from '../db/schema.js';
import { newSecret, otpauthUrl, verifyCode } from '../lib/totp.js';
import { decrypt, encrypt } from './mail.js';

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

export async function login(db: Db, input: { username: string; password: string; code?: string }, meta: Meta) {
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
  // Zwei-Faktor-Anmeldung: nach dem richtigen Passwort zusätzlich der Code aus der App
  let totpStep: number | null = null;
  if (user.totpEnabled && user.totpSecretEnc) {
    if (!input.code) throw new AppError(401, 'totp_required', 'Bitte den 6-stelligen Code aus Microsoft Authenticator eingeben.');
    totpStep = verifyCode(decrypt(user.totpSecretEnc), input.code);
    if (totpStep == null || (user.totpLastStep != null && totpStep <= user.totpLastStep)) {
      const fails = user.failedLogins + 1;
      const lock = fails >= MAX_FAILS;
      await db.update(users).set({ failedLogins: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null }).where(eq(users.id, user.id));
      await record(db, actor, { action: lock ? 'login_locked' : 'login_failed', entity: 'session', entityId: user.id, after: { grund: 'Code der Zwei-Faktor-Anmeldung falsch' } });
      throw new AppError(401, 'totp_invalid', 'Der Code stimmt nicht oder wurde schon verwendet. Bitte den aktuellen Code aus der App eingeben.');
    }
  }
  return db.transaction(async (tx) => {
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...(totpStep != null ? { totpLastStep: totpStep } : {}) }).where(eq(users.id, user.id));
    await tx.delete(sessions).where(sql`${sessions.expiresAt} < now()`);
    await record(tx, actor, { action: 'login', entity: 'session', entityId: user.id });
    return { token: await createSession(tx, user.id, meta), user: toUserDto({ ...user, lastLoginAt: new Date() }) };
  });
}

/** Prüft das Sitzungs-Cookie und verlängert die Sitzung bei Aktivität. */
/** Einstellung „Abmelden nach … Minuten“ – kurz zwischengespeichert, damit nicht jede Anfrage die Einstellungen liest */
let idleCache: { minutes: number; at: number } | null = null;
async function idleMinutes(db: Db) {
  if (idleCache && Date.now() - idleCache.at < 30_000) return idleCache.minutes;
  const minutes = (await getSecurity(db)).idleMinutes || 0;
  idleCache = { minutes, at: Date.now() };
  return minutes;
}
export const forgetIdleCache = () => { idleCache = null; };

/**
 * inputAgeMs: wie lange die letzte Eingabe (Tippen/Klicken) im Browser her ist – undefined = unbekannt (zählt als Aktivität),
 * null = keine Eingabe (z. B. automatische Aktualisierung im Hintergrund; verlängert die Anmeldung nicht).
 */
export async function authenticate(db: Db, token: string | undefined, inputAgeMs?: number | null) {
  if (!token) return null;
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (!row) return null;
  const now = Date.now();
  // „Abmelden nach … Minuten ohne Eingabe“ auch hier prüfen – nicht nur im Browser (z. B. Browser geschlossen und wieder geöffnet)
  const idle = await idleMinutes(db);
  const idleOut = idle > 0 && now - row.session.lastSeenAt.getTime() > idle * 60_000;
  if (row.session.expiresAt.getTime() < now || !row.user.active || idleOut) {
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  // letzte Aktivität: Zeitpunkt der letzten Eingabe, nicht jede Hintergrund-Abfrage
  const activeAt = inputAgeMs === undefined ? now : inputAgeMs === null ? 0 : now - Math.max(0, inputAgeMs);
  const touchMs = idle > 0 ? Math.min(TOUCH_MS, 60_000, (idle * 60_000) / 5) : TOUCH_MS;
  if (activeAt - row.session.lastSeenAt.getTime() > touchMs) {
    const expiresAt = new Date(Math.min(activeAt + IDLE_MS, row.session.createdAt.getTime() + MAX_MS));
    await db.update(sessions).set({ lastSeenAt: new Date(activeAt), expiresAt }).where(eq(sessions.id, row.session.id));
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

// ---------- Zwei-Faktor-Anmeldung (für das eigene Konto) ----------
/** Beginnt die Einrichtung: erzeugt ein Geheimnis und den QR-Code. Eingeschaltet wird erst nach Bestätigung mit einem Code. */
export async function totpBegin(db: Db, actor: Actor, issuer: string, targetId = actor.userId!): Promise<TotpSetupDto> {
  const [user] = await db.select().from(users).where(eq(users.id, targetId));
  if (!user) throw new AppError(404, 'not_found', 'Benutzer nicht gefunden');
  if (user.totpEnabled) throw new AppError(409, 'conflict', 'Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet');
  const secret = newSecret();
  await db.update(users).set({ totpSecretEnc: encrypt(secret), totpLastStep: null }).where(eq(users.id, user.id));
  return { secret, account: user.username, qr: await QRCode.toDataURL(otpauthUrl(secret, user.username, issuer), { margin: 1, width: 220 }) };
}
export async function totpConfirm(db: Db, actor: Actor, code: string, targetId = actor.userId!) {
  const [user] = await db.select().from(users).where(eq(users.id, targetId));
  if (!user?.totpSecretEnc || user.totpEnabled) throw new AppError(409, 'conflict', 'Bitte die Einrichtung neu beginnen');
  const step = verifyCode(decrypt(user.totpSecretEnc), code);
  if (step == null) throw new AppError(400, 'validation', 'Eingaben prüfen', { code: 'Der Code stimmt nicht. Stimmt die Uhrzeit auf dem Handy?' });
  await db.update(users).set({ totpEnabled: true, totpLastStep: step, updatedAt: new Date() }).where(eq(users.id, user.id));
  await record(db, actor, { action: 'totp_enabled', entity: 'user', entityId: user.id, after: { username: user.username, durch: targetId === actor.userId ? 'selbst' : 'Administrator' } });
  return { ok: true };
}
export async function totpDisable(db: Db, actor: Actor, password: string) {
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId!));
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new AppError(400, 'validation', 'Eingaben prüfen', { password: 'Das Passwort stimmt nicht' });
  await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null, updatedAt: new Date() }).where(eq(users.id, user.id));
  await record(db, actor, { action: 'totp_disabled', entity: 'user', entityId: user.id });
  return { ok: true };
}

// ---------- Sicherheit: Abmelden nach Zeit ohne Eingabe ----------
export async function getSecurity(db: Db): Promise<SecuritySettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'security'));
  return { idleMinutes: 0, ...((row?.value as Partial<SecuritySettings>) ?? {}) };
}
export async function saveSecurity(db: Db, actor: Actor, v: SecuritySettings) {
  await db.insert(settings).values({ key: 'security', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  forgetIdleCache();
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'security', after: v });
  return v;
}
