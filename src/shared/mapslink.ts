/**
 * Google-Maps-Links auslesen, ohne Google abzufragen: Die Links enthalten den Ortsnamen, oft die ganze Anschrift
 * („/maps/place/Firma,+Hauptstr.+1,+12345+Ort/…“) und die Koordinaten. Kurzlinks (maps.app.goo.gl) müssen erst
 * aufgelöst werden – das macht der Server (nur die Weiterleitung, die Kartenseite selbst wird nicht gelesen).
 */
export interface MapsLinkInfo { text: string; lat: number | null; lng: number | null }
export interface AddressFromText { name: string; street: string; zip: string; city: string; country: string }

const GOOGLE = /^(www\.|maps\.)?google\.[a-z.]{2,6}$/i;
export const SHORT_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|g\.co)$/i;

export function isMapsLink(s: string): boolean {
  let u: URL;
  try { u = new URL(s.trim()); } catch { return false; }
  return (GOOGLE.test(u.hostname) && (u.pathname.startsWith('/maps') || u.hostname.startsWith('maps.'))) || SHORT_HOSTS.test(u.hostname);
}
export const isShortMapsLink = (s: string) => { try { return SHORT_HOSTS.test(new URL(s.trim()).hostname); } catch { return false; } };

const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')).replace(/\s+/g, ' ').trim(); } catch { return s.replace(/\+/g, ' ').trim(); } };
const num = (s: string | undefined) => (s && Number.isFinite(Number(s)) ? Number(s) : null);

/** Ortsname/Anschrift und Koordinaten aus einem (langen) Google-Maps-Link. */
export function parseMapsLink(raw: string): MapsLinkInfo | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  // Einwilligungsseite: der eigentliche Link steht in „continue“
  if (/^consent\.google\./i.test(u.hostname) && u.searchParams.get('continue')) return parseMapsLink(u.searchParams.get('continue')!);
  if (!GOOGLE.test(u.hostname)) return null;
  const path = u.pathname;
  const seg = /\/maps\/(?:place|search)\/([^/@]+)/.exec(path)?.[1];
  const coordQuery = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;
  let text = seg ? dec(seg) : '';
  for (const k of ['q', 'query', 'daddr', 'destination']) if (!text && u.searchParams.get(k)) text = u.searchParams.get(k)!.replace(/\s+/g, ' ').trim();
  // Koordinaten: !3d…!4d… ist der Ort selbst, @lat,lng nur der Kartenausschnitt
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(raw), view = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(path), inText = coordQuery.exec(text);
  const lat = num(pin?.[1] ?? inText?.[1] ?? view?.[1]), lng = num(pin?.[2] ?? inText?.[2] ?? view?.[2]);
  if (inText) text = '';
  if (!text && lat === null) return null;
  return { text, lat, lng };
}

const COUNTRIES: Record<string, string> = { deutschland: 'Deutschland', germany: 'Deutschland', österreich: 'Österreich', austria: 'Österreich', schweiz: 'Schweiz', switzerland: 'Schweiz' };
/** „Name, Straße 1, 12345 Ort, Deutschland“ → Felder. null, wenn keine vollständige Anschrift darin steht. */
export function addressFromText(text: string): AddressFromText | null {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const zi = parts.findIndex((p) => /^(?:D-|DE-|A-|CH-)?\d{4,5}\s+\S/.test(p));
  if (zi < 1) return null;
  const z = /^(?:D-|DE-|A-|CH-)?(\d{4,5})\s+(.+)$/.exec(parts[zi]!)!;
  const street = parts[zi - 1]!;
  if (!/\d/.test(street)) return null;
  const after = parts[zi + 1]?.toLowerCase();
  const country = (after && COUNTRIES[after]) ?? (z[1]!.length === 4 ? '' : 'Deutschland');
  return { name: parts.slice(0, zi - 1).join(', '), street, zip: z[1]!, city: z[2]!.trim(), country };
}
