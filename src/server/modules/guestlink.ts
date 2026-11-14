import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { cancelTerms, isActiveStatus, todayBerlin, type CancelPolicy, type GuestLinkDto, type PublicBooking } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { bookings, settings, teamNotes } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking, setRoomStatus } from './bookings.js';
import { sign } from './mail.js';
import { getHotel } from './settings.js';

/**
 * Stornobedingungen und der persönliche Link des Gastes zu seiner Reservierung: ansehen, Ankunftszeit mitteilen, stornieren.
 * Der Link enthält die Kennung der Reservierung und eine Prüfsumme mit dem Schlüssel dieser Installation; er wird nicht gespeichert.
 * Eine Ausfallgebühr wird nie automatisch gebucht – sie wird berechnet, angezeigt und dem Personal gemeldet.
 */
const POLICY0: CancelPolicy = { enabled: false, freeDays: 3, feePercent: 80, online: false, onlineLate: false, publicUrl: '', extraText: '' };
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

const tokenFor = (bookingId: string) => `${bookingId.replace(/-/g, '')}.${sign(`booking-link:${bookingId}`)}`;
const GONE = () => new AppError(404, 'link_gone', 'Dieser Link ist nicht gültig. Bitte wenden Sie sich an das Hotel.');
function bookingIdOf(token: string): string {
  const [hex, mac] = token.split('.');
  if (!hex || !mac || !/^[0-9a-f]{32}$/.test(hex)) throw GONE();
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const want = Buffer.from(sign(`booking-link:${id}`)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw GONE();
  return id;
}

/** Link für das Personal (zum Kopieren, als QR-Code) – baseUrl ist die Adresse, unter der das Programm gerade aufgerufen wird. */
export async function guestLink(db: Exec, bookingId: string, baseUrl: string, localOnly: boolean): Promise<GuestLinkDto> {
  await getBooking(db, bookingId);
  const p = await getPolicy(db);
  const base = p.publicUrl || baseUrl;
  const url = `${base}/buchung/${tokenFor(bookingId)}`;
  return { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 240 }), localOnly: !p.publicUrl && localOnly };
}
/** Link für E-Mails – nur wenn eine Adresse im Internet hinterlegt ist (sonst wäre er für den Gast zu Hause nicht erreichbar). */
export async function mailLink(db: Exec, bookingId: string): Promise<string | null> {
  const p = await getPolicy(db);
  return p.publicUrl ? `${p.publicUrl}/buchung/${tokenFor(bookingId)}` : null;
}

async function view(db: Exec, bookingId: string): Promise<PublicBooking> {
  const b = await getBooking(db, bookingId).catch(() => { throw GONE(); });
  const [h, p] = [await getHotel(db), await getPolicy(db)];
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
    from, to, totalCents: b.totalCents, state, arrivalTime: b.arrivalTime, guestMessage: b.guestMessage, checkinTime: h.checkinTime,
    terms, canCancel: state === 'active' && cancelHint === '', cancelHint,
  };
}
export const publicBooking = (db: Exec, token: string) => view(db, bookingIdOf(token));

const GUEST: Actor = { userId: null, userName: 'Gast (Link)', ip: null };
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const tellTeam = (db: Exec, text: string) => db.insert(teamNotes).values({ kind: 'note', text, createdBy: 'Gast (Link)', createdById: null });

/** Ankunftszeit und Nachricht des Gastes speichern; das Personal sieht sie in der Reservierung und im Übergabebuch. */
export async function setArrival(db: Db, token: string, v: { time: string; message: string }, ip: string | null) {
  const id = bookingIdOf(token);
  const b = await view(db, id);
  if (b.state !== 'active') throw conflict('Für diese Reservierung lässt sich die Ankunftszeit nicht mehr ändern.');
  await db.update(bookings).set({ arrivalTime: v.time, guestMessage: v.message, updatedAt: new Date() }).where(eq(bookings.id, id));
  await record(db, { ...GUEST, ip }, { action: 'guest_arrival', entity: 'booking', entityId: id, after: { arrivalTime: v.time, message: v.message.slice(0, 200) } });
  if (v.time || v.message) await tellTeam(db, `Reservierung ${b.number} (${b.guestName}, Anreise ${de(b.from)}): ${v.time ? `Ankunft voraussichtlich ${v.time} Uhr` : 'Nachricht des Gastes'}${v.message ? ` – „${v.message}“` : ''}`);
  return view(db, id);
}

/** Storno durch den Gast – nur wenn die Bedingungen es online erlauben. Gibt die Zimmer frei und meldet es dem Personal. */
export async function cancelByGuest(db: Db, token: string, ip: string | null) {
  const id = bookingIdOf(token);
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
