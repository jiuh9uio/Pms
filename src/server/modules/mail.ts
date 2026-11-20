import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { MailSettingsDto } from '../../shared/einvoice.js';
import type { Db, Exec } from '../db/client.js';
import { mailLog, settings } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

interface Stored { enabled: boolean; host: string; port: number; user: string; fromName: string; passEnc: string }
const DEFAULTS: Stored = { enabled: false, host: 'mail.gmx.net', port: 587, user: '', fromName: '', passEnc: '' };

// ---------- Passwort verschlüsselt ablegen ----------
// Der Schlüssel liegt als Datei im Datenordner, nicht in der Datenbank: Eine Datenbanksicherung allein enthält das Passwort nicht im Klartext.
let key: Buffer | null = null;
function secretKey() {
  if (key) return key;
  const dir = process.env.PMS_DATA_DIR ?? 'data';
  const file = join(dir, 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, randomBytes(32), { mode: 0o600 });
  }
  return (key = readFileSync(file));
}
/** Schlüssel der Installation (für das Umzugspaket) */
export const getSecretKey = () => secretKey();
/** Schlüssel ersetzen (beim Einspielen eines Umzugspakets): Datei überschreiben und sofort verwenden. */
export function setSecretKey(k: Buffer) {
  if (k.length !== 32) throw new AppError(400, 'bad_file', 'Der Schlüssel im Umzugspaket ist ungültig.');
  const dir = process.env.PMS_DATA_DIR ?? 'data';
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'secret.key'), k, { mode: 0o600 });
  key = k;
}
/** Prüfsumme mit dem Schlüssel der Installation – für Links, die ohne gespeicherten Zugangscode auskommen */
export const sign = (text: string) => createHmac('sha256', secretKey()).update(text).digest('base64url').slice(0, 32);
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(b64: string) {
  try {
    const buf = Buffer.from(b64, 'base64');
    const d = createDecipheriv('aes-256-gcm', secretKey(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    throw new AppError(409, 'mail_secret', 'Das gespeicherte E-Mail-Passwort kann nicht gelesen werden (Schlüsseldatei fehlt oder wurde ersetzt). Bitte das Passwort in den Einstellungen neu eintragen.');
  }
}

async function load(db: Exec): Promise<Stored> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'mail'));
  return { ...DEFAULTS, ...((row?.value as Partial<Stored>) ?? {}) };
}
const toDto = (s: Stored): MailSettingsDto => ({ enabled: s.enabled, host: s.host, port: s.port, user: s.user, fromName: s.fromName, hasPassword: !!s.passEnc });

export const getMailSettings = async (db: Exec) => toDto(await load(db));

export async function saveMailSettings(db: Db, actor: Actor, v: { enabled: boolean; host: string; port: number; user: string; fromName: string; password: string }) {
  return db.transaction(async (tx) => {
    const cur = await load(tx);
    const next: Stored = { enabled: v.enabled, host: v.host, port: v.port, user: v.user, fromName: v.fromName, passEnc: v.password ? encrypt(v.password) : cur.passEnc };
    await tx.insert(settings).values({ key: 'mail', value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    // Passwort erscheint nie im Protokoll
    await record(tx, actor, { action: 'update', entity: 'settings', entityId: 'mail', before: toDto(cur), after: toDto(next) });
    return toDto(next);
  });
}

// ---------- Versand ----------
export interface Mail { to: string; subject: string; text: string; /** HTML-Fassung (z. B. mit Logo) */ html?: string; /** Message-ID der Nachricht, auf die geantwortet wird */ inReplyTo?: string;
  /** Kennzeichen des Vorgangs (V-…, AN-…, KV-…): steckt in der eigenen Message-ID, damit Antworten auch bei geändertem Betreff zugeordnet werden */ threadCode?: string;
  /** von sendMail vergeben */ messageId?: string; references?: string[];
  attachments?: { filename: string; content: Buffer; contentType: string; cid?: string }[] }
type Sender = (config: { host: string; port: number; user: string; pass: string }, mail: Mail & { from: { name: string; address: string } }) => Promise<void>;

let sender: Sender = async (c, mail) => {
  const transport = nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.port === 465, requireTLS: c.port !== 465, auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 60_000,
  });
  await transport.sendMail({ ...mail, ...(mail.references?.length ? { references: mail.references } : mail.inReplyTo ? { references: mail.inReplyTo } : {}) });
};
/** Für Tests: Versand ersetzen, damit keine echte E-Mail verschickt wird. */
export const setMailSender = (s: Sender) => { sender = s; };

function explain(e: unknown) {
  const x = e as { code?: string; responseCode?: number; message?: string };
  const msg = String(x.message ?? e);
  if (x.responseCode === 535 || /auth|credentials/i.test(msg))
    return 'Anmeldung am E-Mail-Server abgelehnt. Bitte Adresse und Passwort prüfen. Bei GMX muss unter „E-Mail → Einstellungen → POP3/IMAP Abruf“ der Zugriff über POP3/IMAP erlaubt sein.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout/i.test(`${x.code} ${msg}`)) return `E-Mail-Server nicht erreichbar (${x.code ?? msg})`;
  return msg;
}

/** Message-ID der Form <pms.V-2026-0001.zufall@domain> – der Zufallsteil macht sie eindeutig und nicht erratbar */
export const threadMessageId = (code: string, fromAddr: string) => `<pms.${code.toUpperCase()}.${randomBytes(9).toString('hex')}@${(fromAddr.split('@')[1] || 'pms.local').toLowerCase()}>`;
const THREAD_REF = /<pms\.((?:V|AN|KV)-\d{4}-\d{4,6})\.[0-9a-f]{18}@[^>\s]+>/gi;
/** Kennzeichen aus den technischen Verweisen (In-Reply-To, References) einer eingehenden E-Mail lesen */
export function threadCodesOf(refs: string[]): string[] {
  const out: string[] = [];
  for (const r of refs) for (const m of r.matchAll(THREAD_REF)) { const c = m[1]!.toUpperCase(); if (!out.includes(c)) out.push(c); }
  return out;
}

export async function sendMail(db: Db, actor: Actor, mail: Mail, einvoiceId: string | null = null) {
  const s = await load(db);
  if (!s.enabled || !s.host || !s.user || !s.passEnc)
    throw new AppError(409, 'mail_not_configured', 'Der E-Mail-Versand ist noch nicht eingerichtet (Verwaltung → Einstellungen → E-Mail-Versand)');
  const names = (mail.attachments ?? []).map((a) => a.filename).join(', ');
  // Logo in E-Mails (Einstellungen → Haus → Logo): zusätzlich eine HTML-Fassung mit dem Logo oben, der Text bleibt gleich
  let out: Mail = mail;
  try {
    const { getLogoUsage, mailHtml } = await import('./logo.js');
    if (!mail.html && (await getLogoUsage(db)).emails) {
      const { getLogo } = await import('./billing.js');
      const { getHotel } = await import('./settings.js');
      const logo = await getLogo(db);
      if (logo) out = { ...mail, html: mailHtml(mail.text, (await getHotel(db)).name), attachments: [...(mail.attachments ?? []), { filename: logo.mime === 'image/png' ? 'logo.png' : 'logo.jpg', content: logo.data, contentType: logo.mime, cid: 'logo' }] };
    }
  } catch { out = mail; /* ohne Logo senden */ }
  // eigene Message-ID mit dem Kennzeichen des Vorgangs: E-Mail-Programme tragen sie beim Antworten in „In-Reply-To/References“ ein
  if (mail.threadCode) out = { ...out, messageId: threadMessageId(mail.threadCode, s.user), references: mail.inReplyTo ? [mail.inReplyTo] : undefined };
  try {
    await sender({ host: s.host, port: s.port, user: s.user, pass: decrypt(s.passEnc) }, { ...out, from: { name: s.fromName || s.user, address: s.user } });
    await db.insert(mailLog).values({ toAddr: mail.to, subject: mail.subject, attachments: names, status: 'sent', userName: actor.userName, einvoiceId });
  } catch (e) {
    if (e instanceof AppError) throw e;
    const reason = explain(e);
    await db.insert(mailLog).values({ toAddr: mail.to, subject: mail.subject, attachments: names, status: 'failed', error: reason.slice(0, 500), userName: actor.userName, einvoiceId });
    throw new AppError(502, 'mail_failed', `Versand fehlgeschlagen: ${reason}`);
  }
}
