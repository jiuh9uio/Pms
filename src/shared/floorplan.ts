import { z } from 'zod';

/**
 * Etagenplan: eine zusätzliche, schematische Ansicht der Zimmer – die Zimmer selbst und ihre Buchungen bleiben, wo sie sind.
 * Der Plan beschreibt nur die Lage: Flure mit Straßenseite (oben, mit Fenster) und Hofseite (unten); Zimmer werden über ihre Nummer
 * zugeordnet. Gleicher Platz in beiden Reihen = gegenüber; ein „-“ lässt einen Platz frei. Alles ist in den Einstellungen änderbar.
 */
const num = z.string().trim().max(20);
export const corridorInput = z.object({
  id: z.string().trim().min(1).max(40),
  name: z.string().trim().max(60),
  /** Etage als Text (z. B. „1“, „EG“); leer = nicht angegeben */
  floor: z.string().trim().max(20),
  street: z.array(num).max(40),
  court: z.array(num).max(40),
  /** Treppenhaus am Anfang oder Ende des Flurs */
  stairs: z.enum(['none', 'start', 'end']),
});
export const floorPlanInput = z.object({
  corridors: z.array(corridorInput).max(20),
  /** bekannte Gebäudeseite von Zimmern, die (noch) keinem Flur zugeordnet sind */
  sides: z.record(num, z.enum(['street', 'court'])),
  /** das Programm hat die Lage des Treppenhauses nur angenommen – Hinweis im Plan, bis es jemand bestätigt */
  stairsAssumed: z.boolean().default(false),
});
export type FloorPlan = z.infer<typeof floorPlanInput>;
export type Corridor = z.infer<typeof corridorInput>;

/**
 * Ausgangsstand nur aus den bekannten Angaben:
 * - 111–118 liegen auf derselben Flurseite, zur Straße (Fensterseite)
 * - 124 liegt an einem Gang, gegenüber von 228; 228 liegt zum Hof → 124 steht deshalb auf der anderen Seite (Straße)
 * - 224 Straßenseite, 120 Hofseite – welcher Flur, ist nicht bekannt: erscheinen als „noch keinem Flur zugeordnet“
 * - Treppenhaus: gewünscht, Lage unbekannt → vorläufig am Ende des ersten Flurs, als angenommen gekennzeichnet
 * Etagen sind nicht bekannt und bleiben leer.
 */
export const FLOOR_PLAN_DEFAULT: FloorPlan = {
  corridors: [
    { id: 'a', name: 'Flur 111–118', floor: '', street: ['111', '112', '113', '114', '115', '116', '117', '118'], court: [], stairs: 'end' },
    { id: 'b', name: 'Gang 124 / 228', floor: '', street: ['124'], court: ['228'], stairs: 'none' },
  ],
  sides: { '224': 'street', '120': 'court' },
  stairsAssumed: true,
};

export type RoomPlanStatus = 'free' | 'occupied' | 'reserved' | 'blocked';
export const ROOM_PLAN_STATUS_LABEL: Record<RoomPlanStatus, string> = { free: 'Frei', occupied: 'Belegt', reserved: 'Reserviert', blocked: 'Gesperrt / nicht verfügbar' };
export interface PlanRoom {
  id: string; number: string; category: string; floor: string; status: RoomPlanStatus;
  /** Buchung, die das Zimmer an diesem Tag belegt oder reserviert */
  bookingId: string | null; guest: string; from: string | null; to: string | null;
  /** Grund einer Sperre (Zimmersperre oder Zimmer stillgelegt) */
  blockNote: string; housekeeping: 'clean' | 'dirty';
}
export interface FloorPlanDto { date: string; plan: FloorPlan; rooms: PlanRoom[] }
