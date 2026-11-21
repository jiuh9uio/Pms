import { z } from 'zod';
import type { MailAttachment, MailExtract, MailKind } from './mailextract.js';

export const INBOX_STATUSES = ['new', 'done', 'ignored'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];
export const MAIL_KINDS = ['hotel', 'table', 'event', 'meeting', 'voucher', 'order', 'question', 'other'] as const;
export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  hotel: 'Zimmer', table: 'Tisch', event: 'Feier / Veranstaltung', meeting: 'Tagung / Versammlung', voucher: 'Gutschein', order: 'Bestellung (Ware)', question: 'Allgemeine Frage', other: 'Sonstiges',
};
/** Kurzform für Abzeichen und Filter */
export const MAIL_KIND_SHORT: Record<MailKind, string> = { hotel: 'Zimmer', table: 'Tisch', event: 'Feier', meeting: 'Tagung', voucher: 'Gutschein', order: 'Bestellung', question: 'Frage', other: 'Sonstiges' };
export type InboxCounts = Record<MailKind | 'all', number>;

export const inboxSettingsInput = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(120), port: z.number('Bitte eine Zahl eingeben').int().min(1).max(65535),
  user: z.string().trim().max(160), /** leer = gespeichertes Passwort behalten */ password: z.string().max(200),
  folder: z.string().trim().min(1).max(120).default('INBOX'),
  /** automatischer Abruf alle … Minuten; 0 = nur auf Knopfdruck */
  autoMinutes: z.number().int().min(0).max(1440),
  /** erledigte und ignorierte Nachrichten nach so vielen Tagen aus dem Programm entfernen; 0 = nie */
  keepDays: z.number().int().min(0).max(3650).default(0),
});
export interface InboxSettingsDto { enabled: boolean; host: string; port: number; user: string; folder: string; autoMinutes: number; keepDays: number; hasPassword: boolean }
export interface InboxState { lastFetchAt: string | null; lastError: string | null; ready: boolean; autoMinutes: number; newCount: number; /** neue Nachrichten, die noch zu keinem Vorgang gehören */ newWithoutCase: number; /** Vorgänge, bei denen wir dran sind, plus neue Nachrichten ohne Vorgang */ attention: number }

export interface InboxMailDto {
  id: string; fromName: string; fromAddr: string; subject: string; receivedAt: string; snippet: string;
  kind: MailKind; status: InboxStatus; extract: MailExtract;
  /** was daraus angelegt wurde */
  linkKind: 'booking' | 'table' | null; linkId: string | null; handledBy: string;
  repliedAt: string | null; repliedBy: string;
  /** nur in der Einzelansicht */
  body?: string;
  /** Vorgang, zu dem die Nachricht gehört */
  caseId: string | null; caseNumber?: string | null;
  /** wer wirklich geschrieben hat: bei Kontaktformularen Name und Adresse aus dem Text; Name leer = kein brauchbarer Name */
  contactName?: string; contactAddr?: string; viaForm?: boolean;
  /** Eintrag der Liste „ausgefilterte Absender“, der auf diesen Absender passt (Adresse oder Domain) */
  blockedBy?: string | null;
  /** nur in der Einzelansicht: Angebot, zu dessen Verlauf die Nachricht gehört */
  offer?: { id: string; number: string } | null;
  /** nur in der Einzelansicht: Kostenvoranschlag/Rechnung, zu deren Verlauf die Nachricht gehört */
  invoice?: { id: string; label: string } | null;
}
export const inboxUpdateInput = z.object({
  status: z.enum(INBOX_STATUSES).optional(), kind: z.enum(MAIL_KINDS).optional(),
  linkKind: z.enum(['booking', 'table']).nullable().optional(), linkId: z.uuid().nullable().optional(),
});
export const inboxListQuery = z.object({ status: z.enum([...INBOX_STATUSES, 'all']).default('new'), kind: z.enum([...MAIL_KINDS, 'all']).default('all'), q: z.string().max(100).default('') });

// ---------- Antworten ----------
/** order_confirm = Auftragsbestätigung zu einer Bestellung, order_ready = „Ihre Bestellung ist da“ */
export const REPLY_TEMPLATES = ['reply', 'confirm', 'decline', 'order_confirm', 'order_ready'] as const;
export type ReplyTemplate = (typeof REPLY_TEMPLATES)[number];

// ---------- E-Mail-Regeln (Einstellungen → Algorithmen → E-Mail) ----------
const words = z.array(z.string().trim().min(2).max(60)).max(50);
export const mailRulesInput = z.object({
  /** Nachrichten, die keine Anfrage und keine Frage sind („Sonstiges“), gleich unter „Ignoriert“ ablegen */
  hideOther: z.boolean(),
  hotelWords: words, tableWords: words,
  eventWords: words.default([]), meetingWords: words.default([]), voucherWords: words.default([]), questionWords: words.default([]),
  /** Absender (Teil der Adresse oder des Namens), deren Nachrichten nie als Anfrage gelten */
  ignoreSenders: words,
});
export type MailRules = z.infer<typeof mailRulesInput>;

// ---------- Online-Buchungsanfrage (öffentliche Seite /anfrage) ----------
const realDay = (s: string) => { const t = Date.parse(`${s}T00:00:00Z`); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen').refine(realDay, 'Dieses Datum gibt es nicht');
export const webRequestInput = z.object({
  name: z.string().trim().min(2, 'Bitte Ihren Namen eintragen').max(120),
  email: z.email('Bitte eine gültige E-Mail-Adresse eintragen'),
  phone: z.string().trim().max(60).default(''),
  from: day, to: day,
  adults: z.number('Bitte eine Zahl eintragen').int().min(1).max(30), children: z.number().int().min(0).max(30).default(0),
  message: z.string().trim().max(1500).default(''),
  /** gewünschte Zimmerkategorie (von der Gästeseite), frei */
  category: z.string().trim().max(80).default(''),
  /** Datenschutzhinweis gelesen */
  consent: z.literal(true, 'Bitte den Hinweis zum Datenschutz bestätigen'),
  /** unsichtbares Feld gegen automatische Einträge – muss leer bleiben */
  website: z.string().max(200).default(''),
}).refine((v) => v.from < v.to, { message: 'Die Abreise muss nach der Anreise liegen', path: ['to'] });
export const webRequestSettingsInput = z.object({ enabled: z.boolean(), intro: z.string().trim().max(600), privacy: z.string().trim().max(1200) });
export type WebRequestSettings = z.infer<typeof webRequestSettingsInput>;
export interface WebRequestPublic { enabled: boolean; hotelName: string; intro: string; privacy: string }

// ---------- Vorgänge: zusammengehörige E-Mails mit eigener Nummer ----------
export const CASE_STATUSES = ['open', 'working', 'done', 'archived'] as const;
export const CASE_STATUS_LABEL: Record<(typeof CASE_STATUSES)[number], string> = { open: 'Offen', working: 'In Bearbeitung', done: 'Erledigt', archived: 'Archiviert' };
export type CaseStatus = (typeof CASE_STATUSES)[number];
/** ours = zuletzt hat der Kunde geschrieben (wir sind dran); theirs = zuletzt haben wir geschrieben */
export type CaseTurn = 'ours' | 'theirs';
export interface CaseListRow {
  /** case = Vorgang im Posteingang; offer / invoice = Verlauf eines Angebots bzw. Kostenvoranschlags (öffnet dort) */
  source: 'case' | 'offer' | 'invoice';
  id: string; number: string; kind: MailKind | 'offer' | 'estimate'; title: string; contact: string; status: CaseStatus; turn: CaseTurn | null;
  lastAt: string; snippet: string; count: number;
  /** eingegangene Nachrichten, die noch niemand bearbeitet hat */
  unread: number;
  /** Reservierung angelegt / Bestätigung gesendet (nur Vorgänge im Posteingang) */
  linked?: boolean; confirmed?: boolean;
  /** zuständiger Mitarbeiter (nur Vorgänge im Posteingang) */
  assignee?: string;
}
export interface CaseMessage { id: string; at: string; dir: 'in' | 'out'; who: string; subject: string; text: string; inboxMailId: string | null; mailStatus: InboxStatus | null; attachments: MailAttachment[] }
export interface CaseDto {
  id: string; number: string; kind: MailKind; title: string; contactName: string; contactAddr: string; status: CaseStatus; turn: CaseTurn | null; createdAt: string; createdBy: string;
  messages: CaseMessage[];
  /** letzte eingegangene Nachricht – auf sie beziehen sich Antwort, Übernahme und Bestätigung */
  latestInboxMailId: string | null;
  /** was aus der letzten Nachricht schon angelegt wurde (für „als Nächstes“) */
  latestLinkKind: 'booking' | 'table' | null;
  /** die Nachricht, aus der die Reservierung angelegt wurde – auf sie bezieht sich die Bestätigung */
  linkedInboxMailId: string | null;
  /** wann die Bestätigung der Reservierung gesendet wurde */
  confirmedAt: string | null;
  /** Bestellung: wann die Auftragsbestätigung bzw. die Nachricht „Ware ist da“ gesendet wurde */
  orderConfirmedAt: string | null; orderReadyAt: string | null;
  /** wann eine Absage gesendet wurde */
  declinedAt: string | null;
  candidates: { inboxMailId: string; at: string; from: string; subject: string }[];
  /** zuständiger Mitarbeiter (leer = niemand) */
  assignee: string;
  /** Zimmerreservierung, zu der der Vorgang gehört (E-Mail aus dem Hotelbereich gesendet) */
  bookingId: string | null; bookingNumber: string | null;
}
const caseDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
export const caseListQuery = z.object({ status: z.enum(['open', 'done', 'archived', 'all']).default('open'), kind: z.string().max(20).default('all'), q: z.string().trim().max(80).default(''), from: caseDay, to: caseDay, assignee: z.string().trim().max(120).default('') });
export const caseNumberInput = z.object({ number: z.string().trim().regex(/^[Vv]-\d{4}-\d{4,6}$/, 'Bitte eine Vorgangsnummer wie V-2026-0001 eintragen') });
export const caseUpdateInput = z.object({ kind: z.enum(MAIL_KINDS).optional(), status: z.enum(CASE_STATUSES).optional(), title: z.string().trim().max(200).optional(), assignee: z.string().trim().max(120).optional() });

// ---------- Hinweis „Als Nächstes“ im Vorgang: je Kategorie einstellbar (Vorgänge → Antwortvorlagen) ----------
const nextText = z.string().trim().min(1, 'Bitte einen Text eintragen').max(300);
export const nextTextsInput = z.object({
  hotel: nextText, table: nextText, event: nextText, meeting: nextText, voucher: nextText, order: nextText.default('Bestellung: prüfen, ob lieferbar – dann die Auftragsbestätigung senden.'), question: nextText, other: nextText,
  /** Zimmer- bzw. Tischreservierung ist angelegt, die Bestätigung fehlt noch */
  bookingMade: nextText, tableMade: nextText,
});
export type NextTexts = z.infer<typeof nextTextsInput>;
export const NEXT_TEXT_LABEL: Record<keyof NextTexts, string> = {
  hotel: 'Zimmeranfrage', table: 'Tischanfrage', event: 'Feier', meeting: 'Tagung', voucher: 'Gutschein', order: 'Bestellung', question: 'Frage', other: 'Sonstiges',
  bookingMade: 'Zimmerreservierung angelegt', tableMade: 'Tischreservierung angelegt',
};
export const DEFAULT_NEXT_TEXTS: NextTexts = {
  hotel: 'Zimmeranfrage: Verfügbarkeit prüfen, dann Reservierung anlegen oder antworten.', table: 'Tischanfrage: Tisch reservieren oder antworten.',
  event: 'Anfrage für eine Feier: antworten – oder im Bereich Angebote eine Absprache / ein Angebot anlegen.', meeting: 'Tagungsanfrage: antworten – oder im Bereich Angebote ein Angebot anlegen.',
  voucher: 'Gutschein-Anfrage: antworten – der Gutschein wird im Bereich Gutscheine ausgestellt.', order: 'Bestellung: prüfen, ob lieferbar – dann die Auftragsbestätigung senden.', question: 'Frage des Kunden beantworten.', other: 'Nachricht lesen und antworten – oder als erledigt markieren.',
  bookingMade: 'Die Zimmerreservierung ist angelegt – jetzt die Bestätigung senden oder antworten.', tableMade: 'Die Tischreservierung ist angelegt – jetzt die Bestätigung senden oder antworten.',
};

// ---------- Antwortvorschläge: eigene Textbausteine je Kategorie (Vorgänge → Antwortvorlagen) ----------
/** Platzhalter im Text: {anrede} = „Guten Tag Frau/Herr …,“ bzw. „Guten Tag,“ · {haus} = Name des Hauses. Die Grußformel mit Absender wird automatisch angehängt. */
export const replySnippet = z.object({
  id: z.string().min(1).max(40), kind: z.enum([...MAIL_KINDS, 'all']), title: z.string().trim().min(1, 'Bitte einen Namen eintragen').max(60),
  text: z.string().trim().min(1, 'Bitte einen Text eintragen').max(3000), active: z.boolean().default(true),
});
export type ReplySnippet = z.infer<typeof replySnippet>;
export const replySnippetsInput = z.object({ items: z.array(replySnippet).max(60) });
export const DEFAULT_REPLY_SNIPPETS: ReplySnippet[] = [
  { id: 'hotel-daten', kind: 'hotel', title: 'Rückfrage: Reisedaten', active: true, text: '{anrede}\n\nvielen Dank für Ihre Anfrage. Damit wir Ihnen ein passendes Zimmer anbieten können, teilen Sie uns bitte noch mit:\n\n- An- und Abreisetag\n- Anzahl der Personen (davon Kinder)\n- Einzel- oder Doppelzimmer' },
  { id: 'hotel-frei', kind: 'hotel', title: 'Zimmer frei – bitte bestätigen', active: true, text: '{anrede}\n\nvielen Dank für Ihre Anfrage. In dem gewünschten Zeitraum haben wir ein Zimmer für Sie frei.\n\nMöchten Sie verbindlich reservieren? Dann antworten Sie uns bitte kurz – gern auch mit Ihrer Telefonnummer und der voraussichtlichen Ankunftszeit.' },
  { id: 'hotel-fruehstueck', kind: 'hotel', title: 'Rückfrage: Frühstück / Ankunft', active: true, text: '{anrede}\n\ngern reservieren wir für Sie. Zwei kurze Fragen noch:\n\n- Möchten Sie mit Frühstück buchen?\n- Wann reisen Sie voraussichtlich an?' },
  { id: 'tisch-daten', kind: 'table', title: 'Rückfrage: Uhrzeit und Personen', active: true, text: '{anrede}\n\nvielen Dank für Ihre Anfrage. Für die Tischreservierung brauchen wir noch:\n\n- Datum und Uhrzeit\n- Anzahl der Personen\n- eine Telefonnummer für Rückfragen' },
  { id: 'feier-daten', kind: 'event', title: 'Rückfrage zur Feier', active: true, text: '{anrede}\n\nvielen Dank für Ihre Anfrage – wir richten Ihre Feier gern aus. Damit wir Ihnen ein Angebot machen können, teilen Sie uns bitte mit:\n\n- Termin und Uhrzeit\n- Anzahl der Personen\n- Anlass (z. B. Geburtstag, Hochzeit)\n- Wünsche zum Essen (Menü, Buffet, à la carte)' },
  { id: 'tagung-daten', kind: 'meeting', title: 'Rückfrage zur Tagung', active: true, text: '{anrede}\n\nvielen Dank für Ihre Anfrage. Für ein Angebot brauchen wir noch:\n\n- Termin, Beginn und Ende\n- Anzahl der Teilnehmer\n- benötigte Technik (Beamer, Leinwand …)\n- Verpflegung und ggf. Übernachtungen' },
  { id: 'gutschein-info', kind: 'voucher', title: 'Gutschein: so geht es', active: true, text: '{anrede}\n\nvielen Dank für Ihr Interesse an einem Gutschein. Bitte teilen Sie uns den gewünschten Wert mit und ob wir den Gutschein per Post oder per E-Mail schicken sollen. Sie erhalten dann alles Weitere von uns.' },
  { id: 'alle-melden', kind: 'all', title: 'Wir melden uns', active: true, text: '{anrede}\n\nvielen Dank für Ihre Nachricht. Wir kümmern uns darum und melden uns so schnell wie möglich bei Ihnen.' },
  { id: 'alle-anruf', kind: 'all', title: 'Bitte um Rückruf-Nummer', active: true, text: '{anrede}\n\nvielen Dank für Ihre Nachricht. Das klären wir am besten kurz am Telefon – unter welcher Nummer und wann erreichen wir Sie am besten?' },
];
