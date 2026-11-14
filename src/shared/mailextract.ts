/**
 * E-Mails lesen: Art der Anfrage schätzen (Hotel, Tisch, Sonstiges) und Angaben herausziehen
 * (Datum, Uhrzeit, Personen, Telefon). Reine Mustererkennung – das Ergebnis ist ein Vorschlag,
 * den ein Mensch prüft, bevor daraus eine Reservierung wird.
 */
export type MailKind = 'hotel' | 'table' | 'other';
export interface MailExtract {
  kind: MailKind;
  /** gefundene Tage in Reihenfolge des Textes, ohne Doppelte (ISO) */
  dates: string[];
  /** Hotel: Anreise und Abreise, wenn erkennbar */
  from: string | null; to: string | null;
  /** Tisch: Uhrzeit HH:MM */
  time: string | null;
  persons: number | null; children: number | null;
  phone: string;
}

const MONTHS: Record<string, number> = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mrz: 3, april: 4, apr: 4, mai: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};
const WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  zweit: 2, dritt: 3, viert: 4, fünft: 5, sechst: 6, siebt: 7, acht_: 8, zehnt: 10,
};
const NUM = String.raw`(\d{1,3}|ein(?:e|en)?|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|elf|zwölf)`;
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORDS[s.toLowerCase()] ?? null);
const pad = (n: number) => String(n).padStart(2, '0');
const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Zitate früherer Nachrichten und angehängte Originalmails abschneiden, damit alte Daten nicht mitgelesen werden. */
export function ownText(text: string): string {
  const lines: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^-{2,}\s*(Original|Ursprüngliche|Weitergeleitete)/i.test(line) || /^(Am|On) .{5,80}(schrieb|wrote)\b.*:?\s*$/i.test(line) || /^Von:\s.+/.test(line) && lines.length > 3) break;
    if (!line.startsWith('>')) lines.push(line);
  }
  return lines.join('\n');
}

/** Jahr ergänzen: der nächste solche Tag ab dem Bezugstag (eine Anfrage meint fast nie die Vergangenheit). */
function withYear(m: number, d: number, ref: string, year?: number): string | null {
  let y = year ?? Number(ref.slice(0, 4));
  if (year != null && year < 100) y = 2000 + year;
  if (!valid(y, m, d)) return null;
  let iso = `${y}-${pad(m)}-${pad(d)}`;
  if (year == null && iso < ref && valid(y + 1, m, d)) iso = `${y + 1}-${pad(m)}-${pad(d)}`;
  return iso;
}

export function findDates(text: string, ref: string): string[] {
  const hits: { at: number; iso: string }[] = [];
  const push = (at: number, iso: string | null) => { if (iso) hits.push({ at, iso }); };
  const mon = Object.keys(MONTHS).join('|');
  let m: RegExpExecArray | null;
  // 12.-14.05.2027 · 12. bis 14.05. · 12./13.05.
  const range = /(?<!\d)(\d{1,2})\.\s*(?:-|–|bis|\/|und)\s*(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/gi;
  while ((m = range.exec(text))) {
    const y = m[4] ? Number(m[4]) : undefined;
    const b = withYear(Number(m[3]), Number(m[2]), ref, y);
    const a = b && withYear(Number(m[3]), Number(m[1]), ref, y ?? Number(b.slice(0, 4)));
    push(m.index, a && a <= b! ? a : null); push(m.index + 1, b);
  }
  // 12. bis 14. Mai (2027)
  const rangeW = new RegExp(String.raw`(?<!\d)(\d{1,2})\.?\s*(?:-|–|bis|und)\s*(?:zum\s+)?(\d{1,2})\.?\s*(${mon})\b\.?\s*(\d{4})?`, 'gi');
  while ((m = rangeW.exec(text))) {
    const mo = MONTHS[m[3]!.toLowerCase()]!, y = m[4] ? Number(m[4]) : undefined;
    const b = withYear(mo, Number(m[2]), ref, y);
    const a = b && withYear(mo, Number(m[1]), ref, y ?? Number(b.slice(0, 4)));
    push(m.index, a && a <= b! ? a : null); push(m.index + 1, b);
  }
  // 12.05.2027 · 12.05.27 · 12.05.
  const dmy = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})?(?!\d)/g;
  while ((m = dmy.exec(text))) push(m.index, withYear(Number(m[2]), Number(m[1]), ref, m[3] ? Number(m[3]) : undefined));
  // 12. Mai 2027 · 12 Mai
  const dW = new RegExp(String.raw`(?<![\d.])(\d{1,2})\.?\s*(${mon})\b\.?\s*(\d{4})?`, 'gi');
  while ((m = dW.exec(text))) push(m.index, withYear(MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), ref, m[3] ? Number(m[3]) : undefined));
  // 2027-05-12
  const iso = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
  while ((m = iso.exec(text))) push(m.index, valid(Number(m[1]), Number(m[2]), Number(m[3])) ? m[0] : null);
  // heute / morgen / übermorgen
  // „Guten Morgen“ und „morgens“ sind keine Tagesangaben
  const rel = /(?<!guten\s)(?<!am\s)\b(heute|morgen|übermorgen)\b/gi;
  while ((m = rel.exec(text))) push(m.index, addDays(ref, m[1]!.toLowerCase() === 'heute' ? 0 : m[1]!.toLowerCase() === 'morgen' ? 1 : 2));
  const out: string[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) if (!out.includes(h.iso)) out.push(h.iso);
  return out;
}

export function findTime(text: string): string | null {
  const m = /(?<![\d.:])([01]?\d|2[0-3])(?:[:.]([0-5]\d))?\s*(?:Uhr|h\b)/i.exec(text) ?? /(?<![\d.:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/.exec(text);
  return m ? `${pad(Number(m[1]))}:${m[2] ?? '00'}` : null;
}

export function findPersons(text: string): { persons: number | null; children: number | null } {
  const adults = new RegExp(String.raw`${NUM}\s*Erwachsene`, 'i').exec(text);
  const kids = new RegExp(String.raw`${NUM}\s*(?:Kind(?:er|ern)?|Kleinkind(?:er)?)\b`, 'i').exec(text);
  const children = kids ? num(kids[1]!) : null;
  if (adults) return { persons: num(adults[1]!), children };
  const p = new RegExp(String.raw`${NUM}\s*(?:Personen|Person|Pers\.?|Gäste|Gästen|Leute|Leuten|Mann)\b`, 'i').exec(text);
  if (p) return { persons: num(p[1]!), children };
  const zu = /\bzu\s+(zweit|dritt|viert|fünft|sechst|siebt|acht|zehnt)\b/i.exec(text);
  if (zu) return { persons: zu[1]!.toLowerCase() === 'acht' ? 8 : WORDS[zu[1]!.toLowerCase()] ?? null, children };
  if (/\bfür mich( allein)?\b|\beine Person\b|\bEinzelzimmer\b/i.test(text)) return { persons: 1, children };
  return { persons: null, children };
}

export function findPhone(text: string): string {
  const m = /(?:Tel(?:efon)?\.?|Mobil|Handy|Fon|Rückruf(?:nummer)?)\s*:?\s*((?:\+|00)?[\d][\d\s/()-]{6,20}\d)/i.exec(text) ?? /(?<![\d.])((?:\+49|0049|0)\s?[1-9][\d\s/()-]{6,18}\d)(?![\d.])/.exec(text);
  return m ? m[1]!.replace(/\s+/g, ' ').trim() : '';
}

const HOTEL = /zimmer|übernacht|uebernacht|anreise|abreise|\bnächte\b|\bnacht\b|check-?in|unterkunft|\bhotel\b|frühstück|doppelzimmer|einzelzimmer|ferienwohnung/gi;
const TABLE = /\btisch|mittagessen|abendessen|zum essen|essen gehen|brunch|\brestaurant\b|speisen|\bgeburtstagsessen\b|\bplätze\b|tischreserv/gi;
/** Zusätzliche Stichwörter aus den Einstellungen (Algorithmen → E-Mail) */
export interface ExtraWords { hotel: string[]; table: string[] }
const hits = (text: string, words: string[]) => { const low = text.toLowerCase(); return words.filter((w) => w.trim() && low.includes(w.trim().toLowerCase())).length; };
export function classify(text: string, extra: ExtraWords = { hotel: [], table: [] }): MailKind {
  const h = (text.match(HOTEL) ?? []).length + hits(text, extra.hotel), t = (text.match(TABLE) ?? []).length + hits(text, extra.table);
  const asks = /reserv|buch|anfrage|frei|verfügbar|möchte|würde|hätten|haben sie/i.test(text);
  if (!asks || (h === 0 && t === 0)) return 'other';
  return h > t ? 'hotel' : 'table';
}

/** ref = Tag, an dem die Mail einging (für Angaben ohne Jahr und für „morgen“). */
export function extract(subject: string, body: string, ref: string, extra?: ExtraWords): MailExtract {
  const text = `${subject}\n${ownText(body)}`;
  const kind = classify(text, extra);
  const dates = findDates(text, ref);
  const { persons, children } = findPersons(text);
  let from: string | null = null, to: string | null = null;
  if (kind === 'hotel' && dates.length) {
    from = dates[0]!;
    to = dates.find((d) => d > from!) ?? null;
    const nights = new RegExp(String.raw`${NUM}\s*(?:Nächte|Nacht|Übernachtung(?:en)?)`, 'i').exec(text);
    if (!to && nights && num(nights[1]!)) to = addDays(from, num(nights[1]!)!);
  }
  return { kind, dates, from, to, time: kind === 'hotel' ? null : findTime(text), persons, children, phone: findPhone(text) };
}
