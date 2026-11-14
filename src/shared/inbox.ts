import { z } from 'zod';
import type { MailExtract, MailKind } from './mailextract.js';

export const INBOX_STATUSES = ['new', 'done', 'ignored'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export const MAIL_KINDS = ['hotel', 'table', 'other'] as const;
export const MAIL_KIND_LABEL: Record<MailKind, string> = { hotel: 'Zimmer', table: 'Tisch', other: 'Sonstiges' };

export const inboxSettingsInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(120), port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535),
  user: z.string().trim().max(160), /** leer = gespeichertes Passwort behalten */ password: z.string().max(200),
  folder: z.string().trim().min(1).max(120).default('INBOX'),
  /** automatischer Abruf alle … Minuten; 0 = nur auf Knopfdruck */
  autoMinutes: z.number().int().min(0).max(1440),
});
export interface InboxSettingsDto { enabled: boolean; host: string; port: number; user: string; folder: string; autoMinutes: number; hasPassword: boolean }
export interface InboxState { lastFetchAt: string | null; lastError: string | null; ready: boolean; autoMinutes: number; newCount: number }

export interface InboxMailDto {
  id: string; fromName: string; fromAddr: string; subject: string; receivedAt: string; snippet: string;
  kind: MailKind; status: InboxStatus; extract: MailExtract;
  /** was daraus angelegt wurde */
  linkKind: 'booking' | 'table' | null; linkId: string | null; handledBy: string;
  repliedAt: string | null; repliedBy: string;
  /** nur in der Einzelansicht */
  body?: string;
}
export const inboxUpdateInput = z.object({
  status: z.enum(INBOX_STATUSES).optional(), kind: z.enum(MAIL_KINDS).optional(),
  linkKind: z.enum(['booking', 'table']).nullable().optional(), linkId: z.uuid().nullable().optional(),
});
export const inboxListQuery = z.object({ status: z.enum([...INBOX_STATUSES, 'all']).default('new'), kind: z.enum([...MAIL_KINDS, 'all']).default('all'), q: z.string().max(100).default('') });

// ---------- Antworten ----------
export const REPLY_TEMPLATES = ['reply', 'confirm', 'decline'] as const;
export type ReplyTemplate = (typeof REPLY_TEMPLATES)[number];

// ---------- E-Mail-Regeln (Einstellungen → Algorithmen → E-Mail) ----------
const words = z.array(z.string().trim().min(2).max(60)).max(50);
export const mailRulesInput = z.object({
  /** Nachrichten, die keine Zimmer- oder Tischanfrage sind, gleich unter „Ignoriert“ ablegen */
  hideOther: z.boolean(),
  hotelWords: words, tableWords: words,
  /** Absender (Teil der Adresse oder des Namens), deren Nachrichten nie als Anfrage gelten */
  ignoreSenders: words,
});
export type MailRules = z.infer<typeof mailRulesInput>;
