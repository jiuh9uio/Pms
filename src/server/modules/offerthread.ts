import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';
import type { OfferAnswers, OfferTalk, OfferTimeline, OfferTimelineEntry } from '../../shared/offers.js';
import type { Db, Exec } from '../db/client.js';
import { inboxAttachments, inboxMails, offerEvents, offers } from '../db/schema.js';
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

/** Zuordnung nur mit sicherer Grundlage: technischer Verweis (trusted) oder Nummer im Betreff UND bekannter Absender */
export interface LinkOpts { /** Kennzeichen aus den technischen Verweisen der E-Mail */ code?: string; /** true = über In-Reply-To/References erkannt (nicht fälschbar durch bloßes Abtippen der Nummer) */ trusted?: boolean }
const sameAddr = (a: string, b: string) => !!a.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Neue Posteingangs-Mail dem Angebot zuordnen. Die Nummer muss im Betreff stehen (im Text genügt nicht – zitierte oder weitergeleitete
 * Nachrichten enthalten oft fremde Nummern) und der Absender muss zum Angebot gehören; sonst bleibt die E-Mail zur manuellen Prüfung offen.
 */
export async function linkInboxMail(db: Exec, m: { id: string; subject: string; body: string; fromName: string; fromAddr: string; receivedAt: Date }, opts: LinkOpts = {}): Promise<boolean> {
  const code = (opts.code ?? CODE.exec(m.subject)?.[0])?.toUpperCase();
  if (!code) return false;
  const [o] = await db.select({ id: offers.id, email: offers.email }).from(offers).where(eq(offers.number, code));
  if (!o) return false;
  if (!opts.trusted && !sameAddr(o.email, m.fromAddr)) {
    const [known] = await db.select({ id: offerEvents.id }).from(offerEvents).where(and(eq(offerEvents.offerId, o.id), sql`position(lower(${m.fromAddr}) in lower(${offerEvents.who})) > 0`)).limit(1);
    if (!known || !m.fromAddr.trim()) return false;
  }
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
  const e = (id: string, at: Date | string, title: string, by = '', text = ''): OfferTimelineEntry => ({ id, at: typeof at === 'string' ? at : at.toISOString(), dir: 'event', title, by, subject: '', text, hint: null, removable: false, attachments: [] });
  const mailIds = events.map((x) => x.inboxMailId).filter((x): x is string => !!x);
  const att = !mailIds.length ? [] : await db.select({ id: inboxAttachments.id, mailId: inboxAttachments.inboxMailId, name: inboxAttachments.name, size: inboxAttachments.sizeBytes, type: inboxAttachments.mime }).from(inboxAttachments).where(sql`${inboxAttachments.inboxMailId} in ${mailIds}`);
  const entries: OfferTimelineEntry[] = [e('created', o.createdAt, 'Angelegt', o.createdBy)];
  const talk = o.talk as OfferTalk | null, answers = o.answers as OfferAnswers | null;
  if (talk) entries.push(e('talk', talk.at, `Absprache am Tisch${talk.template ? ` – ${talk.template}` : ''}`, talk.by, talk.steps.filter((s) => s.answers.length || s.text).map((s) => `${s.title}: ${[s.answers.join(', '), s.text].filter(Boolean).join(' – ')}`).join('\n')));
  for (const x of events) {
    entries.push(x.kind === 'mail_out'
      ? { id: x.id, at: x.at.toISOString(), dir: 'out', title: WHAT[x.what] ?? 'E-Mail gesendet', by: x.who, subject: x.subject, text: x.body, hint: null, removable: false, attachments: [] }
      : { id: x.id, at: x.at.toISOString(), dir: 'in', title: 'Antwort des Kunden', by: x.who, subject: x.subject, text: x.body, hint: replyHint(x.body), removable: true, attachments: x.inboxMailId ? att.filter((a) => a.mailId === x.inboxMailId).map((a) => ({ id: a.id, name: a.name, size: a.size, type: a.type })) : [] });
  }
  // ältere Angebote (vor dem Verlauf versendet): wenigstens den Versand zeigen
  if (o.sentAt && !events.some((x) => x.kind === 'mail_out')) entries.push(e('sent', o.sentAt, o.mode === 'questions' ? 'Fragen gesendet' : 'Angebot gesendet', o.sentTo ? `an ${o.sentTo}` : ''));
  if (answers) entries.push({ ...e('answers', answers.at, 'Fragen online beantwortet', answers.name, answers.items.map((x) => `${x.q}: ${x.a || '–'}`).join('\n')), dir: 'in' });
  if (o.acceptedAt) entries.push(e('accepted', o.acceptedAt, `Angenommen (${METHOD[o.acceptedMethod] ?? o.acceptedMethod})`, o.acceptedBy));
  if (o.declinedAt) entries.push(e('declined', o.declinedAt, 'Abgelehnt'));
  entries.sort((a, b) => a.at.localeCompare(b.at));
  // Vorschläge: E-Mails derselben Adresse seit dem Anlegen, die noch keinem Angebot zugeordnet sind
  const addr = o.email.trim().toLowerCase();
  const candidates = (await db.select({ id: inboxMails.id, at: inboxMails.receivedAt, fromName: inboxMails.fromName, fromAddr: inboxMails.fromAddr, subject: inboxMails.subject })
    .from(inboxMails).where(and(gte(inboxMails.receivedAt, o.createdAt),
      // gleiche Adresse – oder die Angebotsnummer steht in der E-Mail, sie kam aber von einem anderen Absender (deshalb nicht automatisch zugeordnet)
      sql`((${addr} <> '' and lower(${inboxMails.fromAddr}) = ${addr}) or position(${o.number} in upper(${inboxMails.subject})) > 0)`,
      sql`not exists (select 1 from ${offerEvents} where ${offerEvents.inboxMailId} = ${inboxMails.id})`)).orderBy(desc(inboxMails.receivedAt)).limit(5))
    .map((m) => ({ inboxMailId: m.id, at: m.at.toISOString(), from: m.fromName || m.fromAddr, subject: m.subject }));
  return { code: `[${o.number}]`, entries, candidates };
}

/** Anhang einer E-Mail, die zum Verlauf dieses Angebots gehört (nur dann darf er über das Angebot gelesen werden) */
export async function offerAttachment(db: Exec, offerId: string, attachmentId: string) {
  const [a] = await db.select({ a: inboxAttachments }).from(inboxAttachments)
    .innerJoin(offerEvents, and(eq(offerEvents.inboxMailId, inboxAttachments.inboxMailId), eq(offerEvents.offerId, offerId))).where(eq(inboxAttachments.id, attachmentId)).limit(1);
  if (!a) throw notFound('Anhang');
  return a.a;
}
