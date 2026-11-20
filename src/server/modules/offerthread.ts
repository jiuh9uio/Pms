import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { OfferAnswers, OfferTalk, OfferTimeline, OfferTimelineEntry } from '../../shared/offers.js';
import type { Db, Exec } from '../db/client.js';
import { inboxMails, offerEvents, offers } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

/**
 * Verlauf eines Angebots. Jede E-Mail zu einem Angebot trägt die Angebotsnummer als Kennzeichen im Betreff (z. B. „[AN-2026-0005]“);
 * Antworten im Posteingang werden daran erkannt und dem Angebot zugeordnet. Ob eine Antwort eine Zusage ist, wird nur als Hinweis
 * angezeigt – angenommen wird ein Angebot ausschließlich von Hand oder online über den Link.
 */
const CODE = /\bAN-\d{4}-\d{4,6}\b/i;
const MAX = 20_000;

/** Kennzeichen an den Betreff hängen, falls die Nummer nicht schon darin steht */
export const withCode = (subject: string, number: string) => (subject.toUpperCase().includes(number.toUpperCase()) ? subject : `${subject.slice(0, 190 - number.length)} [${number}]`);

export async function logMailOut(db: Exec, offerId: string, what: 'questions' | 'catalog' | 'offer' | 'reply', actor: Actor, to: string, subject: string, body: string) {
  await db.insert(offerEvents).values({ offerId, kind: 'mail_out', what, who: `${actor.userName} → ${to}`, subject: subject.slice(0, 300), body: body.slice(0, MAX) });
}

/** Neue Posteingangs-Mail: Kennzeichen im Betreff (sonst im Text) suchen und dem Angebot zuordnen. Fehler dürfen den Abruf nicht stören. */
export async function linkInboxMail(db: Exec, m: { id: string; subject: string; body: string; fromName: string; fromAddr: string; receivedAt: Date }): Promise<boolean> {
  const code = (CODE.exec(m.subject) ?? CODE.exec(m.body))?.[0]?.toUpperCase();
  if (!code) return false;
  const [o] = await db.select({ id: offers.id }).from(offers).where(eq(offers.number, code));
  if (!o) return false;
  const rows = await db.insert(offerEvents).values({ offerId: o.id, at: m.receivedAt, kind: 'mail_in', who: m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr, subject: m.subject, body: m.body.slice(0, MAX), inboxMailId: m.id })
    .onConflictDoNothing().returning({ id: offerEvents.id });
  return rows.length > 0;
}

/** Posteingangs-Mail von Hand zuordnen (z. B. wenn der Kunde eine neue E-Mail ohne Kennzeichen geschrieben hat) */
export async function assignInboxMail(db: Db, actor: Actor, offerId: string, inboxMailId: string) {
  const [o] = await db.select({ id: offers.id, number: offers.number }).from(offers).where(eq(offers.id, offerId));
  if (!o) throw notFound('Angebot');
  const [m] = await db.select().from(inboxMails).where(eq(inboxMails.id, inboxMailId));
  if (!m) throw notFound('E-Mail');
  const rows = await db.insert(offerEvents).values({ offerId, at: m.receivedAt, kind: 'mail_in', who: m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr, subject: m.subject, body: m.body.slice(0, MAX), inboxMailId })
    .onConflictDoNothing().returning({ id: offerEvents.id });
  if (!rows.length) throw conflict('Diese E-Mail ist schon einem Angebot zugeordnet.');
  await record(db, actor, { action: 'assign_mail', entity: 'offer', entityId: offerId, after: { number: o.number, subject: m.subject } });
  return { ok: true };
}
/** Zuordnung einer Antwort wieder lösen (die E-Mail im Posteingang bleibt unverändert) */
export async function removeInboxMail(db: Db, actor: Actor, offerId: string, eventId: string) {
  const rows = await db.delete(offerEvents).where(and(eq(offerEvents.id, eventId), eq(offerEvents.offerId, offerId), eq(offerEvents.kind, 'mail_in'))).returning({ subject: offerEvents.subject });
  if (!rows.length) throw notFound('Eintrag');
  await record(db, actor, { action: 'unassign_mail', entity: 'offer', entityId: offerId, after: { subject: rows[0]!.subject } });
  return { ok: true };
}
export async function offerOfInboxMail(db: Exec, inboxMailId: string) {
  const [r] = await db.select({ id: offers.id, number: offers.number }).from(offerEvents).innerJoin(offers, eq(offers.id, offerEvents.offerId)).where(eq(offerEvents.inboxMailId, inboxMailId));
  return r ?? null;
}

/** Nur den neuen Teil einer Antwort betrachten (ohne zitierte ursprüngliche Nachricht) */
export function ownText(body: string) {
  const out: string[] = [];
  for (const line of body.split('\n')) {
    const l = line.trim();
    if (/^(-{2,}\s*(Ihre Nachricht|Ursprüngliche Nachricht|Original Message)|Am .{5,80} schrieb|On .{5,80} wrote|Von: .+|From: .+)/i.test(l)) break;
    if (!l.startsWith('>')) out.push(line);
  }
  return out.join('\n').trim();
}
/** Hinweis, ob eine Antwort nach Zusage oder Absage klingt – bewusst vorsichtig; bei „aber/wenn/falls/nur“ kein Zusage-Hinweis */
export function replyHint(body: string): 'accept' | 'decline' | null {
  const t = ` ${ownText(body).toLowerCase().slice(0, 1500).replace(/\s+/g, ' ')} `;
  if (!t.trim()) return null;
  // W = Wortanfang (auch vor Umlauten; \b kennt nur a–z)
  const W = '(?:^|[^a-zäöüß])';
  const has = (re: string) => new RegExp(W + re).test(t);
  const obj = '(?:das angebot |ihr angebot |dieses angebot |es )?';
  if (has(`(?:absage|absagen|sagen (?:wir|ich) (?:leider )?ab|leider nicht|kein interesse|nehmen? (?:wir |ich )?${obj}(?:leider )?nicht an|nicht annehmen|stornier|anderweitig entschieden|haben uns (?:dagegen|anders) entschieden)`)) return 'decline';
  const yes = has(`(?:nehmen? (?:wir |ich )?${obj}(?:gerne |gern |hiermit |so |dankend )*an[ .,!]|angebot (?:wird |ist )?(?:hiermit )?(?:angenommen|bestätigt)|hiermit bestätig|bestätigen? (?:wir |ich )?(?:hiermit |gerne |gern )*(?:das|ihr|den|die) |(?:sind|bin) (?:wir |ich )?(?:damit )?einverstanden|zusage|sagen (?:wir|ich) (?:gerne |gern |hiermit )*zu[ .,!]|buchen (?:wir|ich) (?:gerne |gern |hiermit |verbindlich )|passt (?:alles |uns )?so[ .,!])`);
  if (!yes) return null;
  return has('(?:aber|jedoch|allerdings|wenn|falls|sofern|vorausgesetzt|unter der bedingung|nur noch|statt|anstelle|änder|rückfrage|frage)') ? null : 'accept';
}

const WHAT: Record<string, string> = { reply: 'Unsere Antwort', questions: 'Fragen gesendet', catalog: 'Katalog gesendet', offer: 'Angebot gesendet' };
const METHOD: Record<string, string> = { online: 'online über den Link', email: 'per E-Mail', telefon: 'telefonisch', persoenlich: 'persönlich', schriftlich: 'schriftlich' };

export async function timeline(db: Exec, offerId: string): Promise<OfferTimeline> {
  const [o] = await db.select().from(offers).where(eq(offers.id, offerId));
  if (!o) throw notFound('Angebot');
  const events = await db.select().from(offerEvents).where(eq(offerEvents.offerId, offerId)).orderBy(asc(offerEvents.at));
  const e = (id: string, at: Date | string, title: string, by = '', text = ''): OfferTimelineEntry => ({ id, at: typeof at === 'string' ? at : at.toISOString(), dir: 'event', title, by, subject: '', text, hint: null, removable: false });
  const entries: OfferTimelineEntry[] = [e('created', o.createdAt, 'Angelegt', o.createdBy)];
  const talk = o.talk as OfferTalk | null, answers = o.answers as OfferAnswers | null;
  if (talk) entries.push(e('talk', talk.at, `Absprache am Tisch${talk.template ? ` – ${talk.template}` : ''}`, talk.by, talk.steps.filter((s) => s.answers.length || s.text).map((s) => `${s.title}: ${[s.answers.join(', '), s.text].filter(Boolean).join(' – ')}`).join('\n')));
  for (const x of events) {
    entries.push(x.kind === 'mail_out'
      ? { id: x.id, at: x.at.toISOString(), dir: 'out', title: WHAT[x.what] ?? 'E-Mail gesendet', by: x.who, subject: x.subject, text: x.body, hint: null, removable: false }
      : { id: x.id, at: x.at.toISOString(), dir: 'in', title: 'Antwort des Kunden', by: x.who, subject: x.subject, text: x.body, hint: replyHint(x.body), removable: true });
  }
  // ältere Angebote (vor dem Verlauf versendet): wenigstens den Versand zeigen
  if (o.sentAt && !events.some((x) => x.kind === 'mail_out')) entries.push(e('sent', o.sentAt, o.mode === 'questions' ? 'Fragen gesendet' : 'Angebot gesendet', o.sentTo ? `an ${o.sentTo}` : ''));
  if (answers) entries.push({ ...e('answers', answers.at, 'Fragen online beantwortet', answers.name, answers.items.map((x) => `${x.q}: ${x.a || '–'}`).join('\n')), dir: 'in' });
  if (o.acceptedAt) entries.push(e('accepted', o.acceptedAt, `Angenommen (${METHOD[o.acceptedMethod] ?? o.acceptedMethod})`, o.acceptedBy));
  if (o.declinedAt) entries.push(e('declined', o.declinedAt, 'Abgelehnt'));
  entries.sort((a, b) => a.at.localeCompare(b.at));
  // Vorschläge: E-Mails derselben Adresse seit dem Anlegen, die noch keinem Angebot zugeordnet sind
  const addr = o.email.trim().toLowerCase();
  const candidates = !addr ? [] : (await db.select({ id: inboxMails.id, at: inboxMails.receivedAt, fromName: inboxMails.fromName, fromAddr: inboxMails.fromAddr, subject: inboxMails.subject })
    .from(inboxMails).where(and(sql`lower(${inboxMails.fromAddr}) = ${addr}`, gte(inboxMails.receivedAt, o.createdAt),
      sql`not exists (select 1 from ${offerEvents} where ${offerEvents.inboxMailId} = ${inboxMails.id})`)).orderBy(desc(inboxMails.receivedAt)).limit(5))
    .map((m) => ({ inboxMailId: m.id, at: m.at.toISOString(), from: m.fromName || m.fromAddr, subject: m.subject }));
  return { code: `[${o.number}]`, entries, candidates };
}
