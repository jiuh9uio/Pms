import { z } from 'zod';

/**
 * Gästeseite: öffentliche Seite des Hauses – Startbild, Restaurant, Hotel mit Zimmern und Verfügbarkeit, Speisekarte,
 * Feiern, Gutscheine, Reservierung, Kontakt, häufige Fragen. Alle Texte und Bilder pflegt der Administrator.
 */
const url = z.string().trim().max(300).refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Bitte eine vollständige Adresse mit https:// eintragen');
const t = (max: number, d = '') => z.string().trim().max(max).default(d);

export const SECTION_KEYS = ['restaurant', 'hotel', 'menu', 'events', 'vouchers', 'reservation', 'contact', 'faq'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABEL: Record<SectionKey, string> = {
  restaurant: 'Restaurant', hotel: 'Hotel & Zimmer', menu: 'Speisekarte', events: 'Feiern & Tagen', vouchers: 'Gutscheine', reservation: 'Tischreservierung', contact: 'Kontakt', faq: 'Häufige Fragen',
};
const section = (d: { kicker: string; title: string; titleEm: string; text: string; note?: string }) => z.object({
  show: z.boolean().default(true), kicker: t(80, d.kicker), title: t(120, d.title), titleEm: t(120, d.titleEm), text: t(1500, d.text), note: t(600, d.note ?? ''),
}).default({ show: true, ...d, note: d.note ?? '' });

/** Vorschlagstexte (aus der Gestaltungsvorlage des Hauses) – keine Tatsachenangaben wie Zeiten oder Preise. */
export const SECTION_DEFAULTS: Record<SectionKey, { kicker: string; title: string; titleEm: string; text: string; note?: string }> = {
  restaurant: { kicker: 'Das Restaurant', title: 'Mit Zeit genießen.', titleEm: 'Mit Freude bleiben.', text: 'Deutsche Küche, regionale Klassiker und ein gemütlicher Rahmen für die schönen Stunden des Tages. Nehmen Sie Platz – zu zweit, mit Freunden oder im Kreis der Familie.' },
  hotel: { kicker: 'Das Hotel', title: 'Ankommen.', titleEm: 'Durchatmen.', text: 'Für eine Auszeit, eine Geschäftsreise oder den Besuch bei Ihren Liebsten: Fragen Sie Ihren Aufenthalt im Schützenhaus persönlich bei uns an. Zimmerwünsche, Frühstück und Anreise stimmen wir gerne mit Ihnen ab.', note: 'Eine Anfrage ist noch keine Buchung. Ausstattung, Preise und Verfügbarkeit bestätigen wir Ihnen persönlich.' },
  menu: { kicker: 'Die Freude am Genießen', title: 'Ein guter Geschmack.', titleEm: 'Ein schöner Moment.', text: 'Unsere aktuelle Karte und persönliche Empfehlungen erhalten Sie direkt bei uns.' },
  events: { kicker: 'Besondere Anlässe', title: 'Zusammen sein.', titleEm: 'Erinnerungen schaffen.', text: 'Für die Menschen und Momente, die Ihnen wichtig sind. Wir besprechen Ihre Wünsche persönlich mit Ihnen.', note: 'Bitte teilen Sie uns Anlass, Wunschtermin, Gästezahl und besondere Wünsche mit. Eine Anfrage ist keine verbindliche Buchung.' },
  vouchers: { kicker: 'Eine Einladung zum Genießen', title: 'Das Schönste', titleEm: 'ist gemeinsame Zeit.', text: 'Ein gemeinsamer Abend. Ein gutes Essen. Ein persönlicher Gruß. Fragen Sie uns nach den Möglichkeiten, einen Gutschein für das Schützenhaus zu verschenken.', note: 'Die E-Mail ist eine unverbindliche Anfrage – es erfolgt keine Zahlung und keine automatische Ausstellung.' },
  reservation: { kicker: 'Ein Platz für Ihre gute Zeit', title: 'Wir freuen uns', titleEm: 'auf Ihren Besuch.', text: 'Ein Abend zu zweit oder eine gesellige Runde? Reservieren Sie Ihren Tisch persönlich bei uns.', note: 'Eine Reservierung ist erst nach persönlicher Bestätigung verbindlich.' },
  contact: { kicker: 'Der Weg zu uns', title: 'Nicht weit weg.', titleEm: 'Ganz bei sich.', text: '' },
  faq: { kicker: 'Gut zu wissen', title: 'Ein paar Worte', titleEm: 'vor Ihrem Besuch.', text: '' },
};

export const IMAGE_KEYS = ['hero', 'restaurant', 'hotel', 'events'] as const;
export type ImageKey = (typeof IMAGE_KEYS)[number];
export const IMAGE_LABEL: Record<ImageKey, string> = { hero: 'Startbild (groß, oben)', restaurant: 'Restaurant', hotel: 'Hotel', events: 'Feiern & Tagen' };

export const siteSettingsInput = z.object({
  enabled: z.boolean(),
  /** Besucher der Hauptadresse sehen die Gästeseite; Mitarbeiter melden sich über /anmelden an */
  homepage: z.boolean(),
  brandSubtitle: t(120, 'Hotel & Restaurant'),
  heroKicker: t(120, 'Traditionelle Gastlichkeit. Neu entdecken.'),
  headline: z.string().trim().max(120),
  headlineEm: t(120, 'Ein Ort für Sie.'),
  heroText: t(400, 'Gutes Essen, erholsame Nächte und die schöne Kunst, sich willkommen zu fühlen.'),
  introKicker: t(120, ''), introTitle: t(120, 'Gastlichkeit, die bleibt.'), introTitleEm: t(120, 'Momente, die verbinden.'),
  intro: z.string().trim().max(1200),
  /** Vorzüge, je Zeile einer (z. B. „Kostenloses WLAN“) */
  highlights: z.string().trim().max(1200),
  showPrices: z.boolean(),
  /** Gäste können für ihre Reisedaten prüfen, ob etwas frei ist */
  showAvailability: z.boolean().default(true),
  imprintUrl: url, privacyUrl: url,
  categories: z.record(z.string(), z.object({ show: z.boolean(), text: z.string().trim().max(800) })),
  sections: z.object(Object.fromEntries(SECTION_KEYS.map((k) => [k, section(SECTION_DEFAULTS[k])])) as Record<SectionKey, ReturnType<typeof section>>).default(
    Object.fromEntries(SECTION_KEYS.map((k) => [k, { show: true, ...SECTION_DEFAULTS[k], note: SECTION_DEFAULTS[k].note ?? '' }])) as never),
  /** Anlässe für „Feiern & Tagen“, je Zeile einer */
  eventTypes: t(400, 'Familienfeiern\nHochzeiten\nGeburtstage\nFirmenveranstaltungen'),
  /** Öffnungszeiten, je Zeile „Tage | Zeit“ */
  hours: t(800, ''), hoursNote: t(400, ''),
  /** Häufige Fragen: Frage in der ersten Zeile, Antwort darunter, Fragen durch eine Leerzeile getrennt */
  faq: t(4000, ''),
  /** Knopf „Route planen“ (öffnet Google Maps erst beim Anklicken) */
  routeLink: z.boolean().default(true),
});
export type SiteSettings = z.infer<typeof siteSettingsInput>;
export const SITE_DEFAULTS: SiteSettings = siteSettingsInput.parse({ enabled: false, homepage: false, headline: 'Ein Haus mit Seele.', intro: 'Ein liebevoll gedeckter Tisch. Ein Abend in guter Gesellschaft. Ein Ort zum Ankommen. Im Schützenhaus verbinden sich rustikaler Charme und persönliche Gastfreundschaft – für Ihren Besuch, Ihre Übernachtung und Ihren besonderen Anlass.', highlights: '', showPrices: true, imprintUrl: '', privacyUrl: '', categories: {} });

export interface SiteCategory { id: string; name: string; text: string; maxPersons: number; stdOccupancy: number; fromPriceCents: number | null; hasPhoto: boolean; photoVersion: string }
export interface SiteSection { show: boolean; kicker: string; title: string; titleEm: string; text: string; note: string }
export interface SitePublic {
  enabled: boolean; preview: boolean;
  hotel: { name: string; street: string; zip: string; city: string; phone: string; email: string; website: string };
  brandSubtitle: string; heroKicker: string; headline: string; headlineEm: string; heroText: string;
  introKicker: string; introTitle: string; introTitleEm: string; intro: string;
  highlights: string[]; showPrices: boolean; showAvailability: boolean; imprintUrl: string; privacyUrl: string; hasLogo: boolean;
  requestEnabled: boolean; privacyText: string;
  sections: Record<SectionKey, SiteSection>;
  eventTypes: string[]; hours: { label: string; value: string }[]; hoursNote: string; faq: { q: string; a: string }[]; routeLink: boolean;
  /** hochgeladene Bilder: Kennung → Versionsstempel (leer = kein Bild) */
  images: Record<ImageKey, string>;
  categories: SiteCategory[];
}
export interface SiteAvailability { nights: number; categories: { id: string; available: boolean; totalCents: number | null }[] }
export const siteAvailabilityQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  adults: z.coerce.number().int().min(1).max(20), children: z.coerce.number().int().min(0).max(20).default(0),
});
export const categoryPhotoInput = z.object({ mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().max(1_400_000) });

/** „Mittwoch – Samstag | 17:00 – 22:00 Uhr“ je Zeile */
export const parseHours = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 14).map((l) => { const [a, ...b] = l.split('|'); return { label: a!.trim(), value: b.join('|').trim() }; });
/** Frage in der ersten Zeile, Antwort in den folgenden; Leerzeile trennt */
export const parseFaq = (s: string) => s.replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).slice(0, 20).map((b) => { const [q, ...a] = b.split('\n'); return { q: q!.trim(), a: a.join(' ').trim() }; }).filter((x) => x.q && x.a);
