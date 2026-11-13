import { z } from 'zod';

/** Eingabeschemas – vom Server immer geprüft, von der Oberfläche für Sofort-Rückmeldung mitbenutzt. */

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', user: 'Benutzer' };

/** Bereiche des Programms, die je Benutzer freigegeben werden. Verwaltung und Konto sind dem Administrator vorbehalten. */
export const MODULES = ['hotel', 'restaurant', 'schnelldruck', 'kontrollen', 'erechnung', 'internet'] as const;
/** Bereiche, die neue Benutzer von sich aus erhalten – „Internet“ (Geräte im Netz) gibt der Administrator bewusst frei. */
export const DEFAULT_MODULES: Module[] = ['hotel', 'restaurant', 'schnelldruck', 'kontrollen', 'erechnung'];
export type Module = (typeof MODULES)[number];
export const MODULE_LABEL: Record<Module, string> = { hotel: 'Hotel', restaurant: 'Restaurant', schnelldruck: 'Schnelldruck', kontrollen: 'Kontrollen', erechnung: 'E-Rechnung', internet: 'Internet' };
const modules = z.array(z.enum(MODULES)).max(MODULES.length);
export const hasModule = (u: { role: Role; modules: string[] }, m: Module) => u.role === 'admin' || u.modules.includes(m);

const text = (max = 200) => z.string().trim().max(max, `Höchstens ${max} Zeichen`);
const required = (max = 200) => text(max).min(1, 'Pflichtfeld');

export const password = z.string().min(10, 'Mindestens 10 Zeichen').max(200, 'Höchstens 200 Zeichen');
export const username = z
  .string().trim().toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, '3–40 Zeichen: Buchstaben, Ziffern, Punkt, Binde- oder Unterstrich');

export const loginInput = z.object({ username: z.string().trim().toLowerCase().min(1, 'Pflichtfeld').max(100), password: z.string().min(1, 'Pflichtfeld').max(200) });
export const setupInput = z.object({ username, name: required(100), password });
export const changePasswordInput = z.object({ current: z.string().min(1, 'Pflichtfeld').max(200), password });

export const userCreateInput = z.object({ username, name: required(100), password, role: z.enum(ROLES), modules: modules.default([...DEFAULT_MODULES]) });
export const userUpdateInput = z.object({
  name: required(100).optional(), username: username.optional(), role: z.enum(ROLES).optional(), active: z.boolean().optional(), modules: modules.optional(), version: z.number().int(),
});
export const passwordResetInput = z.object({ password });

export const hotelSettings = z.object({
  name: required(120),
  street: text(), zip: text(20), city: text(), country: text(),
  phone: text(60), email: z.union([z.literal(''), z.email('Ungültige E-Mail-Adresse')]), website: text(),
  taxNumber: text(60), vatId: text(60),
  bankName: text(120), iban: text(60), bic: text(20),
  checkinTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'), checkoutTime: z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM'),
  invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9-]{0,10}$/, 'Bis zu 10 Buchstaben, Ziffern oder Bindestriche'),
  paymentTermDays: z.number('Bitte eine Zahl eingeben').int().min(0, 'Mindestens 0').max(120, 'Höchstens 120'),
  invoiceFooter: text(500),
  /** Öffnungszeiten als freier Text, eine Zeile je Angabe – für den Schnelldruck am Bondrucker */
  openingHours: text(600).default(''),
  /** Frühstückszeiten als kurzer Text, z. B. „Mo–Fr 7:00–10:00, Sa/So 8:00–11:00“ – für den Zettel „Ihr Aufenthalt“ */
  breakfastTimes: text(160).default(''),
});
export type HotelSettings = z.infer<typeof hotelSettings>;
export const HOTEL_DEFAULTS: HotelSettings = {
  name: 'Hotel & Restaurant Schützenhaus', street: '', zip: '', city: '', country: 'Deutschland', phone: '', email: '', website: '',
  taxNumber: '', vatId: '', bankName: '', iban: '', bic: '', checkinTime: '15:00', checkoutTime: '11:00',
  invoicePrefix: 'RE', paymentTermDays: 14, invoiceFooter: '', openingHours: '', breakfastTimes: '',
};

const rate = z.number('Bitte eine Zahl eingeben').min(0, 'Mindestens 0').max(100, 'Höchstens 100');
const defaultFor = z.enum(['lodging', 'services']).nullable();
export const taxRateCreateInput = z.object({ name: required(80), ratePercent: rate, defaultFor: defaultFor.default(null) });
export const taxRateUpdateInput = z.object({
  name: required(80).optional(), ratePercent: rate.optional(), defaultFor: defaultFor.optional(), active: z.boolean().optional(), version: z.number().int(),
});

// ---------- Antworttypen ----------
export interface UserDto {
  id: string; username: string; name: string; role: Role; active: boolean; modules: Module[];
  lastLoginAt: string | null; lockedUntil: string | null; createdAt: string; version: number;
}
export interface TaxRateDto { id: string; name: string; ratePercent: number; defaultFor: 'lodging' | 'services' | null; active: boolean; version: number }
export interface AuditDto {
  id: number; at: string; userId: string | null; userName: string; action: string; entity: string; entityId: string | null;
  before: unknown; after: unknown; ip: string | null;
}
export interface ApiError { error: { code: string; message: string; fields?: Record<string, string> } }

// ---------- Netzwerk: Geräte im Hausnetz ----------
export const netDeviceNameInput = z.object({ name: text(60) });
export interface NetDeviceDto {
  ip: string; mac: string; hostname: string; name: string;
  /** dieser Rechner */ self: boolean;
  /** false = benanntes Gerät, das bei dieser Suche nicht gefunden wurde */ online: boolean;
  /** zufällige (private) Geräteadresse, wie sie Handys je WLAN verwenden */ randomMac: boolean;
}
export interface NetScanDto { scannedAt: string; networks: string[]; devices: NetDeviceDto[]; note: string | null; /** Adresse des Routers, falls ermittelbar */ gateway: string | null }
export interface InternetStatusDto { online: boolean; ms: number | null; checkedAt: string; addresses: string[]; error: string | null }

// ---------- Gäste-WLAN (Aushang mit QR-Code) und Ausfallprotokoll ----------
export const wifiSettingsInput = z.object({
  ssid: text(32), password: z.string().max(63, 'Höchstens 63 Zeichen'), open: z.boolean(), note: text(200),
}).refine((v) => v.open || v.password.length === 0 || v.password.length >= 8, { path: ['password'], message: 'WLAN-Passwörter haben mindestens 8 Zeichen' });
export type WifiSettings = z.infer<typeof wifiSettingsInput>;
export interface WifiDto extends WifiSettings { /** QR-Code als Bild-Adresse; null, solange kein WLAN-Name eingetragen ist */ qr: string | null; hotelName: string }
export interface NetOutageDto { id: string; startedAt: string; endedAt: string | null; uncertain: boolean }
export interface NetOutagesDto { monitoring: boolean; outages: NetOutageDto[] }

// ---------- Schnelldruck: Info-Zettel für Gäste auf dem Bondrucker ----------
export const bonPrinterInput = z.object({
  enabled: z.boolean(), host: z.string().trim().max(15).regex(/^(\d{1,3}(\.\d{1,3}){3})?$/, 'IP-Adresse im Format 192.168.1.50'),
  port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535), width: z.union([z.literal(32), z.literal(42), z.literal(48)]),
});
export type BonPrinter = z.infer<typeof bonPrinterInput>;
export const printTemplateInput = z.object({ title: required(40), body: required(1500), sort: z.number('Bitte eine Zahl eingeben').int().min(0).max(999) });
export const quickPrintInput = z.object({ id: z.string().max(40), copies: z.number().int().min(1).max(5) });
export const quickTextInput = z.object({ title: text(40), text: required(1500), copies: z.number().int().min(1).max(5) });
export const reviewSlipInput = z.object({
  url: z.union([z.literal(''), z.url('Bitte den vollständigen Link eintragen, beginnend mit https://').max(300).refine((u) => u.startsWith('https://'), 'Der Link muss mit https:// beginnen')]),
  headline: text(40), text: text(300), thanks: text(80),
});
export type ReviewSlip = z.infer<typeof reviewSlipInput>;
export interface QuickSlipDto { /** Einstellungen des Bewertungs-Zettels (nur bei id „review“) */ review?: ReviewSlip; id: string; title: string; preview: string; /** eigene Vorlage (änderbar) oder eingebaut */ custom: boolean; body?: string; sort?: number; version?: number; hint?: string }
export interface SlipSuggestionDto { key: string; title: string; body: string }
export const slipSuggestionsInput = z.object({ keys: z.array(z.string().max(40)).min(1).max(20) });
/** Kennzeichen für Stellen, die der Betrieb in einer Vorlage noch ausfüllen muss. */
export const PLACEHOLDER = '(bitte eintragen)';
export interface QuickPrintDto { printerReady: boolean; printerName: string; slips: QuickSlipDto[] }

// ---------- Suche ----------
export interface SearchHit { kind: 'guest' | 'booking' | 'invoice' | 'company' | 'table'; id: string; title: string; sub: string }
export interface SearchResult { hits: SearchHit[] }

// ---------- „Heute im Haus“ im Startmenü ----------
export interface OverviewItem { key: string; label: string; value: string; sub: string; to: string; tone: 'neutral' | 'ok' | 'warn' }

// ---------- TSE (Epson): Stick prüfen ----------
export const tseSettingsInput = z.object({
  enabled: z.boolean(), host: z.string().trim().regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'IP-Adresse, für diesen Rechner 127.0.0.1'),
  port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535),
});
export type TseSettings = z.infer<typeof tseSettingsInput>;
export interface TseInfoDto {
  readAt: string; vendorType: string; serialNumberHex: string; serialNumberBase64: string; publicKeyBase64: string; signatureAlgorithm: string;
  /** Zertifikats-ID des BSI */ description: string; cdcId: string;
  initializationState: string; hasValidTime: boolean | null; hasPassedSelfTest: boolean | null; unlocked: boolean | null; timeUntilNextSelfTest: number | null;
  certificateExpirationDate: string; lastExportExecutedDate: string;
  createdSignatures: number | null; remainingSignatures: number | null; maxSignatures: number | null;
  registeredClients: number | null; maxRegisteredClients: number | null; startedTransactions: number | null;
  capacityBlocks: number | null; usedBlocks: number | null; softwareVersion: number | null; hardwareVersion: number | null; healthStatus: string;
  certificatePem: string; certificateFingerprint: string; certificateNote: string;
}
