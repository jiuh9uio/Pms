import { and, asc, desc, eq, gte, ilike, isNull, or, sql } from 'drizzle-orm';
import type { CaseDto, CaseListRow, CaseMessage, CaseStatus, CaseTurn, InboxStatus } from '../../shared/inbox.js';
import type { MailKind } from '../../shared/mailextract.js';
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
/** Neue Posteingangs-Mail: Vorgangsnummer im Betreff (sonst im Text) suchen und zuordnen; ein erledigter Vorgang wird wieder geöffnet */
export async function linkInboxMailToCase(db: Exec, m: { id: string; subject: string; body: string }): Promise<boolean> {
  const code = (CODE.exec(m.subject) ?? CODE.exec(m.body))?.[0]?.toUpperCase();
  if (!code) return false;
  const [c] = await db.select({ id: mailCases.id }).from(mailCases).where(eq(mailCases.number, code));
  if (!c) return false;
  const rows = await db.update(inboxMails).set({ caseId: c.id }).where(and(eq(inboxMails.id, m.id), isNull(inboxMails.caseId))).returning({ id: inboxMails.id });
  if (rows.length) await db.update(mailCases).set({ status: 'open', updatedAt: new Date() }).where(eq(mailCases.id, c.id));
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
    ...ins.map((m): CaseMessage => ({ id: m.id, at: m.receivedAt.toISOString(), dir: 'in', who: fromOf(m), subject: m.subject, text: m.body, inboxMailId: m.id, mailStatus: m.status as InboxStatus })),
    ...outs.map((o): CaseMessage => ({ id: o.id, at: o.at.toISOString(), dir: 'out', who: `${o.by} → ${o.toAddr}`, subject: o.subject, text: o.body, inboxMailId: null, mailStatus: null })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
const turnOf = (msgs: { dir: 'in' | 'out' }[]): CaseTurn | null => (msgs.length ? (msgs[msgs.length - 1]!.dir === 'in' ? 'ours' : 'theirs') : null);

export async function getCase(db: Exec, id: string): Promise<CaseDto> {
  const [c] = await db.select().from(mailCases).where(eq(mailCases.id, id));
  if (!c) throw notFound('Vorgang');
  const messages = await messagesOf(db, id);
  const latestIn = [...messages].reverse().find((m) => m.dir === 'in');
  // schon angelegt? (irgendeine Nachricht des Vorgangs wurde als Reservierung übernommen)
  const [linked] = await db.select({ k: inboxMails.linkKind }).from(inboxMails).where(and(eq(inboxMails.caseId, id), sql`${inboxMails.linkKind} is not null`)).limit(1);
  const link = (linked?.k ?? null) as 'booking' | 'table' | null;
  // Vorschläge: E-Mails derselben Adresse seit Beginn des Vorgangs, die noch nirgends zugeordnet sind
  const candidates = !c.contactAddr ? [] : (await db.select({ id: inboxMails.id, at: inboxMails.receivedAt, fromName: inboxMails.fromName, fromAddr: inboxMails.fromAddr, subject: inboxMails.subject })
    .from(inboxMails).where(and(sql`lower(${inboxMails.fromAddr}) = ${c.contactAddr}`, isNull(inboxMails.caseId), gte(inboxMails.receivedAt, c.createdAt),
      sql`not exists (select 1 from ${offerEvents} where ${offerEvents.inboxMailId} = ${inboxMails.id})`,
      sql`not exists (select 1 from ${invoiceEvents} where ${invoiceEvents.inboxMailId} = ${inboxMails.id})`)).orderBy(desc(inboxMails.receivedAt)).limit(5))
    .map((m) => ({ inboxMailId: m.id, at: m.at.toISOString(), from: m.fromName || m.fromAddr, subject: m.subject }));
  return {
    id: c.id, number: c.number, kind: c.kind as MailKind, title: c.title, contactName: c.contactName, contactAddr: c.contactAddr, status: c.status as CaseStatus, turn: turnOf(messages),
    createdAt: c.createdAt.toISOString(), createdBy: c.createdBy, messages, latestInboxMailId: latestIn?.inboxMailId ?? null, latestLinkKind: link, candidates,
  };
}

const snip = (s: string) => s.replace(/\s+/g, ' ').slice(0, 140);
/** Liste aller Vorgänge – dazu die Verläufe von Angeboten und Kostenvoranschlägen, zu denen schon E-Mails gesendet oder empfangen wurden */
export async function listCases(db: Exec, f: { status: 'open' | 'done' | 'all'; kind: string; q: string }): Promise<CaseListRow[]> {
  const q = f.q.trim().toLowerCase();
  const out: CaseListRow[] = [];
  if (f.kind !== 'offer' && f.kind !== 'estimate') {
    const cases = await db.select().from(mailCases).where(and(
      f.status === 'all' ? undefined : eq(mailCases.status, f.status), f.kind === 'all' ? undefined : eq(mailCases.kind, f.kind as MailKind),
      q ? or(ilike(mailCases.number, `%${q}%`), ilike(mailCases.title, `%${q}%`), ilike(mailCases.contactName, `%${q}%`), ilike(mailCases.contactAddr, `%${q}%`)) : undefined,
    )).orderBy(desc(mailCases.updatedAt)).limit(200);
    for (const c of cases) {
      const msgs = await messagesOf(db, c.id);
      const last = msgs[msgs.length - 1];
      out.push({ source: 'case', id: c.id, number: c.number, kind: c.kind as MailKind, title: c.title, contact: c.contactName || c.contactAddr, status: c.status as CaseStatus, turn: turnOf(msgs),
        lastAt: last?.at ?? c.createdAt.toISOString(), snippet: last ? snip(last.text) : '', count: msgs.length });
    }
  }
  const hit = (...s: string[]) => !q || s.some((x) => x.toLowerCase().includes(q));
  if (f.kind === 'all' || f.kind === 'offer') {
    const rows = await db.select({ e: offerEvents, o: offers }).from(offerEvents).innerJoin(offers, eq(offers.id, offerEvents.offerId)).orderBy(asc(offerEvents.at));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.o.id, [...(by.get(r.o.id) ?? []), r]);
    for (const list of by.values()) {
      const o = list[0]!.o, last = list[list.length - 1]!.e;
      const status: CaseStatus = o.status === 'accepted' || o.status === 'declined' ? 'done' : 'open';
      const contact = [o.customerCompany, o.customerName].filter(Boolean).join(', ');
      if ((f.status !== 'all' && f.status !== status) || !hit(o.number, o.title, contact, o.email)) continue;
      out.push({ source: 'offer', id: o.id, number: o.number, kind: 'offer', title: o.title || 'Angebot', contact, status, turn: last.kind === 'mail_in' ? 'ours' : 'theirs', lastAt: last.at.toISOString(), snippet: snip(last.body), count: list.length });
    }
  }
  if (f.kind === 'all' || f.kind === 'estimate') {
    const rows = await db.select({ e: invoiceEvents, i: invoices }).from(invoiceEvents).innerJoin(invoices, eq(invoices.id, invoiceEvents.invoiceId)).orderBy(asc(invoiceEvents.at));
    const by = new Map<string, typeof rows>();
    for (const r of rows) by.set(r.i.id, [...(by.get(r.i.id) ?? []), r]);
    for (const list of by.values()) {
      const i = list[0]!.i, last = list[list.length - 1]!.e;
      if (!i.estimateNumber) continue; // reine Rechnungs-E-Mails ohne Kostenvoranschlag gehören nicht in die Vorgangsliste
      const status: CaseStatus = i.status === 'draft' ? 'open' : 'done';
      const contact = [i.recipientCompany, i.recipientName].filter(Boolean).join(', ') || (list.find((x) => x.e.toAddr)?.e.toAddr ?? '');
      if ((f.status !== 'all' && f.status !== status) || !hit(i.estimateNumber, i.number ?? '', contact)) continue;
      out.push({ source: 'invoice', id: i.id, number: i.estimateNumber, kind: 'estimate', title: i.status === 'draft' ? 'Kostenvoranschlag' : `Kostenvoranschlag → Rechnung ${i.number ?? ''}`, contact, status,
        turn: last.kind === 'mail_in' ? 'ours' : 'theirs', lastAt: last.at.toISOString(), snippet: snip(last.body), count: list.length });
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
  if (v.status === 'done') await db.update(inboxMails).set({ status: 'done', handledBy: actor.userName }).where(and(eq(inboxMails.caseId, id), eq(inboxMails.status, 'new')));
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
