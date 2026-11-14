import { eq, sql } from 'drizzle-orm';
import { addDays, todayBerlin, type PrearrivalSettings, type PrearrivalState } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { bookings, settings } from '../db/schema.js';
import { record, SYSTEM, type Actor } from './audit.js';
import { ready as mailReady, signature } from './hotelmail.js';
import { sendMail } from './mail.js';
import { getHotel } from './settings.js';

/**
 * Nachricht vor der Anreise: einige Tage vorher bekommt der Gast einmalig eine E-Mail mit Anreisetag, Check-in-Zeit,
 * Anschrift und einem eigenen Zusatztext. Reine Information zur gebuchten Leistung – keine Werbung, keine Bitte um Bewertung.
 * Von Haus aus ausgeschaltet.
 */
const DEFAULTS: PrearrivalSettings = { enabled: false, daysBefore: 3, time: '10:00', extraText: '' };
export async function getPrearrival(db: Exec): Promise<PrearrivalSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'prearrival'));
  return { ...DEFAULTS, ...((row?.value as Partial<PrearrivalSettings>) ?? {}) };
}
export async function savePrearrival(db: Db, actor: Actor, v: PrearrivalSettings) {
  await db.insert(settings).values({ key: 'prearrival', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'prearrival', after: v });
  return v;
}

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
interface Stay { number: string; salutation: string; lastName: string; from: string; to: string; rooms: number }

async function compose(db: Exec, s: PrearrivalSettings, b: Stay) {
  const h = await getHotel(db);
  const hello = b.salutation === 'Herr' ? `Sehr geehrter Herr ${b.lastName},` : b.salutation === 'Frau' ? `Sehr geehrte Frau ${b.lastName},` : 'Guten Tag,';
  const day = `${WEEKDAY[new Date(`${b.from}T12:00:00Z`).getUTCDay()]}, ${de(b.from)}`;
  const address = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const text = [
    hello, '', `bald ist es so weit: Wir erwarten Sie am ${day}. Hier das Wichtigste zu Ihrer Reservierung ${b.number}:`, '',
    `- Anreise: ${day}, ab ${h.checkinTime} Uhr`, `- Abreise: ${de(b.to)}, bis ${h.checkoutTime} Uhr`,
    ...(b.rooms > 1 ? [`- ${b.rooms} Zimmer`] : []), ...(address ? [`- Anschrift: ${address}`] : []), ...(h.breakfastTimes ? [`- Frühstück: ${h.breakfastTimes}`] : []),
    ...(s.extraText ? ['', s.extraText] : []),
    '', 'Sollte sich Ihre Ankunftszeit ändern oder haben Sie Fragen, erreichen Sie uns jederzeit' + (h.phone ? ` unter ${h.phone}.` : '.'),
    '', 'Wir freuen uns auf Sie.', '', signature(h),
  ].join('\n');
  return { subject: `Ihre Anreise am ${de(b.from)} – ${h.name}`, text };
}

/** Reservierungen, deren Anreise in den nächsten Tagen liegt, die bestätigt sind, eine E-Mail-Adresse haben und noch keine Nachricht bekommen haben. */
async function due(db: Exec, s: PrearrivalSettings, today: string) {
  const rows = await db.execute(sql`
    select b.id, b.number, g.salutation, g.last_name, g.email, min(lower(a.period))::text as "from", max(upper(a.period))::text as "to", count(*)::int as rooms
    from bookings b join guests g on g.id = b.guest_id join booking_rooms br on br.booking_id = b.id join room_allocations a on a.id = br.allocation_id
    where b.prearrival_sent_at is null and g.email <> '' and br.status = 'confirmed' and b.created_at < now() - interval '12 hours'
    group by b.id, g.id having min(lower(a.period)) > ${today}::date and min(lower(a.period)) <= ${addDays(today, s.daysBefore)}::date`);
  return Array.from(rows).map((r) => ({ id: r.id as string, email: r.email as string, number: r.number as string, salutation: r.salutation as string, lastName: r.last_name as string, from: r.from as string, to: r.to as string, rooms: Number(r.rooms) }));
}

const berlinMinutes = (now: Date) => { const [h, m] = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number); return h! * 60 + m!; };

/** Jede Minute geprüft: ab der eingestellten Uhrzeit die fälligen Nachrichten senden. Ein Fehlschlag wird beim nächsten Lauf erneut versucht. */
export async function prearrivalTick(db: Db, now = new Date()): Promise<{ sent: number; failed: number }> {
  const s = await getPrearrival(db);
  if (!s.enabled || !(await mailReady(db))) return { sent: 0, failed: 0 };
  if (berlinMinutes(now) < Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5))) return { sent: 0, failed: 0 };
  // nach einem Fehlschlag (Postfach gestört, Adresse abgelehnt) erst nach einer Stunde wieder versuchen – sonst gäbe es jede Minute einen Versuch
  const [lastRow] = await db.select().from(settings).where(eq(settings.key, 'prearrival_last'));
  const failedAt = (lastRow?.value as { failedAt?: string } | undefined)?.failedAt;
  if (failedAt && now.getTime() - Date.parse(failedAt) < 60 * 60_000 && now.getTime() >= Date.parse(failedAt)) return { sent: 0, failed: 0 };
  const today = now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  let sent = 0, failed = 0;
  for (const b of await due(db, s, today)) {
    try {
      const mail = await compose(db, s, b);
      await sendMail(db, SYSTEM, { to: b.email, ...mail });
      await db.update(bookings).set({ prearrivalSentAt: new Date() }).where(eq(bookings.id, b.id));
      await record(db, SYSTEM, { action: 'mail', entity: 'booking', entityId: b.id, after: { to: b.email, subject: mail.subject, automatic: 'prearrival' } });
      sent++;
    } catch { failed++; if (failed >= 3) break; } // Fehler stehen im E-Mail-Protokoll; bei Störung nicht alle durchprobieren
  }
  const mark = { at: now.toISOString(), ...(failed ? { failedAt: now.toISOString() } : {}) };
  await db.insert(settings).values({ key: 'prearrival_last', value: mark }).onConflictDoUpdate({ target: settings.key, set: { value: mark, updatedAt: new Date() } });
  return { sent, failed };
}
export function startPrearrivalScheduler(db: Db) {
  setInterval(() => void prearrivalTick(db).catch((e) => console.error('Nachricht vor der Anreise:', e instanceof Error ? e.message : e)), 60_000).unref();
}

export async function prearrivalState(db: Exec): Promise<PrearrivalState> {
  const s = await getPrearrival(db);
  const today = todayBerlin();
  const [last] = await db.select().from(settings).where(eq(settings.key, 'prearrival_last'));
  const [n] = await db.execute(sql`select count(*)::int as n from bookings where prearrival_sent_at is not null`);
  return {
    settings: s, mailReady: await mailReady(db), lastRun: (last?.value as { at?: string } | undefined)?.at ?? null, sentTotal: Number(n!.n), dueNow: (await due(db, s, today)).length,
    sample: await compose(db, s, { number: 'B-2026-0042', salutation: 'Frau', lastName: 'Beispiel', from: addDays(today, s.daysBefore), to: addDays(today, s.daysBefore + 2), rooms: 1 }),
  };
}
