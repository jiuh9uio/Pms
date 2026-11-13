import { z } from 'zod';

/** Eingabeschemas – vom Server immer geprüft, von der Oberfläche für Sofort-Rückmeldung mitbenutzt. */

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { admin: 'Administrator', user: 'Benutzer' };

/** Bereiche des Programms, die je Benutzer freigegeben werden. Verwaltung und Konto sind dem Administrator vorbehalten. */
export const MODULES = ['hotel', 'restaurant', 'kontrollen', 'erechnung', 'internet'] as const;
/** Bereiche, die neue Benutzer von sich aus erhalten – „Internet“ (Geräte im Netz) gibt der Administrator bewusst frei. */
export const DEFAULT_MODULES: Module[] = ['hotel', 'restaurant', 'kontrollen', 'erechnung'];
export type Module = (typeof MODULES)[number];
export const MODULE_LABEL: Record<Module, string> = { hotel: 'Hotel', restaurant: 'Restaurant', kontrollen: 'Kontrollen', erechnung: 'E-Rechnung', internet: 'Internet' };
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
});
export type HotelSettings = z.infer<typeof hotelSettings>;
export const HOTEL_DEFAULTS: HotelSettings = {
  name: 'Hotel & Restaurant Schützenhaus', street: '', zip: '', city: '', country: 'Deutschland', phone: '', email: '', website: '',
  taxNumber: '', vatId: '', bankName: '', iban: '', bic: '', checkinTime: '15:00', checkoutTime: '11:00',
  invoicePrefix: 'RE', paymentTermDays: 14, invoiceFooter: '',
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
