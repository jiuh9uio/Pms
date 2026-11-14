import { extractCompany, findImprintLink, type CompanyFound } from '../../shared/imprint.js';
import { AppError } from '../lib/errors.js';
import { FetchBlocked, fetchPublic } from '../lib/safefetch.js';

/**
 * Adressdaten einer Firma nachschlagen – nur auf ausdrücklichen Knopfdruck:
 *  - aus dem Impressum ihrer Website (die Seite wird abgerufen und ausgelesen),
 *  - über die Ortssuche von OpenStreetMap (Nominatim), frei nutzbar ohne Vertrag.
 * Dabei geht die eingegebene Adresse bzw. der Suchbegriff an die jeweilige Website bzw. an OpenStreetMap.
 * Google Maps wird nicht verwendet: Dessen Daten gibt es nur über eine kostenpflichtige Schnittstelle mit eigenem Zugang.
 */
let allowPrivate = false;
let searchBase = 'https://nominatim.openstreetmap.org/search';
/** Für Tests: lokale Adressen erlauben und die Ortssuche umleiten. */
export const setLookupTest = (o: { allowPrivate?: boolean; searchBase?: string }) => { allowPrivate = o.allowPrivate ?? allowPrivate; searchBase = o.searchBase ?? searchBase; };

const fail = (e: unknown): never => {
  if (e instanceof AppError) throw e;
  const x = e as { name?: string; message?: string; cause?: { code?: string } };
  const msg = e instanceof FetchBlocked ? e.message : x.name === 'TimeoutError' ? 'Die Seite antwortet nicht.' : x.cause?.code === 'ENOTFOUND' ? 'Die Adresse wurde nicht gefunden.'
    : `Der Abruf ist fehlgeschlagen (${x.cause?.code ?? x.message ?? 'unbekannter Fehler'}). Besteht eine Internetverbindung?`;
  throw new AppError(502, 'lookup_failed', msg);
};

/** Impressum einer Website lesen. Ist die angegebene Seite nicht das Impressum, wird dem Link „Impressum“ gefolgt. */
export async function fromImprint(input: string): Promise<{ found: CompanyFound; page: string }> {
  const raw = input.trim();
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { throw new AppError(400, 'validation', 'Bitte die Adresse der Website eintragen, z. B. www.firma.de'); }
  try {
    let page = await fetchPublic(url.toString(), { allowPrivate });
    let found = /impressum|imprint/i.test(page.url) ? extractCompany(page.text) : null;
    if (!found?.zip) {
      const link = findImprintLink(page.text, page.url);
      if (link && link !== page.url) { page = await fetchPublic(link, { allowPrivate }); found = extractCompany(page.text) ?? found; }
      else found = found ?? extractCompany(page.text);
    }
    if (!found || (!found.zip && !found.name)) throw new AppError(404, 'lookup_empty', 'Auf der Seite wurden keine Firmendaten gefunden. Bitte die Adresse der Impressum-Seite direkt eintragen oder die Daten von Hand übernehmen.');
    return { found, page: page.url };
  } catch (e) { return fail(e); }
}

export interface PlaceFound extends CompanyFound { label: string }
/** Ortssuche über OpenStreetMap: Firmenname und Ort eingeben, Treffer mit Anschrift zurück. Liefert keine USt-IdNr. und selten Telefon oder E-Mail. */
export async function searchPlace(q: string): Promise<PlaceFound[]> {
  try {
    const url = `${searchBase}?format=jsonv2&addressdetails=1&extratags=1&limit=6&accept-language=de&countrycodes=de,at,ch&q=${encodeURIComponent(q.trim())}`;
    const page = await fetchPublic(url, { allowPrivate, maxBytes: 300_000, headers: { Accept: 'application/json' } });
    const rows = JSON.parse(page.text) as { name?: string; display_name?: string; address?: Record<string, string>; extratags?: Record<string, string> | null }[];
    return rows.map((r) => {
      const a = r.address ?? {}, x = r.extratags ?? {};
      const street = [a.road ?? a.pedestrian ?? a.square ?? '', a.house_number ?? ''].filter(Boolean).join(' ');
      return {
        name: r.name || a.amenity || a.shop || a.office || a.tourism || '', street, zip: a.postcode ?? '', city: a.city ?? a.town ?? a.village ?? a.municipality ?? '', country: a.country ?? 'Deutschland',
        phone: x.phone ?? x['contact:phone'] ?? '', email: x.email ?? x['contact:email'] ?? '', vatId: '', source: 'OpenStreetMap', label: r.display_name ?? '',
      };
    }).filter((r) => r.zip && r.street);
  } catch (e) { return fail(e); }
}
