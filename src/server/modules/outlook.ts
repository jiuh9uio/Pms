import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
  OUTLOOK_DEFAULTS, assess, parseBrightSky, parseOpenLiga, type Match, type OutlookDto, type OutlookEvent, type OutlookEventInput, type OutlookSettings, type WeatherHour,
} from '../../shared/outlook.js';
import { isMapsLink, isShortMapsLink, parseMapsLink } from '../../shared/mapslink.js';
import type { Db, Exec } from '../db/client.js';
import { restaurantTables, settings, tableReservations } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { fetchPublic, resolveRedirects } from '../lib/safefetch.js';
import { record, type Actor } from './audit.js';

/**
 * Restaurant-Ausblick: holt (nur wenn ein Standort eingetragen ist) das Wetter beim Deutschen Wetterdienst über den
 * freien Dienst Bright Sky und die Fußballspiele des Tages bei OpenLigaDB. Übertragen werden dabei nur die Koordinaten
 * des Hauses bzw. das Liga-Kürzel – keine Gäste- oder Reservierungsdaten. Antworten werden zwischengespeichert.
 */
const SKEY = 'restaurant_outlook', EKEY = 'restaurant_events';
let weatherBase = 'https://api.brightsky.dev/weather';
let ligaBase = 'https://api.openligadb.de/getmatchdata';
let allowPrivate = false;
/** Für Tests: Dienste umleiten */
export const setOutlookTest = (o: { weatherBase?: string; ligaBase?: string; allowPrivate?: boolean }) => {
  weatherBase = o.weatherBase ?? weatherBase; ligaBase = o.ligaBase ?? ligaBase; allowPrivate = o.allowPrivate ?? allowPrivate; cache.clear();
};

async function getKey<T>(db: Exec, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}
async function putKey(db: Exec, key: string, value: unknown) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export const getOutlookSettings = async (db: Exec): Promise<OutlookSettings> => ({ ...OUTLOOK_DEFAULTS, ...(await getKey<Partial<OutlookSettings>>(db, SKEY, {})) });
export async function saveOutlookSettings(db: Db, actor: Actor, v: OutlookSettings) {
  const before = await getOutlookSettings(db);
  await db.transaction(async (tx) => {
    await putKey(tx, SKEY, v);
    await record(tx, actor, { action: 'update', entity: 'settings', entityId: SKEY, before, after: v });
  });
  cache.clear();
  return v;
}

/** Koordinaten aus einem Google-Maps-Link (Kurzlinks werden nur bis zur langen Adresse verfolgt). */
export async function coordsFromLink(raw: string): Promise<{ lat: number; lon: number; place: string }> {
  const s = raw.trim();
  if (!isMapsLink(s)) throw new AppError(400, 'validation', 'Das ist kein Google-Maps-Link. In Google Maps das Haus öffnen, „Teilen“ → „Link kopieren“ und hier einfügen.');
  const long = isShortMapsLink(s) ? await resolveRedirects(s, { allowPrivate, done: (u) => !!parseMapsLink(u.toString()) }) : s;
  const info = parseMapsLink(long);
  if (!info || info.lat === null || info.lng === null) throw new AppError(404, 'lookup_empty', 'Im Link stehen keine Koordinaten. Bitte in Google Maps lange auf das Haus tippen und dann „Teilen“ wählen.');
  return { lat: Math.round(info.lat * 10000) / 10000, lon: Math.round(info.lng * 10000) / 10000, place: info.text.split(',')[0]?.trim() ?? '' };
}

// ---------- Veranstaltungen (von Hand) ----------
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export async function listEvents(db: Exec, from?: string): Promise<OutlookEvent[]> {
  const all = await getKey<OutlookEvent[]>(db, EKEY, []);
  return all.filter((e) => !from || e.date >= from).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
export async function addEvent(db: Db, actor: Actor, v: OutlookEventInput) {
  return db.transaction(async (tx) => {
    // alte Einträge (älter als 30 Tage) dabei aufräumen
    const keep = (await getKey<OutlookEvent[]>(tx, EKEY, [])).filter((e) => e.date >= addDays(today(), -30));
    if (keep.length >= 300) throw new AppError(409, 'too_many', 'Es sind schon sehr viele Veranstaltungen eingetragen. Bitte alte löschen.');
    const e: OutlookEvent = { ...v, id: randomUUID(), createdBy: actor.userName };
    await putKey(tx, EKEY, [...keep, e]);
    await record(tx, actor, { action: 'create', entity: 'restaurant_event', entityId: e.id, after: v });
    return e;
  });
}
export async function deleteEvent(db: Db, actor: Actor, id: string) {
  await db.transaction(async (tx) => {
    const all = await getKey<OutlookEvent[]>(tx, EKEY, []);
    const e = all.find((x) => x.id === id);
    if (!e) throw notFound('Veranstaltung');
    await putKey(tx, EKEY, all.filter((x) => x.id !== id));
    await record(tx, actor, { action: 'delete', entity: 'restaurant_event', entityId: id, before: { date: e.date, time: e.time, title: e.title, effect: e.effect } });
  });
  return { ok: true };
}
const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

// ---------- Internet-Abfragen mit Zwischenspeicher ----------
const cache = new Map<string, { at: number; ttl: number; value: unknown; error: string | null }>();
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<{ value: T | null; error: string | null }> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return { value: hit.value as T | null, error: hit.error };
  try {
    const value = await load();
    cache.set(key, { at: Date.now(), ttl: ttlMs, value, error: null });
    return { value, error: null };
  } catch (e) {
    const error = e instanceof Error && e.message ? e.message : 'nicht erreichbar';
    // Fehler nur kurz merken, damit nicht bei jedem Aufruf erneut gewartet wird
    cache.set(key, { at: Date.now(), ttl: 10 * 60_000, value: null, error });
    return { value: null, error };
  }
}
const getJson = async (url: string) => JSON.parse((await fetchPublic(url, { allowPrivate, maxBytes: 3_000_000, timeoutMs: 10_000, headers: { Accept: 'application/json' } })).text) as unknown;

async function weather(s: OutlookSettings, date: string) {
  if (s.lat === null || s.lon === null) return { value: null as WeatherHour[] | null, error: null };
  const url = `${weatherBase}?lat=${s.lat}&lon=${s.lon}&date=${date}&last_date=${addDays(date, 1)}&tz=Europe/Berlin`;
  return cached(`w|${url}`, 60 * 60_000, async () => parseBrightSky(await getJson(url), date));
}
async function football(s: OutlookSettings, date: string): Promise<{ matches: Match[]; error: string | null }> {
  const leagues = [...new Set(s.leagues.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
  const out: Match[] = [], errors: string[] = [];
  for (const lg of leagues) {
    const r = await cached(`f|${lg}`, 3 * 60 * 60_000, async () => getJson(`${ligaBase}/${encodeURIComponent(lg)}`));
    if (r.error) { errors.push(`${lg}: ${r.error}`); continue; }
    try { out.push(...parseOpenLiga(r.value, date, s.favoriteTeam)); } catch (e) { errors.push(`${lg}: ${e instanceof Error ? e.message : 'Fehler'}`); }
  }
  // gleiche Fehlermeldung (z. B. kein Internet) nur einmal nennen
  const msgs = [...new Set(errors.map((e) => e.replace(/^[^:]+: /, '')))];
  const error = !errors.length ? null : msgs.length === 1 && errors.length === leagues.length ? msgs[0]! : errors.join('; ');
  return { matches: out.sort((a, b) => a.time.localeCompare(b.time)), error };
}

export async function outlook(db: Db, date: string): Promise<OutlookDto> {
  const s = await getOutlookSettings(db);
  const [w, f, events, seatsRow, res] = await Promise.all([
    weather(s, date), football(s, date), listEvents(db),
    db.select({ seats: restaurantTables.seats }).from(restaurantTables).where(eq(restaurantTables.active, true)),
    db.select({ persons: tableReservations.persons }).from(tableReservations).where(and(eq(tableReservations.date, date), inArray(tableReservations.status, ['booked', 'seated']))),
  ]);
  const todays = events.filter((e) => e.date === date);
  const reservations = { persons: res.reduce((x, r) => x + r.persons, 0), seats: seatsRow.reduce((x, r) => x + r.seats, 0), count: res.length };
  const a = assess({ date, settings: s, hours: w.value, matches: f.matches, events: todays, reservations });
  return {
    date, weekday: a.weekday, holiday: a.holiday, holidayTomorrow: a.holidayTomorrow, walkIn: a.walkIn, leaveEarly: a.leaveEarly,
    weather: { lunch: a.lunch, dinner: a.dinner, source: 'Deutscher Wetterdienst (über Bright Sky)', error: w.error, configured: s.lat !== null && s.lon !== null },
    matches: f.matches, matchesError: f.error, events: todays, reservations, hints: a.hints,
  };
}
