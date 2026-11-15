import { z } from 'zod';

/** Gästeseite: öffentliche Seite des Hauses mit Zimmern, Verfügbarkeit und Anfrage. */
const url = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Bitte eine vollständige Adresse mit https:// eintragen');
export const siteSettingsInput = z.object({
  enabled: z.boolean(),
  /** Besucher der Hauptadresse sehen die Gästeseite; Mitarbeiter melden sich über /anmelden an */
  homepage: z.boolean(),
  headline: z.string().trim().max(120),
  intro: z.string().trim().max(1200),
  /** Vorzüge, je Zeile einer (z. B. „Kostenloses WLAN“) */
  highlights: z.string().trim().max(1200),
  showPrices: z.boolean(),
  imprintUrl: url, privacyUrl: url,
  categories: z.record(z.string(), z.object({ show: z.boolean(), text: z.string().trim().max(800) })),
});
export type SiteSettings = z.infer<typeof siteSettingsInput>;
export const SITE_DEFAULTS: SiteSettings = { enabled: false, homepage: false, headline: '', intro: '', highlights: '', showPrices: true, imprintUrl: '', privacyUrl: '', categories: {} };

export interface SiteCategory { id: string; name: string; text: string; maxPersons: number; stdOccupancy: number; fromPriceCents: number | null; hasPhoto: boolean; photoVersion: string }
export interface SitePublic {
  enabled: boolean; preview: boolean;
  hotel: { name: string; street: string; zip: string; city: string; phone: string; email: string; website: string };
  headline: string; intro: string; highlights: string[]; showPrices: boolean; imprintUrl: string; privacyUrl: string; hasLogo: boolean;
  requestEnabled: boolean; privacyText: string;
  categories: SiteCategory[];
}
export interface SiteAvailability { nights: number; categories: { id: string; available: boolean; totalCents: number | null }[] }
export const siteAvailabilityQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(20), children: z.coerce.number().int().min(0).max(20).default(0),
});
export const categoryPhotoInput = z.object({ mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().max(1_400_000) });
