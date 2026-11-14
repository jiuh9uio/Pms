import { eq } from 'drizzle-orm';
import type { GuestGuide } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { record, type Actor } from './audit.js';

/**
 * Digitale Gästemappe eines Anbieters (z. B. Gastfreund). Heute: ein Verweis – die Adresse der Mappe erscheint als QR-Code auf
 * einem Bon-Zettel, als Zeile in E-Mails an den Gast und als Knopf auf seiner Reservierungsseite.
 *
 * Diese Datei ist die einzige Stelle, die den Anbieter kennt. Für eine spätere echte Anbindung (Reservierungen an die Mappe
 * übergeben, z. B. für Begrüßung mit Namen oder Vorab-Check-in) genügt es, hier je Anbieter einen Adapter zu ergänzen
 * (siehe `GuideAdapter`) und ihn an den markierten Stellen in `bookings.ts` aufzurufen – Bon, E-Mails und Gästeseite bleiben unverändert.
 */
const DEFAULTS: GuestGuide = { enabled: false, provider: 'gastfreund', label: 'Digitale Gästemappe', url: '', text: 'Alles rund um Ihren Aufenthalt: Hausinformationen, Speisekarte, Tipps für die Umgebung.', inMails: true, onGuestPage: true };

export async function getGuide(db: Exec): Promise<GuestGuide> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'guest_guide'));
  return { ...DEFAULTS, ...((row?.value as Partial<GuestGuide>) ?? {}) };
}
export async function saveGuide(db: Db, actor: Actor, v: GuestGuide) {
  await db.insert(settings).values({ key: 'guest_guide', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'guest_guide', after: v });
  return v;
}
/** Eingerichtete Mappe oder null. */
export async function activeGuide(db: Exec): Promise<GuestGuide | null> {
  const g = await getGuide(db);
  return g.enabled && g.url ? g : null;
}
/** Zeilen für E-Mails an den Gast (leer, wenn nicht eingerichtet oder für E-Mails abgeschaltet). */
export async function guideMailLines(db: Exec): Promise<string[]> {
  const g = await activeGuide(db);
  return g && g.inMails ? ['', `${g.label}: ${g.url}`, ...(g.text ? [g.text] : [])] : [];
}

/**
 * Vorgesehene Schnittstelle für eine spätere Anbindung: Der Adapter eines Anbieters bekommt die Ereignisse einer Reservierung.
 * Noch von keinem Anbieter umgesetzt – es gibt bisher keine Schnittstellenbeschreibung von Gastfreund für eigene Programme.
 */
export interface GuideStay { bookingNumber: string; guestName: string; email: string; from: string; to: string; rooms: string[]; language?: string }
export interface GuideAdapter {
  /** Reservierung angelegt oder geändert */
  upsertStay?(stay: GuideStay): Promise<void>;
  /** Reservierung storniert */
  cancelStay?(bookingNumber: string): Promise<void>;
  /** Check-in bzw. Check-out */
  setPresence?(bookingNumber: string, inHouse: boolean): Promise<void>;
}
export const adapters: Partial<Record<GuestGuide['provider'], GuideAdapter>> = {};
