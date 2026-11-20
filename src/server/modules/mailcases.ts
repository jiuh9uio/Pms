import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import type { CaseDto, CaseListRow, CaseMessage, CaseStatus, CaseTurn, InboxStatus } from '../../shared/inbox.js';
import type { MailExtract, MailKind } from '../../shared/mailextract.js';
import { todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { inboxMails, invoiceEvents, invoices, mailCaseOut, mailCases, numberSequences, offerEvents, offers } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

/**
 * Vorgänge: ein E-Mail-Wechsel bekommt bei der ersten Antwort eine Nummer (V-Jahr-Nr.), die im Betreff jeder Antwort steht.
 * Antwortet der Kunde, wird seine E-Mail über die Nummer demselben Vorgang zugeordnet; die Adresse des Kunden ist am Vorgang gespeichert.
 * Angebote (AN-…) und Kostenvoranschläge (KV-…) haben ihren eigenen Verlauf und erscheinen in der Vorgangsliste mit.
 */
const CODE = /\bV-\d{4}-\d{4,6}\b/i;
const MAX = 20_000;
type Case = typeof mailCases.$inferSelect;

export const withCaseCode = (subject: string, number: string) => (subject.toUpperCase().includes(number.toUpperCase()) ? subject : `${subject.slice(0, 190 - number.length)} [${number}]`);
const cleanTitle = (s: string) => s.replace(/^((re|aw|fwd?|wg|antwort)\s*:\s*)+/i, '').replace(/\s*\[V-\d{4}-\d{4,6}\]/i, '').trim().slice(0, 200);
const fromOf = (m: { fromName: string; fromAddr: string }) => (m.fromName ? `${m.fromName} <${m.fromAddr}>` : m.fromAddr);

async function nextNumber(tx: Exec) {
  const year = Number(todayBerlin().slice(0, 4));
  const [row] = await tx.insert(numberSequences).values({ key: 'case', year, last: 1 })
    .onConflictDoUpdate({ target: [numberSequences.key, numberSequences.year], set: { last: sql`${numberSequences.last} + 1` } }).returning();
  return `V-${year}-${String(row!.last).padStart(4, '0')}`;
}

/** Vorgang zu einer Nachricht: vorhandenen liefern oder neu anlegen (Nummer, Kategorie und Kontakt aus der Nachricht) */
export async function ensureCaseForMail(db: Db, actor: Actor, inboxMailId: string): Promise<Case> {
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(inboxMails).where(eq(inboxMails.id, inboxMailId)).for('update');
    if (!m) throw notFound('E-Mail');
    if (m.caseId) { const [c] = await tx.select().from(mailCases).where(eq(mailCases.id, m.caseId)); if (c) return c; }
    const number = await nextNumber(tx);
    const [c] = await tx.insert(mailCases).values({ number, kind: m.kind, title: cleanTitle(m.subject) || '(ohne Betreff)', contactName: m.fromName, contactAddr: m.fromAddr.toLowerCase(), createdBy: actor.userName }).returning();
    await tx.update(inboxMails).set({ caseId: c!.id }).where(eq(inboxMails.id, inboxMailId));
    await record(tx, actor, { action: 'create', entity: 'mail_case', entityId: c!.id, after: { number, subject: m.subject.slice(0, 80) } });
    return c!;
  });
}
/** Gesendete Antwort am Vorgang festhalten; der Vorgang ist damit (wieder) offen und „wartet auf den Kunden“ */
export async function logCaseOut(db: Exec, caseId: string, actor: Actor, to: string, subject: string, body: string) {
  await db.insert(mailCaseOut).values({ caseId, by: actor.userName, toAddr: to, subject: subject.slice(0, 300), body: body.slice(0, MAX) });
  await db.update(mailCases).set({ updatedAt: new Date() }).where(eq(mailCases.id, caseId));
}
/**
 * Neue Posteingangs-Mail dem Vorgang zuordnen – nur mit sicherer Grundlage:
 * 1. technischer Verweis der E-Mail auf eine unserer Antworten (trusted) oder
 * 2. Vorgangsnummer im Betreff UND der Absender gehört schon zum Vorgang (Kontakt, früherer Absender oder Empfänger einer Antwort).
 * Eine Nummer nur im Text oder von einem fremden Absender ordnet nichts zu – die E-Mail erscheint im Vorgang als Vorschlag zur Prüfung.
 * Ein erledigter oder archivierter Vorgang wird durch eine neue Nachricht wieder geöffnet.
 */
export async function linkInboxMailToCase(db: Exec, m: { id: string; subject: string; body: string; fromAddr: string }, opts: { code?: string; trusted?: boolean } = {}): Promise<boolean> {
  const code = (opts.code ?? CODE.exec(m.subject)?.[0])?.toUpperCase();
  if (!code) return false;
  const [c] = await db.select({ id: mailCases.id, contactAddr: mailCases.contactAddr, status: mailCases.status }).from(mailCases).where(eq(mailCases.number, code));
  if (!c) return false;
  const from = m.fromAddr.trim().toLowerCase();
  if (!opts.trusted && c.contactAddr !== from) {
    if (!from) return false;
    const [known] = await db.execute(sql`select 1 as x where exists (select 1 from inbox_mails i where i.case_id = ${c.id} and lower(i.from_addr) = ${from})
      or exists (select 1 from mail_case_out o where o.case_id = ${c.id} and lower(o.to_addr) = ${from})`);
    if (!known) return false;
  }
  const rows = await db.update(inboxMails).set({ caseId: c.id }).where(and(eq(inboxMails.id, m.id), isNull(inboxMails.caseId))).returning({ id: inboxMails.id });
  if (rows.length) await db.update(mailCases).set({ status: c.status === 'working' ? 'working' : 'open', updatedAt: new Date() }).where(eq(mailCases.id, c.id));
  return rows.length > 0;
}
export async function caseRef(db: Exec, caseId: string | null) {
  if (!caseId) return null;
  const [c] = await db.select({ number: mailCases.number }).from(mailCases).where(eq(mailCases.id, caseId));
  return c?.number ?? null;
}

async function messagesOf(db: Exec, caseId: string): Promise<CaseMessage[]> {
  const ins = await db.select().from(inboxMails).where(eq(inboxMails.caseId, caseId));
  const outs = await db.select().from(mailCaseOut).where(eq(mailCaseOut.caseId, caseId));
  return [
    ...ins.map((m): CaseMessage => ({ id: m.id, at: m.receivedAt.toISOString(), dir: 'in', who: fromOf(m), subject: m.subject, text: m.body, inboxMailId: m.id, mailStatus: m.status as InboxStatus, attachments: (m.extract as MailExtract | null)?.attachments ?? [] })),
    ...outs.map((o): CaseMessage => ({ id: o.id, at: o.at.toISOString(), dir: 'out', who: `${o.by} → ${o.toAddr}`, subject: o.subject, text: o.body, inboxMailId: null, mailStatus: null, attachments: [] })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
const turnOf = (msgs: { dir: 'in' | 'out' }[]): CaseTurn | null => (msgs.length ? (msgs[msgs.length - 1]!.dir === 'in' ? 'ours' : 'theirs') : null);

export async function getCase(db: Exec, id: string): Promise<CaseDto> {
  const [c] = await db.select().from(mailCases).where(eq(mailCases.id, id));
  if (!c) throw notFound('Vorgang');
  const messages = await messagesOf(db, id);
  const latestIn = [...messages].reverse().find((m) => m.dir === 'in');
  // schon angelegt? (irgendeine Nachricht des Vorgangs wurde als Reservierung übernommen)
  const [linked] = await db.select({ k: inboxMails.linkKind, id: inboxMails.id }).from(inboxMails).where(and(eq(inboxMails.caseId, id), sql`${inboxMails.linkKind} is not null`)).limit(1);
  const link = (linked?.k ?? null) as 'booking' | 'table' | null;
  const [conf] = await db.select({ at: sql<string | null>`max(${inboxMails.extract}->>'confirmedAt')` }).from(inboxMails).where(eq(inboxMails.caseId, id));
  // Vorschläge: E-Mails derselben Adresse seit Beginn des Vorgangs, die noch nirgends zugeordnet sind
  const candidates = (await db.select({ id: inboxMails.id, at: inboxMails.receivedAt, fromName: inboxMails.fromName, fromAddr: inboxMails.fromAddr, subject: inboxMails.subject })
    .from(inboxMails).where(and(isNull(inboxMails.caseId), gte(inboxMails.receivedAt, c.createdAt),
      sql`(lower(${inboxMails.fromAddr}) = ${c.contactAddr} or position(${c.number} in upper(${inboxMails.subject})) > 0 or position(${c.number} in upper(${inboxMails.body})) > 0)`,
      sql`not exists (select 1 from ${offerEvents} where ${offerEvents.inboxMailId} = ${inboxMails.id})`,
      sql`not exists (select 1 from ${invoiceEvents} where ${invoiceEvents.inboxMailId} = ${inboxMails.id})`)).orderBy(desc(inboxMails.receivedAt)).limit(5))
    .map((m) => ({ inboxMailId: m.id, at: m.at.toISOString(), from: m.fromName || m.fromAddr, subject: m.subject }));
  return {
    id: c.id, number: c.number, kind: c.kind as MailKind, title: c.title, contactName: c.contactName, contactAddr: c.contactAddr, status: c.status as CaseStatus, turn: turnOf(messages),
    createdAt: c.createdAt.toISOString(), createdBy: c.createdBy, messages, latestInboxMailId: latestIn?.inboxMailId ?? null, latestLinkKind: link, linkedInboxMailId: linked?.id ?? null, confirmedAt: conf?.at ?? null, candidates,
  };
}

const snip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 140);
type ListFilter = { status: 'open' | 'done' | 'archived' | 'all'; kind: string; q: string; from?: string; to?: string };
/**
 * Liste aller Vorgänge – dazu die Verläufe von Angeboten und Kostenvoranschlägen, zu denen schon E-Mails gesendet oder empfangen wurden.
 * Je Quelle genau eine Abfrage (letzte Nachricht, Anzahl, Ungelesene per Unterabfrage) – auch bei mehreren Tausend E-Mails.
 * `mods` = was der Benutzer sehen darf: Angebote nur mit Freigabe für Hotel oder Restaurant.
 */
export async function listCases(db: Exec, f: ListFilter, mods: { offers: boolean } = { offers: true }): Promise<CaseListRow[]> {
  const q = f.q.trim().toLowerCase();
  const like = `%${q}%`;
  const out: CaseListRow[] = [];
  const inRange = (iso: string) => (!f.from || iso.slice(0, 10) >= f.from) && (!f.to || iso.slice(0, 10) <= f.to);
  if (f.kind !== 'offer' && f.kind !== 'estimate') {
    const statusSql = f.status === 'all' ? sql`true` : f.status === 'open' ? sql`c.status in ('open', 'working')` : sql`c.status = ${f.status}`;
    const rows = await db.execute(sql`
      select c.id, c.number, c.kind, c.title, c.status, c.contact_name, c.contact_addr, c.created_at,
        li.received_at as in_at, li.body as in_body, lo.at as out_at, lo.body as out_body,
        (select count(*)::int from inbox_mails m where m.case_id = c.id) + (select count(*)::int from mail_case_out o where o.case_id = c.id) as n,
        (select count(*)::int from inbox_mails m where m.case_id = c.id and m.status = 'new') as unread,
        exists (select 1 from inbox_mails m where m.case_id = c.id and m.link_kind is not null) as linked,
        exists (select 1 from inbox_mails m where m.case_id = c.id and m.extract ? 'confirmedAt') as confirmed
      from mail_cases c
        left join lateral (select received_at, left(body, 300) as body from inbox_mails m where m.case_id = c.id order by received_at desc limit 1) li on true
        left join lateral (select at, left(body, 300) as body from mail_case_out o where o.case_id = c.id order by at desc limit 1) lo on true
      where ${statusSql} and ${f.kind === 'all' ? sql`true` : sql`c.kind = ${f.kind}`}
        and ${q ? sql`(lower(c.number) like ${like} or lower(c.title) like ${like} or lower(c.contact_name) like ${like} or c.contact_addr like ${like})` : sql`true`}
      order by greatest(coalesce(li.received_at, c.created_at), coalesce(lo.at, c.created_at)) desc limit 300`);
    for (const r of rows as unknown as { id: string; number: string; kind: MailKind; title: string; status: CaseStatus; contact_name: string; contact_addr: string; created_at: Date | string;
      in_at: Date | string | null; in_body: string | null; out_at: Date | string | null; out_body: string | null; n: number; unread: number; linked: boolean; confirmed: boolean }[]) {
      const inAt = r.in_at ? new Date(r.in_at) : null, outAt = r.out_at ? new Date(r.out_at) : null;
      const lastIn = !!inAt && (!outAt || inAt >= outAt);
      const lastAt = (lastIn ? inAt : outAt ?? new Date(r.created_at))!.toISOString();
      if (!inRange(lastAt)) continue;
      out.push({ source: 'case', id: r.id, number: r.number, kind: r.kind, title: r.title, contact: r.contact_name || r.contact_addr, status: r.status,
        turn: inAt || outAt ? (lastIn ? 'ours' : 'theirs') : null, lastAt, snippet: snip((lastIn ? r.in_body : r.out_body) ?? ''), count: r.n, unread: r.unread, linked: r.linked, confirmed: r.confirmed });
    }
  }
  const wantOpen = f.status === 'open', wantDone = f.status === 'done';
  if (f.status !== 'archived' && mods.offers && (f.kind === 'all' || f.kind === 'offer')) {
    const rows = await db.execute(sql`
      select o.id, o.number, o.title, o.status, o.customer_company, o.customer_name, o.email, le.at, le.kind, le.body, (select count(*)::int from offer_events e where e.offer_id = o.id) as n
      from offers o join lateral (select at, kind, left(body, 300) as body from offer_events e where e.offer_id = o.id order by at desc limit 1) le on true
      where ${q ? sql`(lower(o.number) like ${like} or lower(o.title) like ${like} or lower(o.customer_company) like ${like} or lower(o.customer_name) like ${like} or lower(o.email) like ${like})` : sql`true`}
      order by le.at desc limit 200`);
    for (const r of rows as unknown as { id: string; number: string; title: string; status: string; customer_company: string; customer_name: string; email: string; at: Date | string; kind: string; body: string; n: number }[]) {
      const status: CaseStatus = r.status === 'accepted' || r.status === 'declined' ? 'done' : 'open';
      const lastAt = new Date(r.at).toISOString();
      if ((wantOpen && status !== 'open') || (wantDone && status !== 'done') || !inRange(lastAt)) continue;
      out.push({ source: 'offer', id: r.id, number: r.number, kind: 'offer', title: r.title || 'Angebot', contact: [r.customer_company, r.customer_name].filter(Boolean).join(', ') || r.email, status,
        turn: r.kind === 'mail_in' ? 'ours' : 'theirs', lastAt, snippet: snip(r.body), count: r.n, unread: 0 });
    }
  }
  if (f.status !== 'archived' && (f.kind === 'all' || f.kind === 'estimate')) {
    const rows = await db.execute(sql`
      select i.id, i.number, i.estimate_number, i.status, i.recipient_company, i.recipient_name, le.at, le.kind, le.body,
        (select count(*)::int from invoice_events e where e.invoice_id = i.id) as n, (select to_addr from invoice_events e where e.invoice_id = i.id and e.to_addr <> '' order by at desc limit 1) as to_addr
      from invoices i join lateral (select at, kind, left(body, 300) as body from invoice_events e where e.invoice_id = i.id order by at desc limit 1) le on true
      where i.estimate_number is not null
        and ${q ? sql`(lower(i.estimate_number) like ${like} or lower(coalesce(i.number, '')) like ${like} or lower(i.recipient_company) like ${like} or lower(i.recipient_name) like ${like})` : sql`true`}
      order by le.at desc limit 200`);
    for (const r of rows as unknown as { id: string; number: string | null; estimate_number: string; status: string; recipient_company: string; recipient_name: string; at: Date | string; kind: string; body: string; n: number; to_addr: string | null }[]) {
      const status: CaseStatus = r.status === 'draft' ? 'open' : 'done';
      const lastAt = new Date(r.at).toISOString();
      if ((wantOpen && status !== 'open') || (wantDone && status !== 'done') || !inRange(lastAt)) continue;
      out.push({ source: 'invoice', id: r.id, number: r.estimate_number, kind: 'estimate', title: r.status === 'draft' ? 'Kostenvoranschlag' : `Kostenvoranschlag → Rechnung ${r.number ?? ''}`,
        contact: [r.recipient_company, r.recipient_name].filter(Boolean).join(', ') || (r.to_addr ?? ''), status, turn: r.kind === 'mail_in' ? 'ours' : 'theirs', lastAt, snippet: snip(r.body), count: r.n, unread: 0 });
    }
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function updateCase(db: Db, actor: Actor, id: string, v: { kind?: MailKind; status?: CaseStatus; title?: string }) {
  const [before] = await db.select().from(mailCases).where(eq(mailCases.id, id));
  if (!before) throw notFound('Vorgang');
  await db.update(mailCases).set({ ...(v.kind ? { kind: v.kind } : {}), ...(v.status ? { status: v.status } : {}), ...(v.title !== undefined ? { title: v.title || before.title } : {}) }).where(eq(mailCases.id, id));
  // die Kategorie gilt für den ganzen Vorgang – so passen auch die Aktionen an der Nachricht (Zimmer übernehmen, Tisch reservieren …)
  if (v.kind) await db.update(inboxMails).set({ kind: v.kind }).where(eq(inboxMails.caseId, id));
  // „erledigt“ gilt auch für die noch offenen Nachrichten des Vorgangs
  if (v.status === 'done' || v.status === 'archived') await db.update(inboxMails).set({ status: 'done', handledBy: actor.userName }).where(and(eq(inboxMails.caseId, id), eq(inboxMails.status, 'new')));
  await record(db, actor, { action: 'update', entity: 'mail_case', entityId: id, before: { kind: before.kind, status: before.status }, after: { number: before.number, ...v } });
  return getCase(db, id);
}
/** Nachricht von Hand einem Vorgang zuordnen */
export async function assignMailToCase(db: Db, actor: Actor, caseId: string, inboxMailId: string) {
  const [c] = await db.select().from(mailCases).where(eq(mailCases.id, caseId));
  if (!c) throw notFound('Vorgang');
  const rows = await db.update(inboxMails).set({ caseId }).where(and(eq(inboxMails.id, inboxMailId), isNull(inboxMails.caseId))).returning({ subject: inboxMails.subject });
  if (!rows.length) throw conflict('Diese E-Mail gehört schon zu einem Vorgang (oder es gibt sie nicht mehr).');
  await db.update(mailCases).set({ status: 'open', updatedAt: new Date() }).where(eq(mailCases.id, caseId));
  await record(db, actor, { action: 'assign_mail', entity: 'mail_case', entityId: caseId, after: { number: c.number, subject: rows[0]!.subject.slice(0, 80) } });
  return getCase(db, caseId);
}
/** Zuordnung lösen (die Nachricht bleibt im Posteingang) */
export async function removeMailFromCase(db: Db, actor: Actor, caseId: string, inboxMailId: string) {
  const rows = await db.update(inboxMails).set({ caseId: null }).where(and(eq(inboxMails.id, inboxMailId), eq(inboxMails.caseId, caseId))).returning({ subject: inboxMails.subject });
  if (!rows.length) throw notFound('Eintrag');
  await record(db, actor, { action: 'unassign_mail', entity: 'mail_case', entityId: caseId, after: { subject: rows[0]!.subject.slice(0, 80) } });
  return getCase(db, caseId);
}

/** Nachricht in einen anderen Vorgang verschieben (falsch zugeordnet) – Ziel über die Vorgangsnummer */
export async function moveMail(db: Db, actor: Actor, caseId: string, inboxMailId: string, targetNumber: string) {
  const [target] = await db.select().from(mailCases).where(eq(mailCases.number, targetNumber.trim().toUpperCase()));
  if (!target) throw notFound('Vorgang mit dieser Nummer');
  if (target.id === caseId) throw conflict('Die E-Mail gehört schon zu diesem Vorgang.');
  const rows = await db.update(inboxMails).set({ caseId: target.id }).where(and(eq(inboxMails.id, inboxMailId), eq(inboxMails.caseId, caseId))).returning({ subject: inboxMails.subject });
  if (!rows.length) throw notFound('Eintrag');
  await db.update(mailCases).set({ updatedAt: new Date() }).where(eq(mailCases.id, target.id));
  await record(db, actor, { action: 'move_mail', entity: 'mail_case', entityId: caseId, after: { nach: target.number, subject: rows[0]!.subject.slice(0, 80) } });
  return { id: target.id, number: target.number };
}
/** Nachricht abtrennen: sie bekommt einen eigenen, neuen Vorgang (eigene Nummer) */
export async function splitMail(db: Db, actor: Actor, caseId: string, inboxMailId: string) {
  const rows = await db.update(inboxMails).set({ caseId: null }).where(and(eq(inboxMails.id, inboxMailId), eq(inboxMails.caseId, caseId))).returning({ id: inboxMails.id });
  if (!rows.length) throw notFound('Eintrag');
  const c = await ensureCaseForMail(db, actor, inboxMailId);
  await record(db, actor, { action: 'split_mail', entity: 'mail_case', entityId: caseId, after: { neu: c.number } });
  return { id: c.id, number: c.number };
}
/**
 * Zwei Vorgänge zusammenführen: alle Nachrichten und Antworten dieses Vorgangs wandern in den Zielvorgang.
 * Der leere Vorgang bleibt archiviert bestehen (seine Nummer wird nie neu vergeben und verweist auf den Zielvorgang).
 */
export async function mergeCase(db: Db, actor: Actor, caseId: string, targetNumber: string) {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(mailCases).where(eq(mailCases.id, caseId)).for('update');
    if (!src) throw notFound('Vorgang');
    const [target] = await tx.select().from(mailCases).where(eq(mailCases.number, targetNumber.trim().toUpperCase())).for('update');
    if (!target) throw notFound('Vorgang mit dieser Nummer');
    if (target.id === src.id) throw conflict('Das ist derselbe Vorgang.');
    const moved = await tx.update(inboxMails).set({ caseId: target.id }).where(eq(inboxMails.caseId, src.id)).returning({ id: inboxMails.id });
    const outs = await tx.update(mailCaseOut).set({ caseId: target.id }).where(eq(mailCaseOut.caseId, src.id)).returning({ id: mailCaseOut.id });
    await tx.update(mailCases).set({ status: 'archived', title: `→ zusammengeführt mit ${target.number}: ${src.title}`.slice(0, 200), updatedAt: new Date() }).where(eq(mailCases.id, src.id));
    await tx.update(mailCases).set({ status: target.status === 'working' ? 'working' : 'open', updatedAt: new Date() }).where(eq(mailCases.id, target.id));
    await record(tx, actor, { action: 'merge', entity: 'mail_case', entityId: src.id, after: { von: src.number, nach: target.number, nachrichten: moved.length + outs.length } });
    return { id: target.id, number: target.number };
  });
}
