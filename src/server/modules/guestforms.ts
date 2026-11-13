import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import { addDays, isActiveStatus, type GuestFormInput, type GuestFormLink, type GuestFormPublic } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { guestForms, guests } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking } from './bookings.js';
import { getHotel } from './settings.js';

/**
 * Online-Meldeschein: Das Personal erzeugt je Reservierung einen Link mit Zugangscode (als QR-Code).
 * Der Gast öffnet ihn ohne Anmeldung und trägt seine Angaben ein; sie werden ins Gästeprofil übernommen.
 * Der Link zeigt keine gespeicherten Adress- oder Ausweisdaten, gilt bis zum Tag nach der Abreise und nur für eine Abgabe.
 */

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const GONE = () => new AppError(404, 'form_gone', 'Dieser Link ist nicht mehr gültig. Bitte wenden Sie sich an die Rezeption.');

function stay(b: Awaited<ReturnType<typeof getBooking>>) {
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  if (rooms.length === 0) throw conflict('Die Reservierung enthält kein aktives Zimmer');
  return { from: rooms.map((r) => r.from).sort()[0]!, to: rooms.map((r) => r.to).sort().at(-1)! };
}

export async function formStatus(db: Exec, bookingId: string): Promise<GuestFormLink> {
  const [f] = await db.select().from(guestForms).where(eq(guestForms.bookingId, bookingId));
  return { exists: !!f, url: null, qr: null, expiresAt: f?.expiresAt.toISOString() ?? null, submittedAt: f?.submittedAt?.toISOString() ?? null, localOnly: false };
}

/** Neuen Link erzeugen; ein früherer Link derselben Reservierung wird damit ungültig. baseUrl = Adresse, unter der Gäste das PMS erreichen. */
export async function createForm(db: Db, actor: Actor, bookingId: string, baseUrl: string, localOnly: boolean): Promise<GuestFormLink> {
  const b = await getBooking(db, bookingId);
  const { to } = stay(b);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = new Date(`${addDays(to, 2)}T00:00:00Z`);
  if (expiresAt.getTime() < Date.now()) throw conflict('Der Aufenthalt ist bereits beendet – ein Online-Meldeschein ist nicht mehr möglich');
  await db.transaction(async (tx) => {
    await tx.delete(guestForms).where(eq(guestForms.bookingId, bookingId));
    await tx.insert(guestForms).values({ bookingId, tokenHash: hash(token), expiresAt, createdBy: actor.userName });
    await record(tx, actor, { action: 'guest_form_link', entity: 'booking', entityId: bookingId, after: { expiresAt } });
  });
  const url = `${baseUrl}/gast/${token}`;
  const qr = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  return { exists: true, url, qr: `data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}`, expiresAt: expiresAt.toISOString(), submittedAt: null, localOnly };
}

async function byToken(db: Exec, token: string) {
  const [f] = await db.select().from(guestForms).where(eq(guestForms.tokenHash, hash(token)));
  if (!f || f.expiresAt.getTime() < Date.now()) throw GONE();
  return f;
}

export async function publicForm(db: Exec, token: string): Promise<GuestFormPublic> {
  const f = await byToken(db, token);
  const [b, h] = [await getBooking(db, f.bookingId), await getHotel(db)];
  const { from, to } = stay(b);
  return { hotelName: h.name, number: b.number, from, to, firstName: b.guest.firstName, lastName: b.guest.lastName, submitted: !!f.submittedAt };
}

export async function submitForm(db: Db, token: string, v: GuestFormInput, ip: string | null) {
  await db.transaction(async (tx) => {
    const [f] = await tx.select().from(guestForms).where(eq(guestForms.tokenHash, hash(token))).for('update');
    if (!f || f.expiresAt.getTime() < Date.now()) throw GONE();
    if (f.submittedAt) throw new AppError(409, 'form_done', 'Der Meldeschein wurde bereits ausgefüllt. Für Änderungen wenden Sie sich bitte an die Rezeption.');
    const b = await getBooking(tx, f.bookingId);
    const { companions, ...data } = v;
    const [g] = await tx.select().from(guests).where(eq(guests.id, b.guest.id)).for('update');
    await tx.update(guests).set({ ...data, version: g!.version + 1, updatedAt: new Date() }).where(eq(guests.id, g!.id));
    await tx.update(guestForms).set({ submittedAt: new Date() }).where(eq(guestForms.id, f.id));
    const actor: Actor = { userId: null, userName: 'Gast (Online-Meldeschein)', ip };
    await record(tx, actor, { action: 'guest_form', entity: 'booking', entityId: b.id, after: { companions } });
    await record(tx, actor, { action: 'update', entity: 'guest', entityId: g!.id,
      before: { firstName: g!.firstName, lastName: g!.lastName, birthdate: g!.birthdate, nationality: g!.nationality, street: g!.street, zip: g!.zip, city: g!.city, country: g!.country, idNumber: g!.idNumber },
      after: data });
  });
}
