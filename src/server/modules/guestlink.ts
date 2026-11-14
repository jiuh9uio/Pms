import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { cancelTerms, isActiveStatus, todayBerlin, type CancelPolicy, type GuestLinkDto, type PublicBooking, type PublicBookingGate, type PublicCred } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { bookings, guests, settings, teamNotes } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking, setRoomStatus } from './bookings.js';
import { activeGuide } from './guestguide.js';
import { sign } from './mail.js';
import { getHotel } from './settings.js';

/**
 * Stornobedingungen und der persönliche Link des Gastes zu seiner Reservierung: ansehen, Ankunftszeit mitteilen, stornieren.
 * Der Link enthält die Kennung der Reservierung und eine Prüfsumme mit dem Schlüssel dieser Installation; er wird nicht gespeichert.
 * Zusätzlich muss der Gast seinen Nachnamen und – wenn hinterlegt – seine Postleitzahl eingeben; der Link allein zeigt nichts.
 * Eine Ausfallgebühr wird nie automatisch gebucht – sie wird berechnet, angezeigt und dem Personal gemeldet.
 */
const POLICY0: CancelPolicy = { enabled: false, freeDays: 3, feePercent: 80, online: false, onlineLate: false, publicUrl: '', extraText: '', showPrice: true, allowArrival: true, welcome: '' };
export async function getPolicy(db: Exec): Promise<CancelPolicy> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'cancel_policy'));
  return { ...POLICY0, ...((row?.value as Partial<CancelPolicy>) ?? {}) };
}
export async function savePolicy(db: Db, actor: Actor, v: CancelPolicy) {
  const next = { ...v, publicUrl: v.publicUrl.replace(/\/+$/, '') };
  await db.insert(settings).values({ key: 'cancel_policy', value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'cancel_policy', after: next });
  return next;
}

const tokenFor = (bookingId: string, version: number) => `${bookingId.replace(/-/g, '')}.${sign(`booking-link:${bookingId}${version ? `:${version}` : ''}`)}`;
const GONE = () => new AppError(404, 'link_gone', 'Dieser Link ist nicht gültig. Bitte wenden Sie sich an das Hotel.');
const linkState = async (db: Exec, id: string) => (await db.select({ version: bookings.linkVersion, blocked: bookings.linkBlocked }).from(bookings).where(eq(bookings.id, id)))[0];
/** Prüft Form, Prüfsumme (zur aktuellen Ausgabe des Links) und Sperre; liefert die Kennung der Reservierung. */
async function bookingIdOf(db: Exec, token: string): Promise<string> {
  const [hex, mac] = token.split('.');
  if (!hex || !mac || !/^[0-9a-f]{32}$/.test(hex)) throw GONE();
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const st = await linkState(db, id);
  if (!st) throw GONE();
  const want = Buffer.from(tokenFor(id, st.version).split('.')[1]!), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw GONE(); // auch: älterer, inzwischen ersetzter Link
  if (st.blocked) throw new AppError(403, 'link_blocked', 'Dieser Link ist derzeit gesperrt. Bitte wenden Sie sich an das Hotel.');
  return id;
}

/** Link für das Personal (zum Kopieren, als QR-Code) – baseUrl ist die Adresse, unter der das Programm gerade aufgerufen wird. */
export async function guestLink(db: Exec, bookingId: string, baseUrl: string, localOnly: boolean): Promise<GuestLinkDto> {
  const b = await getBooking(db, bookingId);
  const [p, st] = [await getPolicy(db), (await linkState(db, bookingId))!];
  const base = p.publicUrl || baseUrl;
  const url = `${base}/buchung/${tokenFor(bookingId, st.version)}`;
  return { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), localOnly: !p.publicUrl && localOnly, blocked: st.blocked, version: st.version, needsZip: norm(b.guest.zip) !== '', guestEmail: b.guest.email };
}
/** Link sperren, wieder freigeben oder neu ausstellen (der bisherige Link gilt dann nicht mehr; eine Sperre wird dabei aufgehoben). */
export async function linkAction(db: Db, actor: Actor, bookingId: string, action: 'block' | 'unblock' | 'renew') {
  const st = await linkState(db, bookingId);
  if (!st) throw GONE();
  const set = action === 'renew' ? { linkVersion: st.version + 1, linkBlocked: false } : { linkBlocked: action === 'block' };
  await db.update(bookings).set(set).where(eq(bookings.id, bookingId));
  fails.delete(bookingId);
  await record(db, actor, { action: `guest_link_${action}`, entity: 'booking', entityId: bookingId });
  return { ok: true };
}
/** Link für E-Mails – nur wenn eine Adresse im Internet hinterlegt ist (sonst wäre er für den Gast zu Hause nicht erreichbar). */
export async function mailLink(db: Exec, bookingId: string): Promise<string | null> {
  const [p, st] = [await getPolicy(db), await linkState(db, bookingId)];
  return p.publicUrl && st && !st.blocked ? `${p.publicUrl}/buchung/${tokenFor(bookingId, st.version)}` : null;
}

/** E-Mail an den Gast mit seinem Link (Vorschlag, vor dem Senden änderbar). */
export async function linkMailDraft(db: Exec, bookingId: string, baseUrl: string, localOnly: boolean) {
  const [b, h, l] = [await getBooking(db, bookingId), await getHotel(db), await guestLink(db, bookingId, baseUrl, localOnly)];
  const { ready, signature } = await import('./hotelmail.js');
  const hello = b.guest.salutation === 'Herr' ? `Sehr geehrter Herr ${b.guest.lastName},` : b.guest.salutation === 'Frau' ? `Sehr geehrte Frau ${b.guest.lastName},` : 'Guten Tag,';
  const text = [hello, '', `über den folgenden Link erreichen Sie Ihre Reservierung ${b.number} bei uns:`, '', l.url, '',
    `Zum Öffnen geben Sie Ihren Nachnamen${l.needsZip ? ' und Ihre Postleitzahl' : ''} ein. Dort können Sie uns Ihre voraussichtliche Ankunftszeit mitteilen.`, '', signature(h)].join('\n');
  return { to: b.guest.email, subject: `Ihre Reservierung ${b.number} – ${h.name}`, text, attachment: null, ready: await ready(db) };
}

async function view(db: Exec, bookingId: string): Promise<PublicBooking> {
  const b = await getBooking(db, bookingId).catch(() => { throw GONE(); });
  const [h, p] = [await getHotel(db), await getPolicy(db)];
  const guide = await activeGuide(db);
  const today = todayBerlin();
  const live = b.rooms.filter((r) => isActiveStatus(r.status));
  const shown = live.length ? live : b.rooms;
  const from = shown.map((r) => r.from).sort()[0]!, to = shown.map((r) => r.to).sort().at(-1)!;
  const state: PublicBooking['state'] = live.length === 0 ? 'cancelled' : live.some((r) => r.status === 'checked_in' || r.status === 'checked_out') ? (to < today ? 'past' : 'arrived') : to < today ? 'past' : 'active';
  const terms = cancelTerms(p, from, live.reduce((s, r) => s + r.lodgingCents, 0), today);
  let cancelHint = '';
  if (state !== 'active') cancelHint = state === 'cancelled' ? 'Diese Reservierung ist storniert.' : '';
  else if (!p.enabled || !p.online) cancelHint = `Zum Stornieren oder Ändern rufen Sie uns bitte an${h.phone ? ` (${h.phone})` : ''} oder schreiben Sie uns.`;
  else if (from <= today) cancelHint = `Am Anreisetag ist eine Stornierung nur noch telefonisch möglich${h.phone ? ` (${h.phone})` : ''}.`;
  else if (!terms.free && !p.onlineLate) cancelHint = `Die Frist für die kostenfreie Stornierung ist abgelaufen. Bitte rufen Sie uns an${h.phone ? ` (${h.phone})` : ''}.`;
  return {
    hotelName: h.name, hotelPhone: h.phone, number: b.number, guestName: [b.guest.firstName, b.guest.lastName].filter(Boolean).join(' '),
    rooms: shown.map((r) => ({ category: r.categoryName, from: r.from, to: r.to, nights: r.nights, adults: r.adults, children: r.children, status: r.status })),
    from, to, totalCents: p.showPrice ? b.totalCents : null, welcome: p.welcome, canArrival: p.allowArrival && state === 'active', state, arrivalTime: b.arrivalTime, guestMessage: b.guestMessage, checkinTime: h.checkinTime,
    guide: guide && guide.onGuestPage ? { label: guide.label, url: guide.url, text: guide.text } : null,
    terms, canCancel: state === 'active' && cancelHint === '', cancelHint,
  };
}
// ---------- Zugang: Link + Nachname + Postleitzahl ----------
const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Umlaute ausgeschrieben („Mueller“ für „Müller“) */
const normDe = (s: string) => norm(s.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue'));
const sameName = (a: string, b: string) => norm(a) === norm(b) || normDe(a) === normDe(b);
/** Fehlversuche je Reservierung: nach 8 falschen Eingaben ist der Link 15 Minuten gesperrt */
const fails = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 8, LOCK_MS = 15 * 60_000;

async function guestOf(db: Exec, bookingId: string) {
  const [g] = await db.select({ lastName: guests.lastName, zip: guests.zip }).from(bookings).innerJoin(guests, eq(guests.id, bookings.guestId)).where(eq(bookings.id, bookingId));
  if (!g) throw GONE();
  return g;
}
/** Vor der Eingabe: nur Name des Hauses und ob eine Postleitzahl verlangt wird – nichts über die Reservierung. */
export async function linkGate(db: Exec, token: string): Promise<PublicBookingGate> {
  const [g, h] = [await guestOf(db, await bookingIdOf(db, token)), await getHotel(db)];
  return { hotelName: h.name, hotelPhone: h.phone, needsZip: norm(g.zip) !== '' };
}
/** Prüft Nachname und Postleitzahl gegen die Angaben des Gastes; liefert die Kennung der Reservierung. */
async function enter(db: Exec, token: string, cred: PublicCred, now = Date.now()): Promise<string> {
  const id = await bookingIdOf(db, token);
  const f = fails.get(id);
  if (f && f.until > now) throw new AppError(429, 'link_locked', 'Zu viele falsche Eingaben. Bitte versuchen Sie es in 15 Minuten noch einmal oder rufen Sie uns an.');
  const g = await guestOf(db, id);
  const ok = sameName(cred.lastName, g.lastName) && (norm(g.zip) === '' || norm(cred.zip) === norm(g.zip));
  if (!ok) {
    const n = (f && f.until === 0 ? f.n : 0) + 1;
    if (fails.size > 5000) fails.clear();
    fails.set(id, n >= MAX_FAILS ? { n: 0, until: now + LOCK_MS } : { n, until: 0 });
    throw new AppError(403, 'link_denied', 'Nachname und Postleitzahl passen nicht zu dieser Reservierung. Bitte so eingeben wie bei der Buchung.');
  }
  fails.delete(id);
  return id;
}
export const publicBooking = async (db: Exec, token: string, cred: PublicCred) => view(db, await enter(db, token, cred));

const GUEST: Actor = { userId: null, userName: 'Gast (Link)', ip: null };
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const tellTeam = (db: Exec, text: string) => db.insert(teamNotes).values({ kind: 'note', text, createdBy: 'Gast (Link)', createdById: null });

/** Ankunftszeit und Nachricht des Gastes speichern; das Personal sieht sie in der Reservierung und im Übergabebuch. */
export async function setArrival(db: Db, token: string, v: PublicCred & { time: string; message: string }, ip: string | null) {
  const id = await enter(db, token, v);
  const b = await view(db, id);
  if (!b.canArrival) throw conflict('Für diese Reservierung lässt sich die Ankunftszeit hier nicht ändern.');
  await db.update(bookings).set({ arrivalTime: v.time, guestMessage: v.message, updatedAt: new Date() }).where(eq(bookings.id, id));
  await record(db, { ...GUEST, ip }, { action: 'guest_arrival', entity: 'booking', entityId: id, after: { arrivalTime: v.time, message: v.message.slice(0, 200) } });
  if (v.time || v.message) await tellTeam(db, `Reservierung ${b.number} (${b.guestName}, Anreise ${de(b.from)}): ${v.time ? `Ankunft voraussichtlich ${v.time} Uhr` : 'Nachricht des Gastes'}${v.message ? ` – „${v.message}“` : ''}`);
  return view(db, id);
}

/** Storno durch den Gast – nur wenn die Bedingungen es online erlauben. Gibt die Zimmer frei und meldet es dem Personal. */
export async function cancelByGuest(db: Db, token: string, cred: PublicCred, ip: string | null) {
  const id = await enter(db, token, cred);
  const b = await view(db, id);
  if (!b.canCancel) throw conflict(b.cancelHint || 'Diese Reservierung lässt sich hier nicht stornieren.', 'cancel_not_possible');
  const full = await getBooking(db, id);
  for (const r of full.rooms.filter((x) => x.status === 'tentative' || x.status === 'confirmed'))
    await setRoomStatus(db, { ...GUEST, ip }, r.id, { status: 'cancelled', version: r.version });
  const fee = b.terms.feeCents > 0 ? `Ausfallgebühr laut Bedingungen: ${(b.terms.feeCents / 100).toFixed(2).replace('.', ',')} € (${b.terms.feePercent} % des Zimmerpreises) – bitte prüfen und berechnen.` : 'Kostenfrei innerhalb der Frist.';
  const line = `Online storniert am ${de(todayBerlin())} über den Gäste-Link. ${fee}`;
  await db.update(bookings).set({ notes: [full.notes, line].filter(Boolean).join('\n').slice(0, 2000), updatedAt: new Date() }).where(eq(bookings.id, id));
  await record(db, { ...GUEST, ip }, { action: 'guest_cancel', entity: 'booking', entityId: id, after: { free: b.terms.free, feeCents: b.terms.feeCents } });
  await tellTeam(db, `Storno durch den Gast: Reservierung ${b.number} (${b.guestName}, ${de(b.from)} bis ${de(b.to)}). ${fee}`);
  return view(db, id);
}

/** Bedingungen für die Anzeige in der Reservierung (Personal). */
export async function termsFor(db: Exec, bookingId: string) {
  const b = await getBooking(db, bookingId);
  const live = b.rooms.filter((r) => isActiveStatus(r.status));
  if (!live.length) return cancelTerms({ ...POLICY0 }, todayBerlin(), 0, todayBerlin());
  return cancelTerms(await getPolicy(db), live.map((r) => r.from).sort()[0]!, live.reduce((s, r) => s + r.lodgingCents, 0), todayBerlin());
}
