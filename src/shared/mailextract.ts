/**
 * E-Mails lesen: Art der Anfrage schätzen (Zimmer, Tisch, Feier, Tagung, Gutschein, allgemeine Frage, Sonstiges) und Angaben herausziehen
 * (Datum, Uhrzeit, Personen, Telefon). Reine Mustererkennung – das Ergebnis ist ein Vorschlag,
 * den ein Mensch prüft, bevor daraus eine Reservierung wird.
 */
/** order = Bestellung von Ware (z. B. ein Fass Bier) – wird nicht automatisch erkannt, sondern beim Einsortieren gewählt */
export type MailKind = 'hotel' | 'table' | 'event' | 'meeting' | 'voucher' | 'order' | 'question' | 'other';
/** id = im Programm gespeichert und abrufbar; ohne id nur der Name (zu groß oder aus der Zeit vor dem Speichern) */
export interface MailAttachment { name: string; size: number; type: string; id?: string }
export interface MailExtract {
  kind: MailKind;
  /** Namen der Anhänge (die Dateien selbst liegen nur im Postfach) */
  attachments?: MailAttachment[];
  /** wann die Bestätigung der daraus angelegten Reservierung gesendet wurde */
  confirmedAt?: string;
  /** Bestellung: Auftragsbestätigung gesendet / Nachricht „Ware ist da“ gesendet */
  orderConfirmedAt?: string; orderReadyAt?: string;
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
  const p = new RegExp(String.raw`${NUM}\s*(?:Personen|Person|Pers\.?|Gäste|Gästen|Leute|Leuten|Mann|Teilnehmer(?:n|innen)?|Teilnehmende(?:n)?|Mitarbeiter(?:n)?|Kollegen)\b`, 'i').exec(text);
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

/**
 * Einordnung nach Stichwörtern mit Gewicht. Jede Art hat starke Wörter (eindeutig, Gewicht 3) und schwache (Gewicht 1);
 * Treffer im Betreff zählen doppelt. Danach entscheiden einige Regeln aus dem Alltag, z. B.:
 *  - „Tisch für 4 zum Geburtstag“ ist eine Tischreservierung, „Geburtstagsfeier mit 40 Gästen im Saal“ eine Feier,
 *  - eine Tagung oder Feier mit Übernachtung bleibt eine Tagung bzw. Feier (die Zimmer gehören dazu),
 *  - ohne Treffer: Steht eine Frage im Text, ist es eine allgemeine Frage, sonst „Sonstiges“,
 *  - Newsletter, automatische Benachrichtigungen und Werbung sind „Sonstiges“.
 */
/** \b und \w verstehen in JavaScript keine Umlaute – hier eine Fassung, die „Übernachtung“, „Menü“ und „Ärzte“ richtig trennt. */
const WCH = String.raw`[\p{L}\p{N}_]`;
const U = (re: RegExp) => new RegExp(re.source.replace(/\\b/g, String.raw`(?:(?<!${WCH})(?=${WCH})|(?<=${WCH})(?!${WCH}))`).replace(/\\w/g, WCH), re.flags.includes('u') ? re.flags : `${re.flags}u`);
type Scored = Exclude<MailKind, 'order' | 'question' | 'other'>;
const W0: Record<Scored, { strong: RegExp; weak: RegExp }> = {
  hotel: {
    strong: /\b(?:doppel|einzel|dreibett|familien|mehrbett|monteur|zwei?bett)?zimmer(?:anfrage|reservierung|buchung|preis|preise)?\b|übernacht\w*|uebernacht\w*|\bnächte\b|\bnacht\b|\banreise\b|\babreise\b|\bcheck-?in\b|\bcheck-?out\b|\bunterkunft\b|ferienwohnung|zimmerkategorie|\bschlafen\b|\bschlafmöglichkeit\w*/gi,
    weak: /\bhotel\b|frühstück|\bbetten?\b|\bbleiben\b|\baufenthalt\b|\bwochenende\b/gi,
  },
  table: {
    strong: /\btisch(?:e|reservierung|anfrage)?\b|tischreserv\w*|\bmittagessen\b|\babendessen\b|\bmittagstisch\b|essen gehen|zum essen|\bbrunch\b|\bplätze\b|sonntagsessen|\bà la carte\b|\ba la carte\b/gi,
    weak: /\brestaurant\b|\bspeisen\b|\bspeisekarte\b|\bessen\b|\bmittag\b|\babends?\b|\bkaffee und kuchen\b|\bgeburtstagsessen\b/gi,
  },
  event: {
    strong: /\bfeier\b|\w+feier\b|\bfeiern\b|\bhochzeit\w*|\bheirat\w*|\blocation\b|\bpolterabend\b|\bjubiläum\b|\btaufe\b|\bkonfirmation\b|\bjugendweihe\b|\bkommunion\b|\btrauerfeier\b|\btrauerkaffee\b|\bleichenschmaus\b|\bverlobung\b|\bklassentreffen\b|\bfestsaal\b|\bsaal\b|\bgesellschaft\b|\bveranstaltung\w*|\bparty\b|\bbankett\b/gi,
    weak: /\bgeburtstag\w*|\bbuffet\b|\bbüfett\b|\bmenü\b|\bfestessen\b|\bfeierlichkeit\w*|\bgäste\b|\bdeko\w*|\bdj\b|\bmusik\b|\bsilvester\b|\bweihnachts\w*/gi,
  },
  meeting: {
    strong: /\btagung\w*|\bseminar\w*|\bkonferenz\w*|\bversammlung\w*|\bjahreshauptversammlung\b|\bmitgliederversammlung\b|\binnung\w*|\bschulung\w*|\bworkshop\w*|\bfortbildung\w*|\bweiterbildung\w*|\bqualitätszirkel\b|\bsitzung\w*|\bklausur\w*|\bbesprechungsraum\b|\btagungsraum\b|\btagungspauschale\b/gi,
    weak: /\bstammtisch\w*|\bbeamer\b|\bleinwand\b|\bflipchart\b|\bpinnwand\b|\bmoderationskoffer\b|\bbestuhlung\b|\bteilnehmer\w*|\bvortrag\w*|\breferent\w*|\bkaffeepause\b|\bärzte\w*|\bverein\b|\bvorstand\b|\bfirma\b|\bkollegen\b/gi,
  },
  voucher: {
    strong: /\bgutschein\w*|\bgeschenkgutschein\w*|\bwertgutschein\w*|\bgutscheincode\b|\bgeschenkkarte\b/gi,
    weak: /\bverschenken\b|\bschenken\b|\beinlösen\b|\bgeschenk\b/gi,
  },
};
const W = Object.fromEntries(Object.entries(W0).map(([k, v]) => [k, { strong: U(v.strong), weak: U(v.weak) }])) as typeof W0;
const ASKS = U(/reserv|buch|anfrage|\bfrei\b|verfügbar|möchte|möchten|würde|würden|hätten|haben sie|planen|suchen|interesse|angebot|anfragen|bitte um|können sie|kann man/i);
const QUESTION = U(/\?|\bfrage\b|\bfragen\b|\bwissen\b|\binformation\w*\b|\bauskunft\b|\böffnungszeit\w*|\bgeöffnet\b|\bruhetag\w*|\bparkpl\w*|\bhund\w*|\bbarrierefrei\w*|\brollstuhl\w*|\ballergi\w*|\bvegan\w*|\bvegetari\w*|\bgluten\w*|\bladestation\b|\bwlan\b|\bbezahl\w*|\bkartenzahlung\b|\bfundsache\b|\bverloren\b|\bvergessen\b/i);
const AUTOMATIC = U(/\bnewsletter\b|\babmelden\b|\bunsubscribe\b|\bno-?reply\b|\bnicht auf diese (e-?mail|nachricht) antworten\b|\bautomatisch erstellt\b|\bwerbung\b|\bgewinnspiel\b|\brechnung nr\b|\bihre bestellung\b|\bversandbestätigung\b|\bmailer-daemon\b|\bunzustellbar\b|\bdelivery status\b|\bout of office\b|\babwesenheitsnotiz\b/i);
const PERSONAL = U(/\b(ich|wir) (möchte|möchten|würde|würden|hätte|hätten|suche|suchen|planen|brauche|brauchen)\b|\bbitte um\b|\bkönnten sie\b|\bkönnen sie\b/i);
const STRONG_EVENT = U(/\bsaal\b|\bfestsaal\b|\bhochzeit|\btrauer|\bleichenschmaus|\bjugendweihe|\bkonfirmation|\bkommunion|\btaufe\b|\bpolterabend|\bbuffet|\bbüfett|\bgesellschaft\b|\bveranstaltung|\bjubiläum/i);

/** Zusätzliche Stichwörter aus den Einstellungen (Algorithmen → E-Mail) */
export type ExtraWords = Partial<Record<Scored | 'question', string[]>>;
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const hits = (text: string, words: string[] = []) => { const low = text.toLowerCase(); return words.filter((w) => w.trim() && low.includes(w.trim().toLowerCase())).length; };

export interface Scores { kind: MailKind; scores: Record<Scored, number> }
/** Punkte je Art (für die Anzeige „warum so eingeordnet“ und für Tests). */
export function score(subject: string, body: string, extra: ExtraWords = {}): Scores {
  const text = `${subject}\n${body}`;
  const scores = {} as Record<Scored, number>;
  for (const k of Object.keys(W) as Scored[]) {
    const { strong, weak } = W[k];
    scores[k] = 3 * (count(text, strong) + count(subject, strong)) + count(text, weak) + count(subject, weak) + 4 * hits(text, extra[k]);
  }
  return { kind: decide(subject, text, { ...scores }, extra), scores };
}

function decide(subject: string, text: string, s: Record<Scored, number>, extra: ExtraWords): MailKind {
  const max = Math.max(...Object.values(s));
  // Automatische Nachrichten und Werbung – außer es steht eine deutliche persönliche Anfrage darin
  if (AUTOMATIC.test(text) && (max < 6 || !PERSONAL.test(text))) return 'other';
  if (max === 0) return QUESTION.test(text) || hits(text, extra.question) ? 'question' : 'other';
  const { persons } = findPersons(text);
  // Geburtstag & Co. mit Tisch: kleine Runde ohne Saal/Buffet = Tischreservierung
  if (s.event > 0 && s.table > 0 && !STRONG_EVENT.test(text) && (persons ?? 0) <= 12) s.event = Math.min(s.event, s.table - 1);
  // Tagung/Feier mit Übernachtung bleibt Tagung/Feier
  if (s.meeting >= 3 && s.hotel > 0) s.hotel = Math.min(s.hotel, s.meeting - 1);
  if (s.event >= 3 && s.hotel > 0 && STRONG_EVENT.test(text)) s.hotel = Math.min(s.hotel, s.event - 1);
  // Gutschein im Betreff ist eindeutig (Werbung mit Gutschein wurde oben schon als „Sonstiges“ erkannt)
  if (/gutschein/i.test(subject)) return 'voucher';
  // bei Gleichstand gewinnt die konkretere Anfrage (Tisch, Zimmer) vor Feier und Tagung
  const order: Scored[] = ['voucher', 'table', 'hotel', 'event', 'meeting'];
  const best = order.reduce((a, b) => (s[b] > s[a] ? b : a));
  if (s[best] === 0) return QUESTION.test(text) ? 'question' : 'other';
  // Nur schwache Treffer und keine Bitte/Frage: keine Anfrage
  if (s[best] < 3 && !ASKS.test(text) && !QUESTION.test(text)) return 'other';
  if (s[best] < 3 && !ASKS.test(text)) return 'question';
  return best;
}

export function classify(text: string, extra: ExtraWords = {}): MailKind {
  const [subject, ...rest] = text.split('\n');
  return score(subject ?? '', rest.join('\n'), extra).kind;
}

/** ref = Tag, an dem die Mail einging (für Angaben ohne Jahr und für „morgen“). */
export function extract(subject: string, body: string, ref: string, extra?: ExtraWords): MailExtract {
  const text = `${subject}\n${ownText(body)}`;
  const body0 = ownText(body);
  const kind = score(subject, body0, extra).kind;
  const dates = findDates(text, ref);
  const { persons, children } = findPersons(text);
  let from: string | null = null, to: string | null = null;
  if (kind === 'hotel' && dates.length) {
    from = dates[0]!;
    to = dates.find((d) => d > from!) ?? null;
    const nights = new RegExp(String.raw`${NUM}\s*(?:Nächte|Nacht|Übernachtung(?:en)?)`, 'i').exec(text);
    if (!to && nights && num(nights[1]!)) to = addDays(from, num(nights[1]!)!);
  }
  if ((kind === 'meeting' || kind === 'event') && dates.length) { from = dates[0]!; to = dates.find((d) => d > from!) ?? null; }
  return { kind, dates, from, to, time: kind === 'hotel' || kind === 'voucher' ? null : findTime(text), persons, children, phone: findPhone(text) };
}
