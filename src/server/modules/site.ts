import { asc, eq } from 'drizzle-orm';
import { diffDays, todayBerlin } from '../../shared/hotel.js';
import { IMAGE_KEYS, SITE_DEFAULTS, SECTION_KEYS, parseFaq, parseHours, siteSettingsInput, type ImageKey, type SiteAvailability, type SitePublic, type SiteSettings } from '../../shared/site.js';
import type { Db, Exec } from '../db/client.js';
import { categoryPhotos, roomCategories, rooms, settings, siteImages } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getLogo } from './billing.js';
import { getWebRequest } from './inbox.js';
import { freeRooms, priceNights } from './rooms.js';
import { getHotel } from './settings.js';

/**
 * Gästeseite: öffentliche Seite des Hauses. Zeigt nur, was der Administrator freigibt – Kategorien mit Text, Foto und Preis,
 * ob für einen Zeitraum etwas frei ist (ohne Zimmeranzahl) und führt zur unverbindlichen Anfrage. Gebucht wird nichts.
 */
export async function getSite(db: Exec): Promise<SiteSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'guest_site'));
  // ältere Stände ohne die neuen Felder: fehlende Werte aus den Vorgaben ergänzen
  const v = siteSettingsInput.safeParse({ ...SITE_DEFAULTS, ...((row?.value as Partial<SiteSettings>) ?? {}) });
  return v.success ? v.data : SITE_DEFAULTS;
}
export async function saveSite(db: Db, actor: Actor, v: SiteSettings) {
  await db.insert(settings).values({ key: 'guest_site', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'guest_site', after: { enabled: v.enabled, homepage: v.homepage, categories: Object.values(v.categories).filter((c) => c.show).length } });
  return v;
}

async function shownCategories(db: Exec, s: SiteSettings) {
  const cats = await db.select().from(roomCategories).orderBy(asc(roomCategories.sort), asc(roomCategories.name));
  const withRooms = new Set((await db.select({ c: rooms.categoryId }).from(rooms).where(eq(rooms.active, true))).map((r) => r.c));
  return cats.filter((c) => s.categories[c.id]?.show && withRooms.has(c.id));
}

/** Öffentliche Angaben. `preview` = angemeldeter Administrator sieht die Seite auch, solange sie nicht freigeschaltet ist. */
export async function sitePublic(db: Exec, preview: boolean): Promise<SitePublic> {
  const [s, h] = [await getSite(db), await getHotel(db)];
  const hotel = { name: h.name, street: h.street, zip: h.zip, city: h.city, phone: h.phone, email: h.email, website: h.website };
  const blank = { show: false, kicker: '', title: '', titleEm: '', text: '', note: '' };
  const empty: SitePublic = {
    enabled: false, preview: false, hotel: { ...hotel, street: '', zip: '', city: '', phone: '', email: '', website: '' }, brandSubtitle: '', heroKicker: '', headline: '', headlineEm: '', heroText: '',
    introKicker: '', introTitle: '', introTitleEm: '', intro: '', highlights: [], showPrices: false, showAvailability: false, imprintUrl: '', privacyUrl: '', hasLogo: false, requestEnabled: false, privacyText: '',
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, blank])) as SitePublic['sections'], eventTypes: [], hours: [], hoursNote: '', faq: [], routeLink: false,
    images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, ''])) as SitePublic['images'], video: '', categories: [],
  };
  if (!s.enabled && !preview) return empty;
  const cats = await shownCategories(db, s);
  const photos = new Map((await db.select({ id: categoryPhotos.categoryId, at: categoryPhotos.updatedAt }).from(categoryPhotos)).map((p) => [p.id, p.at.getTime().toString(36)]));
  const req = await getWebRequest(db);
  const imgs = new Map((await db.select({ k: siteImages.key, at: siteImages.updatedAt }).from(siteImages)).map((i) => [i.k, i.at.getTime().toString(36)]));
  const video = imgs.get('video') ?? '';
  return {
    enabled: s.enabled, preview: preview && !s.enabled, hotel, brandSubtitle: s.brandSubtitle, heroKicker: s.heroKicker, headline: s.headline, headlineEm: s.headlineEm, heroText: s.heroText,
    introKicker: s.introKicker, introTitle: s.introTitle, introTitleEm: s.introTitleEm, intro: s.intro,
    highlights: s.highlights.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 12), showPrices: s.showPrices, showAvailability: s.showAvailability,
    sections: s.sections, eventTypes: s.eventTypes.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8), hours: parseHours(s.hours), hoursNote: s.hoursNote, faq: parseFaq(s.faq), routeLink: s.routeLink,
    images: Object.fromEntries(IMAGE_KEYS.map((k) => [k, imgs.get(k) ?? ''])) as SitePublic['images'], video,
    imprintUrl: s.imprintUrl, privacyUrl: s.privacyUrl, hasLogo: !!(await getLogo(db)), requestEnabled: req.enabled, privacyText: req.privacy,
    categories: cats.map((c) => ({
      id: c.id, name: c.name, text: s.categories[c.id]?.text || c.description, maxPersons: c.maxPersons, stdOccupancy: c.stdOccupancy,
      fromPriceCents: s.showPrices ? c.basePriceCents : null, hasPhoto: photos.has(c.id), photoVersion: photos.get(c.id) ?? '',
    })),
  };
}

const MAX_NIGHTS = 30;
/** Ist in jeder freigegebenen Kategorie für den Zeitraum ein passendes Zimmer frei – und was kostet der Aufenthalt? */
export async function siteAvailability(db: Exec, q: { from: string; to: string; adults: number; children: number }, preview: boolean): Promise<SiteAvailability> {
  const s = await getSite(db);
  if (!s.enabled && !preview) throw new AppError(409, 'site_off', 'Die Seite ist derzeit nicht verfügbar');
  if (!s.showAvailability && !preview) throw new AppError(409, 'availability_off', 'Die Verfügbarkeitsabfrage ist ausgeschaltet');
  const today = todayBerlin();
  const bad = (field: string, msg: string) => new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { [field]: msg });
  if (q.from < today) throw bad('from', 'Die Anreise liegt in der Vergangenheit');
  if (q.to <= q.from) throw bad('to', 'Die Abreise muss nach der Anreise liegen');
  const nights = diffDays(q.from, q.to);
  if (nights > MAX_NIGHTS) throw bad('to', `Online höchstens ${MAX_NIGHTS} Nächte – für längere Aufenthalte fragen Sie bitte direkt an`);
  if (diffDays(today, q.from) > 550) throw bad('from', 'So weit im Voraus ist noch keine Abfrage möglich');
  const cats = await shownCategories(db, s);
  const free = await freeRooms(db, q.from, q.to);
  const persons = q.adults + q.children;
  return {
    nights,
    categories: await Promise.all(cats.map(async (c) => {
      const room = free.find((r) => r.categoryId === c.id && r.active);
      if (!room || persons > c.maxPersons) return { id: c.id, available: false, totalCents: null };
      const total = s.showPrices ? (await priceNights(db, room.id, c.id, q.from, q.to, { adults: q.adults, children: q.children })).reduce((x, n) => x + n.priceCents, 0) : null;
      return { id: c.id, available: true, totalCents: total };
    })),
  };
}

// ---------- Fotos der Kategorien ----------
export async function categoryPhoto(db: Exec, categoryId: string) {
  const [p] = await db.select().from(categoryPhotos).where(eq(categoryPhotos.categoryId, categoryId));
  return p ? { mime: p.mime, data: p.data } : null;
}
/** Öffentlich nur für freigegebene Kategorien (oder in der Vorschau). */
export async function publicPhoto(db: Exec, categoryId: string, preview: boolean) {
  const s = await getSite(db);
  if ((!s.enabled && !preview) || !s.categories[categoryId]?.show) return null;
  return categoryPhoto(db, categoryId);
}
export async function saveCategoryPhoto(db: Db, actor: Actor, categoryId: string, v: { mime: 'image/png' | 'image/jpeg'; dataBase64: string } | null) {
  const [c] = await db.select({ id: roomCategories.id, name: roomCategories.name }).from(roomCategories).where(eq(roomCategories.id, categoryId));
  if (!c) throw notFound('Kategorie');
  if (!v) await db.delete(categoryPhotos).where(eq(categoryPhotos.categoryId, categoryId));
  else {
    const data = Buffer.from(v.dataBase64, 'base64');
    if (data.length > 1024 * 1024) throw new AppError(400, 'too_large', 'Das Foto ist zu groß (höchstens 1 MB)');
    const png = data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', jpg = data[0] === 0xff && data[1] === 0xd8;
    if ((v.mime === 'image/png' && !png) || (v.mime === 'image/jpeg' && !jpg)) throw new AppError(400, 'bad_image', 'Die Datei ist kein gültiges PNG- oder JPEG-Bild');
    await db.insert(categoryPhotos).values({ categoryId, mime: v.mime, data }).onConflictDoUpdate({ target: categoryPhotos.categoryId, set: { mime: v.mime, data, updatedAt: new Date() } });
  }
  await record(db, actor, { action: 'update', entity: 'category', entityId: categoryId, after: { foto: v ? 'hochgeladen' : 'entfernt', kategorie: c.name } });
  return { ok: true };
}

// ---------- Bilder der Gästeseite ----------
const checkImage = (v: { mime: 'image/png' | 'image/jpeg'; dataBase64: string }) => {
  const data = Buffer.from(v.dataBase64, 'base64');
  if (data.length > 1024 * 1024) throw new AppError(400, 'too_large', 'Das Bild ist zu groß (höchstens 1 MB)');
  const png = data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', jpg = data[0] === 0xff && data[1] === 0xd8;
  if ((v.mime === 'image/png' && !png) || (v.mime === 'image/jpeg' && !jpg)) throw new AppError(400, 'bad_image', 'Die Datei ist kein gültiges PNG- oder JPEG-Bild');
  return data;
};
export async function siteImage(db: Exec, key: ImageKey) {
  const [p] = await db.select().from(siteImages).where(eq(siteImages.key, key));
  return p ? { mime: p.mime, data: p.data } : null;
}
export async function publicSiteImage(db: Exec, key: ImageKey, preview: boolean) {
  const s = await getSite(db);
  return s.enabled || preview ? siteImage(db, key) : null;
}
export async function saveSiteImage(db: Db, actor: Actor, key: ImageKey, v: { mime: 'image/png' | 'image/jpeg'; dataBase64: string } | null) {
  if (!v) await db.delete(siteImages).where(eq(siteImages.key, key));
  else {
    const data = checkImage(v);
    await db.insert(siteImages).values({ key, mime: v.mime, data }).onConflictDoUpdate({ target: siteImages.key, set: { mime: v.mime, data, updatedAt: new Date() } });
  }
  await record(db, actor, { action: 'update', entity: 'settings', entityId: `guest_site_image_${key}`, after: { bild: v ? 'hochgeladen' : 'entfernt' } });
  return { ok: true };
}

// ---------- Video im Startbild (z. B. Drohnenflug) ----------
export const VIDEO_MAX = 80 * 1024 * 1024;
let videoCache: { at: number; mime: string; data: Buffer } | null = null;
/** MP4 (H.264) oder WebM; geprüft wird die Dateikennung, nicht nur die Endung. */
export function videoType(data: Buffer): 'video/mp4' | 'video/webm' | null {
  if (data.length > 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
  if (data.length > 4 && data.subarray(0, 4).toString('hex') === '1a45dfa3') return 'video/webm';
  return null;
}
export async function siteVideo(db: Exec) {
  const [meta] = await db.select({ at: siteImages.updatedAt }).from(siteImages).where(eq(siteImages.key, 'video'));
  if (!meta) { videoCache = null; return null; }
  if (videoCache?.at === meta.at.getTime()) return videoCache;
  const [row] = await db.select().from(siteImages).where(eq(siteImages.key, 'video'));
  videoCache = row ? { at: row.updatedAt.getTime(), mime: row.mime, data: row.data } : null;
  return videoCache;
}
export async function publicSiteVideo(db: Exec, preview: boolean) {
  const s = await getSite(db);
  return s.enabled || preview ? siteVideo(db) : null;
}
export async function saveSiteVideo(db: Db, actor: Actor, data: Buffer | null) {
  if (!data) await db.delete(siteImages).where(eq(siteImages.key, 'video'));
  else {
    if (data.length > VIDEO_MAX) throw new AppError(400, 'too_large', 'Das Video ist zu groß (höchstens 80 MB). Bitte kürzer oder kleiner speichern.');
    const mime = videoType(data);
    if (!mime) throw new AppError(400, 'bad_video', 'Die Datei ist kein MP4- oder WebM-Video');
    await db.insert(siteImages).values({ key: 'video', mime, data }).onConflictDoUpdate({ target: siteImages.key, set: { mime, data, updatedAt: new Date() } });
  }
  videoCache = null;
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'guest_site_video', after: { video: data ? `${Math.round(data.length / 1024 / 1024)} MB` : 'entfernt' } });
  return { ok: true };
}
