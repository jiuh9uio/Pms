import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { InboxMailDto, InboxSettingsDto, InboxState, InboxStatus } from '../../shared/inbox.js';
import { extract, type MailExtract, type MailKind } from '../../shared/mailextract.js';
import type { Db, Exec } from '../db/client.js';
import { inboxMails, settings } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { decrypt, encrypt } from './mail.js';

/**
 * E-Mail-Posteingang: holt die Nachrichten des Geschäftspostfachs per IMAP ab (nur lesend – im Postfach wird nichts
 * verändert, gelöscht oder als gelesen markiert), schätzt die Art der Anfrage und schlägt Angaben für eine Reservierung vor.
 */
interface Stored { enabled: boolean; host: string; port: number; user: string; passEnc: string; folder: string; autoMinutes: number }
const DEFAULTS: Stored = { enabled: false, host: 'imap.gmx.net', port: 993, user: '', passEnc: '', folder: 'INBOX', autoMinutes: 0 };
interface State { lastFetchAt: string | null; lastError: string | null; uidValidity: string; lastUid: number }
const STATE0: State = { lastFetchAt: null, lastError: null, uidValidity: '', lastUid: 0 };
/** beim ersten Abruf: so viele Tage zurück, höchstens so viele Nachrichten */
const FIRST_DAYS = 30, MAX_PER_FETCH = 200, MAX_BODY = 20_000;

const read = async <T>(db: Exec, key: string, def: T): Promise<T> => {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return { ...def, ...((row?.value as Partial<T>) ?? {}) };
};
const write = (db: Exec, key: string, value: unknown) =>
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
const toDto = (s: Stored): InboxSettingsDto => ({ enabled: s.enabled, host: s.host, port: s.port, user: s.user, folder: s.folder, autoMinutes: s.autoMinutes, hasPassword: !!s.passEnc });
const ready = (s: Stored) => s.enabled && !!s.host && !!s.user && !!s.passEnc;

export const getInboxSettings = async (db: Exec) => toDto(await read(db, 'inbox', DEFAULTS));
export async function saveInboxSettings(db: Db, actor: Actor, v: { enabled: boolean; host: string; port: number; user: string; password: string; folder: string; autoMinutes: number }) {
  const cur = await read(db, 'inbox', DEFAULTS);
  const next: Stored = { enabled: v.enabled, host: v.host, port: v.port, user: v.user, folder: v.folder, autoMinutes: v.autoMinutes, passEnc: v.password ? encrypt(v.password) : cur.passEnc };
  await write(db, 'inbox', next);
  // anderes Postfach oder anderer Ordner: Zählung der Nachrichten beginnt neu
  if (cur.host !== next.host || cur.user !== next.user || cur.folder !== next.folder) await write(db, 'inbox_state', STATE0);
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'inbox', before: toDto(cur), after: toDto(next) }); // ohne Passwort
  return toDto(next);
}

export async function inboxState(db: Exec): Promise<InboxState> {
  const [s, st] = [await read(db, 'inbox', DEFAULTS), await read(db, 'inbox_state', STATE0)];
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(inboxMails).where(eq(inboxMails.status, 'new'));
  return { lastFetchAt: st.lastFetchAt, lastError: st.lastError, ready: ready(s), autoMinutes: s.autoMinutes, newCount: n!.n };
}

// ---------- Abruf ----------
export interface RawMail { uid: number; source: Buffer; internalDate: Date }
type Fetcher = (c: { host: string; port: number; user: string; pass: string; folder: string }, known: { uidValidity: string; lastUid: number }) => Promise<{ uidValidity: string; mails: RawMail[] }>;

/** Abruf per IMAP: Ordner nur lesend öffnen, neue Nachrichten (oder beim ersten Mal die der letzten 30 Tage) im Original holen. */
export const imapFetch: Fetcher = async (c, known) => {
  const client = new ImapFlow({ host: c.host, port: c.port, secure: c.port === 993, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60_000, greetingTimeout: 15_000, connectionTimeout: 15_000 });
  client.on('error', () => {}); // Fehler kommen über die abgelehnten Aufrufe; ohne Lauscher würde der Prozess beendet
  await client.connect();
  try {
    const lock = await client.getMailboxLock(c.folder, { readOnly: true });
    try {
      const box = client.mailbox as { uidValidity?: bigint | number };
      const uidValidity = String(box.uidValidity ?? '');
      const cont = known.uidValidity === uidValidity && known.lastUid > 0;
      const found = await client.search(cont ? { uid: `${known.lastUid + 1}:*` } : { since: new Date(Date.now() - FIRST_DAYS * 86_400_000) }, { uid: true });
      const uids = (found || []).filter((u) => !cont || u > known.lastUid).sort((a, b) => a - b).slice(-MAX_PER_FETCH);
      const mails: RawMail[] = [];
      if (uids.length) {
        for await (const m of client.fetch(uids.join(','), { uid: true, internalDate: true, source: { maxLength: 2_000_000 } }, { uid: true }))
          if (m.source) mails.push({ uid: m.uid, source: m.source, internalDate: m.internalDate instanceof Date ? m.internalDate : new Date(m.internalDate ?? Date.now()) });
      }
      return { uidValidity, mails };
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => client.close()); }
};
let fetcher: Fetcher = imapFetch;
/** Für Tests: Abruf ersetzen, damit kein echtes Postfach nötig ist. */
export const setInboxFetcher = (f: Fetcher) => { fetcher = f; };

function explain(e: unknown) {
  const x = e as { code?: string; authenticationFailed?: boolean; responseText?: string; message?: string };
  const msg = String(x.responseText || x.message || e);
  if (x.authenticationFailed || /auth|login|credentials/i.test(msg))
    return 'Anmeldung am Postfach abgelehnt. Bitte Adresse und Passwort prüfen. Bei GMX muss unter „E-Mail → Einstellungen → POP3/IMAP Abruf“ der Zugriff über IMAP erlaubt sein.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(`${x.code} ${msg}`)) return `Postfach nicht erreichbar (${x.code ?? msg})`;
  if (/mailbox|folder|nonexistent|doesn't exist/i.test(msg)) return `Der Ordner wurde im Postfach nicht gefunden (${msg})`;
  return msg;
}

const berlinDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
let running = false;

/** Neue Nachrichten abholen und einordnen. Bereits abgeholte werden nicht noch einmal geladen. */
export async function fetchInbox(db: Db, actor: Actor | null): Promise<{ added: number }> {
  const s = await read(db, 'inbox', DEFAULTS);
  if (!ready(s)) throw conflict('Der E-Mail-Empfang ist noch nicht eingerichtet (Verwaltung → Einstellungen → E-Mail)', 'inbox_not_configured');
  if (running) throw conflict('Der Abruf läuft bereits', 'inbox_running');
  running = true;
  const st = await read(db, 'inbox_state', STATE0);
  try {
    const got = await fetcher({ host: s.host, port: s.port, user: s.user, pass: decrypt(s.passEnc), folder: s.folder }, { uidValidity: st.uidValidity, lastUid: st.lastUid });
    let added = 0, lastUid = got.uidValidity === st.uidValidity ? st.lastUid : 0;
    for (const raw of got.mails) {
      const p = await simpleParser(raw.source, { skipImageLinks: true, skipTextToHtml: true });
      const from = p.from?.value[0];
      const date = p.date ?? raw.internalDate;
      const body = (p.text ?? '').replace(/\u0000/g, '').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, MAX_BODY);
      const subject = (p.subject ?? '').replace(/\u0000/g, '').slice(0, 300);
      const ex = extract(subject, body, berlinDay(date));
      const rows = await db.insert(inboxMails).values({
        uidValidity: got.uidValidity, uid: raw.uid, messageId: (p.messageId ?? '').slice(0, 300), fromName: (from?.name ?? '').slice(0, 200), fromAddr: (from?.address ?? '').slice(0, 200),
        subject, receivedAt: date, body, kind: ex.kind, extract: ex,
      }).onConflictDoNothing().returning({ id: inboxMails.id });
      added += rows.length;
      lastUid = Math.max(lastUid, raw.uid);
    }
    await write(db, 'inbox_state', { lastFetchAt: new Date().toISOString(), lastError: null, uidValidity: got.uidValidity, lastUid } satisfies State);
    if (actor && added) await record(db, actor, { action: 'fetch', entity: 'inbox', after: { added } });
    return { added };
  } catch (e) {
    if (e instanceof AppError) throw e;
    const reason = explain(e);
    await write(db, 'inbox_state', { ...st, lastFetchAt: new Date().toISOString(), lastError: reason.slice(0, 500) });
    throw new AppError(502, 'inbox_failed', `Abruf fehlgeschlagen: ${reason}`);
  } finally { running = false; }
}

/** Automatischer Abruf im eingestellten Abstand (Prüfung jede Minute). */
export async function autoFetchTick(db: Db, now = new Date()): Promise<'fetched' | 'idle'> {
  const s = await read(db, 'inbox', DEFAULTS);
  if (!ready(s) || !s.autoMinutes || running) return 'idle';
  const st = await read(db, 'inbox_state', STATE0);
  if (st.lastFetchAt && now.getTime() - Date.parse(st.lastFetchAt) < s.autoMinutes * 60_000) return 'idle';
  await fetchInbox(db, null);
  return 'fetched';
}
export function startInboxScheduler(db: Db) {
  setInterval(() => void autoFetchTick(db).catch((e) => console.error('E-Mail-Abruf:', e instanceof Error ? e.message : e)), 60_000).unref();
}

// ---------- Liste und Bearbeitung ----------
type Row = typeof inboxMails.$inferSelect;
const dto = (r: Row, full = false): InboxMailDto => ({
  id: r.id, fromName: r.fromName, fromAddr: r.fromAddr, subject: r.subject, receivedAt: r.receivedAt.toISOString(),
  snippet: r.body.replace(/\s+/g, ' ').slice(0, 160), kind: r.kind as MailKind, status: r.status as InboxStatus, extract: r.extract as MailExtract,
  linkKind: r.linkKind, linkId: r.linkId, handledBy: r.handledBy, ...(full ? { body: r.body } : {}),
});

export async function listInbox(db: Exec, f: { status: InboxStatus | 'all'; kind: MailKind | 'all'; q: string }): Promise<InboxMailDto[]> {
  const q = f.q.trim();
  const rows = await db.select().from(inboxMails).where(and(
    f.status === 'all' ? undefined : eq(inboxMails.status, f.status), f.kind === 'all' ? undefined : eq(inboxMails.kind, f.kind),
    q ? or(ilike(inboxMails.subject, `%${q}%`), ilike(inboxMails.fromName, `%${q}%`), ilike(inboxMails.fromAddr, `%${q}%`), ilike(inboxMails.body, `%${q}%`)) : undefined,
  )).orderBy(desc(inboxMails.receivedAt)).limit(200);
  return rows.map((r) => dto(r));
}
export async function getInboxMail(db: Exec, id: string): Promise<InboxMailDto> {
  const [r] = await db.select().from(inboxMails).where(eq(inboxMails.id, id));
  if (!r) throw notFound('E-Mail');
  return dto(r, true);
}
export async function updateInboxMail(db: Db, actor: Actor, id: string, v: { status?: InboxStatus; kind?: MailKind; linkKind?: 'booking' | 'table' | null; linkId?: string | null }) {
  const [before] = await db.select().from(inboxMails).where(eq(inboxMails.id, id));
  if (!before) throw notFound('E-Mail');
  const set: Partial<Row> = {};
  if (v.status) { set.status = v.status; set.handledBy = v.status === 'new' ? '' : actor.userName; }
  if (v.kind) set.kind = v.kind;
  if (v.linkKind !== undefined) { set.linkKind = v.linkKind; set.linkId = v.linkKind ? v.linkId ?? null : null; }
  const [r] = await db.update(inboxMails).set(set).where(eq(inboxMails.id, id)).returning();
  await record(db, actor, { action: 'update', entity: 'inbox', entityId: id, before: { status: before.status, kind: before.kind }, after: { status: r!.status, kind: r!.kind, subject: r!.subject.slice(0, 80) } });
  return dto(r!, true);
}
/** Aus dem Programm entfernen. Im Postfach bleibt die Nachricht; sie wird nicht erneut abgeholt. */
export async function deleteInboxMail(db: Db, actor: Actor, id: string) {
  const [r] = await db.delete(inboxMails).where(eq(inboxMails.id, id)).returning({ subject: inboxMails.subject });
  if (!r) throw notFound('E-Mail');
  await record(db, actor, { action: 'delete', entity: 'inbox', entityId: id, before: { subject: r.subject.slice(0, 80) } });
  return { ok: true };
}
