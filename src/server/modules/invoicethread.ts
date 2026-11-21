import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { InvoiceTimeline, InvoiceTimelineEntry } from '../../shared/billing.js';
import type { Db, Exec } from '../db/client.js';
import { inboxMails, invoiceEvents, invoices, offerEvents } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { ownText, replyHint, type LinkOpts } from './offerthread.js';

/**
 * Verlauf eines Kostenvoranschlags (und der Rechnung, die daraus wird). Die KV-Nummer (z. B. „KV-2026-0004“) steht im Betreff jeder
 * E-Mail; Antworten im Posteingang werden daran erkannt und zugeordnet. In der E-Mail wird der Kunde gebeten, mit „Ja“ oder „Nein“
 * zu antworten – das Programm zeigt die Antwort an, stellt aber nie selbst eine Rechnung aus.
 */
const CODE = /\bKV-\d{4}-\d{4,6}\b/i;
const MAX = 20_000;

export const withKvCode = (subject: string, number: string) => (subject.toUpperCase().includes(number.toUpperCase()) ? subject : `${subject.slice(0, 190 - number.length)} [${number}]`);

export async function logInvoiceMailOut(db: Exec, invoiceId: string, what: 'estimate' | 'invoice' | 'reminder' | 'reply' | 'order_confirm' | 'order_ready', actor: Actor, to: string, subject: string, body: string) {
  await db.insert(invoiceEvents).values({ invoiceId, kind: 'mail_out', what, who: `${actor.userName} → ${to}`, toAddr: to, subject: subject.slice(0, 300), body: body.slice(0, MAX) });
}
/** letzte Adresse, an die zu diesem Vorgang etwas gesendet wurde (Vorbelegung, z. B. für die Rechnung nach dem Kostenvoranschlag) */
export async function lastRecipient(db: Exec, invoiceId: string) {
  const [r] = await db.select({ to: invoiceEvents.toAddr }).from(invoiceEvents).where(and(eq(invoiceEvents.invoiceId, invoiceId), eq(invoiceEvents.kind, 'mail_out'))).orderBy(desc(invoiceEvents.at)).limit(1);
  return r?.to ?? '';
}

const fromOf = (m: { fromName: string; fromAddr: string }) => (m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr);
/** Neue Posteingangs-Mail dem Kostenvoranschlag zuordnen: technischer Verweis – oder KV-Nummer im Betreff und ein Absender, an den der Kostenvoranschlag ging */
export async function linkInboxMailToInvoice(db: Exec, m: { id: string; subject: string; body: string; fromName: string; fromAddr: string; receivedAt: Date }, opts: LinkOpts = {}): Promise<boolean> {
  const code = (opts.code ?? CODE.exec(m.subject)?.[0])?.toUpperCase();
  if (!code) return false;
  const [inv] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.estimateNumber, code));
  if (!inv) return false;
  if (!opts.trusted) {
    const [known] = !m.fromAddr.trim() ? [] : await db.select({ id: invoiceEvents.id }).from(invoiceEvents).where(and(eq(invoiceEvents.invoiceId, inv.id),
      sql`(lower(${invoiceEvents.toAddr}) = lower(${m.fromAddr}) or position(lower(${m.fromAddr}) in lower(${invoiceEvents.who})) > 0)`)).limit(1);
    if (!known) return false;
  }
  const rows = await db.insert(invoiceEvents).values({ invoiceId: inv.id, at: m.receivedAt, kind: 'mail_in', who: fromOf(m), subject: m.subject, body: m.body.slice(0, MAX), inboxMailId: m.id })
    .onConflictDoNothing().returning({ id: invoiceEvents.id });
  return rows.length > 0;
}
export async function assignInboxMailToInvoice(db: Db, actor: Actor, invoiceId: string, inboxMailId: string) {
  const [inv] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound('Rechnung');
  const [m] = await db.select().from(inboxMails).where(eq(inboxMails.id, inboxMailId));
  if (!m) throw notFound('E-Mail');
  const [used] = await db.select({ id: offerEvents.id }).from(offerEvents).where(eq(offerEvents.inboxMailId, inboxMailId));
  const rows = used ? [] : await db.insert(invoiceEvents).values({ invoiceId, at: m.receivedAt, kind: 'mail_in', who: fromOf(m), subject: m.subject, body: m.body.slice(0, MAX), inboxMailId })
    .onConflictDoNothing().returning({ id: invoiceEvents.id });
  if (!rows.length) throw conflict('Diese E-Mail ist schon einem Vorgang zugeordnet.');
  await record(db, actor, { action: 'assign_mail', entity: 'invoice', entityId: invoiceId, after: { subject: m.subject } });
  return { ok: true };
}
export async function removeInboxMailFromInvoice(db: Db, actor: Actor, invoiceId: string, eventId: string) {
  const rows = await db.delete(invoiceEvents).where(and(eq(invoiceEvents.id, eventId), eq(invoiceEvents.invoiceId, invoiceId), eq(invoiceEvents.kind, 'mail_in'))).returning({ subject: invoiceEvents.subject });
  if (!rows.length) throw notFound('Eintrag');
  await record(db, actor, { action: 'unassign_mail', entity: 'invoice', entityId: invoiceId, after: { subject: rows[0]!.subject } });
  return { ok: true };
}
export async function invoiceOfInboxMail(db: Exec, inboxMailId: string) {
  const [r] = await db.select({ id: invoices.id, number: invoices.number, estimateNumber: invoices.estimateNumber, status: invoices.status }).from(invoiceEvents)
    .innerJoin(invoices, eq(invoices.id, invoiceEvents.invoiceId)).where(eq(invoiceEvents.inboxMailId, inboxMailId));
  return r ? { id: r.id, estimateNumber: r.estimateNumber, label: r.status === 'draft' || !r.number ? `Kostenvoranschlag ${r.estimateNumber ?? ''}`.trim() : `Rechnung ${r.number}` } : null;
}

/**
 * Antwort auf „Bitte antworten Sie mit Ja oder Nein“: maßgeblich ist der eigene Text des Kunden (ohne Zitat), erste Zeile nach der Anrede.
 * „Ja“ mit Einschränkung („Ja, aber …“) gilt als unklar. Ohne Ja/Nein am Anfang greift die vorsichtige Stichwort-Erkennung der Angebote.
 */
export function yesNo(body: string): 'yes' | 'no' | 'unclear' | null {
  const text = ownText(body);
  if (!text) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l, i) => !(i === 0 && /^(guten (tag|morgen|abend)|hallo|sehr geehrte|liebe[rs]?|moin|servus|grüß gott|hi)\b.{0,60}$/i.test(l)));
  const first = (lines[0] ?? '').toLowerCase();
  const caveat = /(?:^|[^a-zäöüß])(aber|jedoch|allerdings|wenn|falls|sofern|vorausgesetzt|nur|statt|ohne|änder|frage|rückfrage|vielleicht|eventuell)/.test(` ${lines.join(' ').toLowerCase().slice(0, 600)}`);
  if (/^ja(?![a-zäöüß])/.test(first)) return caveat ? 'unclear' : 'yes';
  if (/^nein(?![a-zäöüß])/.test(first)) return 'no';
  const h = replyHint(body);
  return h === 'accept' ? 'yes' : h === 'decline' ? 'no' : 'unclear';
}

const WHAT: Record<string, string> = { reply: 'Unsere Antwort', estimate: 'Kostenvoranschlag gesendet', invoice: 'Rechnung gesendet', reminder: 'Zahlungserinnerung gesendet', order_confirm: 'Auftragsbestätigung gesendet', order_ready: '„Ware ist da“ gesendet' };
/** Vermerk ohne E-Mail am Verlauf (z. B. „Tisch reserviert“) */
export async function logInvoiceNote(db: Db, actor: Actor, invoiceId: string, what: 'table', text: string) {
  const [inv] = await db.select({ id: invoices.id }).from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound('Rechnung');
  await db.insert(invoiceEvents).values({ invoiceId, kind: 'note', what, who: actor.userName, subject: text.slice(0, 300) });
  await record(db, actor, { action: 'note', entity: 'invoice', entityId: invoiceId, after: { what, text: text.slice(0, 120) } });
  return { ok: true };
}

export async function invoiceTimeline(db: Exec, invoiceId: string): Promise<InvoiceTimeline> {
  const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) throw notFound('Rechnung');
  const events = await db.select().from(invoiceEvents).where(eq(invoiceEvents.invoiceId, invoiceId)).orderBy(asc(invoiceEvents.at));
  const entries: InvoiceTimelineEntry[] = events.map((x) => (x.kind === 'mail_out'
    ? { id: x.id, at: x.at.toISOString(), dir: 'out' as const, what: x.what, title: WHAT[x.what] ?? 'E-Mail gesendet', by: x.who, subject: x.subject, text: x.body, answer: null, removable: false }
    : x.kind === 'note' ? { id: x.id, at: x.at.toISOString(), dir: 'event' as const, what: x.what, title: x.subject || 'Vermerk', by: x.who, subject: '', text: '', answer: null, removable: false }
    : { id: x.id, at: x.at.toISOString(), dir: 'in' as const, title: 'Antwort des Kunden', by: x.who, subject: x.subject, text: x.body, answer: yesNo(x.body), removable: true }));
  if (inv.issuedAt && inv.number) entries.push({ id: 'issued', at: inv.issuedAt.toISOString(), dir: 'event', title: `Rechnung ${inv.number} ausgestellt`, by: inv.issuedBy, subject: '', text: '', answer: null, removable: false });
  entries.sort((a, b) => a.at.localeCompare(b.at));
  const outs = entries.filter((e) => e.dir === 'out'), ins = entries.filter((e) => e.dir === 'in');
  const lastOut = outs[outs.length - 1], lastIn = ins[ins.length - 1];
  const lastTo = [...events].reverse().find((x) => x.kind === 'mail_out')?.toAddr ?? '';
  const first = events.find((x) => x.kind === 'mail_out');
  const candidates = !lastTo || !first ? [] : (await db.select({ id: inboxMails.id, at: inboxMails.receivedAt, fromName: inboxMails.fromName, fromAddr: inboxMails.fromAddr, subject: inboxMails.subject })
    .from(inboxMails).where(and(sql`lower(${inboxMails.fromAddr}) = ${lastTo.trim().toLowerCase()}`, gte(inboxMails.receivedAt, first.at),
      sql`not exists (select 1 from ${invoiceEvents} where ${invoiceEvents.inboxMailId} = ${inboxMails.id})`,
      sql`not exists (select 1 from ${offerEvents} where ${offerEvents.inboxMailId} = ${inboxMails.id})`)).orderBy(desc(inboxMails.receivedAt)).limit(5))
    .map((m) => ({ inboxMailId: m.id, at: m.at.toISOString(), from: m.fromName || m.fromAddr, subject: m.subject }));
  return {
    code: inv.estimateNumber ? `[${inv.estimateNumber}]` : '', answer: lastIn?.answer ?? null,
    waiting: inv.status === 'draft' && !!lastOut && (!lastIn || lastIn.at < lastOut.at), lastTo, entries, candidates,
  };
}
