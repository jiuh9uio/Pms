import { z } from 'zod';

/**
 * Restaurant-Ausblick: grobe Einschätzung, ob heute eher Gäste ohne Reservierung kommen („Walk-ins“) und ob Gäste eher
 * früh gehen. Das ist KEINE Vorhersage aus Daten, sondern eine Regel-Schätzung nach festen, sichtbaren Gründen
 * (Wochentag, Feiertag, Wetter, Fußball am Abend, selbst eingetragene Veranstaltungen). Die Gewichte sind eigene
 * Annahmen und sollen sich im Alltag bewähren bzw. angepasst werden.
 */

export const OUTLOOK_EFFECTS = ['more', 'fewer', 'leave'] as const;
export type OutlookEffect = (typeof OUTLOOK_EFFECTS)[number];
export const EFFECT_LABEL: Record<OutlookEffect, string> = {
  more: 'bringt eher Gäste (z. B. Markt, Fest in der Nähe)',
  fewer: 'hält eher Gäste fern (z. B. großes Fest woanders)',
  leave: 'Gäste gehen eher früher (z. B. Konzert, Spiel am Abend)',
};

const hour = z.number('Bitte eine Zahl eingeben').int().min(0, '0 bis 24').max(24, '0 bis 24');
export const outlookSettingsInput = z.object({
  lat: z.number().min(-90).max(90).nullable(),
  lon: z.number().min(-180).max(180).nullable(),
  /** nur zur Anzeige, z. B. „Musterstadt“ */
  place: z.string().trim().max(120).default(''),
  /** Kürzel der Ligen bei OpenLigaDB, durch Komma getrennt (z. B. bl1, bl2, dfb) – leer = kein Fußball */
  leagues: z.string().trim().max(120).regex(/^[a-z0-9, ]*$/i, 'Nur Kürzel wie bl1, bl2, dfb – durch Komma getrennt').default('bl1, bl2, dfb'),
  /** Verein, dessen Spiele besonders zählen (Teil des Namens genügt, z. B. „Schalke“) */
  favoriteTeam: z.string().trim().max(60).default(''),
  lunchFrom: hour.default(11), lunchTo: hour.default(14), dinnerFrom: hour.default(17), dinnerTo: hour.default(22),
  /** Erfahrungswerte des Hauses: ab dieser Temperatur und kälter kommen mehr Gäste (deftige Winterküche) */
  coldC: z.number('Bitte eine Zahl eingeben').min(-20).max(25).default(10),
  coldPoints: z.number('Bitte eine Zahl eingeben').int().min(0).max(40).default(15),
  /** November bis März: Wintersaison, mehr Nachfrage nach der Küche des Hauses */
  winterSeason: z.boolean().default(true),
  /** Fußball während der Öffnungszeit: Gäste gehen deutlich früher */
  footballLeavePoints: z.number('Bitte eine Zahl eingeben').int().min(0).max(60).default(35),
}).refine((v) => v.lunchFrom < v.lunchTo && v.dinnerFrom < v.dinnerTo, { message: 'Beginn muss vor dem Ende liegen', path: ['dinnerTo'] });
export type OutlookSettings = z.infer<typeof outlookSettingsInput>;
export const OUTLOOK_DEFAULTS: OutlookSettings = { lat: null, lon: null, place: '', leagues: 'bl1, bl2, dfb', favoriteTeam: '', lunchFrom: 11, lunchTo: 14, dinnerFrom: 17, dinnerTo: 22, coldC: 10, coldPoints: 15, winterSeason: true, footballLeavePoints: 35 };

export const outlookEventInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte ein Datum wählen'),
  time: z.union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Format HH:MM')]).default(''),
  title: z.string().trim().min(1, 'Bitte kurz beschreiben').max(120),
  effect: z.enum(OUTLOOK_EFFECTS),
});
export type OutlookEventInput = z.infer<typeof outlookEventInput>;
export interface OutlookEvent extends OutlookEventInput { id: string; createdBy: string }

/** Wetter je Stunde (Ortszeit) */
export interface WeatherHour { hour: number; temp: number | null; precip: number | null; prob: number | null; condition: string | null }
export interface Match { time: string; title: string; league: string; favorite: boolean }
export interface Reason { text: string; points: number }
export interface Gauge { score: number; level: 'niedrig' | 'mittel' | 'hoch'; reasons: Reason[] }
export interface OutlookDto {
  date: string; weekday: string; holiday: string | null; holidayTomorrow: string | null;
  walkIn: Gauge; leaveEarly: Gauge;
  weather: { lunch: WeatherSummary | null; dinner: WeatherSummary | null; source: string; error: string | null; configured: boolean };
  matches: Match[]; matchesError: string | null;
  events: OutlookEvent[];
  reservations: { persons: number; seats: number; count: number };
  hints: string[];
}
export interface WeatherSummary { from: number; to: number; tempAvg: number | null; tempMin: number | null; tempMax: number | null; wetHours: number; hours: number; precipSum: number; snow: boolean; storm: boolean; label: string }

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
export const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
const addDays = (d: string, n: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

/** Ostersonntag (gregorianisch, Gaußsche Osterformel in der Form von Meeus/Jones/Butcher). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
/** Bundesweite gesetzliche Feiertage (ohne die nur in einzelnen Ländern geltenden). */
export function holidayName(d: string): string | null {
  const y = Number(d.slice(0, 4)), md = d.slice(5);
  const fixed: Record<string, string> = { '01-01': 'Neujahr', '05-01': 'Tag der Arbeit', '10-03': 'Tag der Deutschen Einheit', '12-25': '1. Weihnachtstag', '12-26': '2. Weihnachtstag' };
  if (fixed[md]) return fixed[md]!;
  const e = easter(y);
  const mov: [number, string][] = [[-2, 'Karfreitag'], [1, 'Ostermontag'], [39, 'Christi Himmelfahrt'], [50, 'Pfingstmontag']];
  for (const [n, name] of mov) if (addDays(e, n) === d) return name;
  return null;
}

const WET = new Set(['rain', 'sleet', 'hail', 'thunderstorm', 'snow']);
const isWet = (h: WeatherHour) => (h.condition !== null && WET.has(h.condition)) || (h.precip ?? 0) >= 0.2 || (h.prob ?? 0) >= 60;
const round = (n: number) => Math.round(n * 10) / 10;

export function summarize(hours: WeatherHour[], from: number, to: number): WeatherSummary | null {
  const hs = hours.filter((h) => h.hour >= from && h.hour < to);
  if (!hs.length) return null;
  const temps = hs.map((h) => h.temp).filter((t): t is number => t !== null);
  const wetHours = hs.filter(isWet).length;
  const snow = hs.some((h) => h.condition === 'snow' || h.condition === 'sleet');
  const storm = hs.some((h) => h.condition === 'thunderstorm' || h.condition === 'hail');
  const tempAvg = temps.length ? round(temps.reduce((s, t) => s + t, 0) / temps.length) : null;
  const precipSum = round(hs.reduce((s, h) => s + (h.precip ?? 0), 0));
  const label = [tempAvg !== null ? `${Math.round(tempAvg)} °C` : null, storm ? 'Gewitter' : snow ? 'Schnee' : wetHours >= hs.length / 2 ? 'nass' : wetHours ? 'zeitweise nass' : 'trocken'].filter(Boolean).join(', ');
  return { from, to, tempAvg, tempMin: temps.length ? Math.min(...temps) : null, tempMax: temps.length ? Math.max(...temps) : null, wetHours, hours: hs.length, precipSum, snow, storm, label };
}

const clamp = (n: number) => Math.max(5, Math.min(95, n));
const gauge = (base: number, reasons: Reason[]): Gauge => {
  const score = clamp(base + reasons.reduce((s, r) => s + r.points, 0));
  return { score, level: score < 40 ? 'niedrig' : score < 65 ? 'mittel' : 'hoch', reasons };
};
const kickoffMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface AssessInput {
  date: string; settings: OutlookSettings; hours: WeatherHour[] | null; matches: Match[]; events: OutlookEvent[];
  reservations: { persons: number; seats: number; count: number };
}
/** Die eigentliche Einschätzung – reine Rechnung, ohne Internet; jeder Punkt wird mit Grund ausgewiesen. */
export function assess(i: AssessInput): Pick<OutlookDto, 'walkIn' | 'leaveEarly' | 'holiday' | 'holidayTomorrow' | 'weekday' | 'hints'> & { lunch: WeatherSummary | null; dinner: WeatherSummary | null } {
  const wd = weekdayOf(i.date);
  const holiday = holidayName(i.date), holidayTomorrow = holidayName(addDays(i.date, 1));
  const s = i.settings;
  const lunch = i.hours ? summarize(i.hours, s.lunchFrom, s.lunchTo) : null;
  const dinner = i.hours ? summarize(i.hours, s.dinnerFrom, s.dinnerTo) : null;
  const service = i.hours ? summarize(i.hours.filter((h) => (h.hour >= s.lunchFrom && h.hour < s.lunchTo) || (h.hour >= s.dinnerFrom && h.hour < s.dinnerTo)), 0, 24) : null;
  const w: Reason[] = [], l: Reason[] = [], hints: string[] = [];

  // --- Walk-ins ---
  if (wd === 5 || wd === 6) w.push({ text: `${WEEKDAYS[wd]}: Wochenende, mehr Leute unterwegs`, points: 10 });
  else if (wd === 0) w.push({ text: 'Sonntag: Ausflügler, vor allem mittags', points: 5 });
  else if (wd === 1) w.push({ text: 'Montag: meist ruhiger Tag', points: -10 });
  else if (wd === 2) w.push({ text: 'Dienstag: eher ruhig', points: -5 });
  if (holiday) w.push({ text: `Feiertag (${holiday}): viele haben frei`, points: 10 });
  const month = Number(i.date.slice(5, 7));
  if (s.winterSeason && (month >= 11 || month <= 3)) w.push({ text: 'Wintersaison: die deftige Küche des Hauses ist gefragt', points: 10 });
  if (service) {
    if (service.storm) w.push({ text: 'Gewitter/Hagel angesagt: viele bleiben zu Hause', points: -10 });
    else if (service.snow && service.wetHours >= 3) w.push({ text: 'Schneefall: viele bleiben zu Hause', points: -10 });
    else if (service.wetHours >= Math.max(1, service.hours * 0.3)) w.push({ text: 'Nass zu den Essenszeiten: Leute kehren eher spontan ein', points: 15 });
    if (service.tempAvg !== null) {
      // Erfahrung des Hauses: ab der eingestellten Temperatur und kälter deutlich mehr Gäste
      if (service.tempAvg <= s.coldC) w.push({ text: `Kalt (um ${Math.round(service.tempAvg)} °C – ab ${s.coldC} °C und kälter kommen erfahrungsgemäß mehr Gäste)`, points: s.coldPoints });
      if (service.tempAvg <= 0) w.push({ text: 'Frost: Lust auf deftiges, warmes Essen', points: 5 });
      else if (service.tempAvg >= 20 && service.wetHours === 0) w.push({ text: `Warm und trocken (um ${Math.round(service.tempAvg)} °C): Leute sind eher draußen unterwegs`, points: -10 });
    }
  }
  // Spiele mit Anpfiff während der Öffnungszeit (mittags oder abends)
  const open = (k: number) => (k >= s.lunchFrom * 60 && k < s.lunchTo * 60) || (k >= s.dinnerFrom * 60 - 30 && k < s.dinnerTo * 60);
  const evening = i.matches.filter((m) => open(kickoffMin(m.time)));
  if (evening.length) w.push({ text: 'Fußball während der Öffnungszeit: manche schauen lieber zu Hause', points: -5 });
  for (const e of i.events) {
    if (e.effect === 'more') w.push({ text: `${e.title}${e.time ? ` (${e.time} Uhr)` : ''}`, points: 15 });
    if (e.effect === 'fewer') w.push({ text: `${e.title}${e.time ? ` (${e.time} Uhr)` : ''}`, points: -10 });
  }

  // --- Früher gehen ---
  if (holidayTomorrow) l.push({ text: `Morgen ist Feiertag (${holidayTomorrow}): man bleibt eher länger`, points: -10 });
  else if (wd <= 4) l.push({ text: wd === 0 ? 'Sonntag: morgen ist Werktag' : 'Werktag: morgen müssen viele früh raus', points: 10 });
  if (wd === 5 || wd === 6) l.push({ text: 'Wochenende: man bleibt eher länger', points: -10 });
  if (evening.length) {
    const first = [...evening].sort((a, b) => a.time.localeCompare(b.time))[0]!;
    l.push({ text: `Fußball: ${first.title} um ${first.time} Uhr${evening.length > 1 ? ` (und ${evening.length - 1} weitere${evening.length > 2 ? '' : 's'} Spiel${evening.length > 2 ? 'e' : ''})` : ''} – erfahrungsgemäß sind die Gäste dann schnell weg`, points: s.footballLeavePoints });
    const fav = evening.find((m) => m.favorite);
    if (fav) l.push({ text: `Spiel von ${s.favoriteTeam}: ${fav.title} um ${fav.time} Uhr`, points: 15 });
  }
  for (const e of i.events) if (e.effect === 'leave') l.push({ text: `${e.title}${e.time ? ` (${e.time} Uhr)` : ''}`, points: 20 });
  if (lunch && dinner && lunch.wetHours === 0 && dinner.wetHours >= 2) l.push({ text: 'Am Abend zieht Regen/Schnee auf: manche wollen vorher heim', points: 5 });

  // --- Hinweise ---
  const r = i.reservations;
  if (r.seats > 0 && r.persons >= r.seats * 0.8) hints.push(`Schon ${r.persons} von ${r.seats} Plätzen reserviert – für Gäste ohne Reservierung bleibt wenig Platz.`);
  if (wd === 0 || wd === 4) hints.push('Hinweis: Schulferien und regionale Feiertage sind nicht berücksichtigt.');

  return { walkIn: gauge(50, w), leaveEarly: gauge(30, l), holiday, holidayTomorrow, weekday: WEEKDAYS[wd]!, hints, lunch, dinner };
}

// ---------- Antworten der Internet-Dienste lesen (fehlertolerant) ----------
/** Bright Sky (Daten des Deutschen Wetterdienstes): weather[] mit timestamp (Ortszeit bei tz=Europe/Berlin), temperature, precipitation, precipitation_probability, condition */
export function parseBrightSky(json: unknown, date: string): WeatherHour[] {
  const list = (json as { weather?: unknown })?.weather;
  if (!Array.isArray(list)) throw new Error('Unerwartete Antwort des Wetterdienstes');
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const out = new Map<number, WeatherHour>();
  for (const x of list as Record<string, unknown>[]) {
    const ts = typeof x.timestamp === 'string' ? x.timestamp : '';
    if (ts.slice(0, 10) !== date) continue;
    const hour = Number(ts.slice(11, 13));
    if (!Number.isInteger(hour)) continue;
    out.set(hour, { hour, temp: num(x.temperature), precip: num(x.precipitation), prob: num(x.precipitation_probability), condition: typeof x.condition === 'string' ? x.condition : null });
  }
  return [...out.values()].sort((a, b) => a.hour - b.hour);
}
/** OpenLigaDB getmatchdata: matchDateTime (Ortszeit, „2026-11-21T18:30:00“), team1/team2.teamName, leagueName */
export function parseOpenLiga(json: unknown, date: string, favorite: string): Match[] {
  if (!Array.isArray(json)) throw new Error('Unerwartete Antwort von OpenLigaDB');
  const fav = favorite.trim().toLowerCase();
  return (json as Record<string, unknown>[]).flatMap((m) => {
    const dt = typeof m.matchDateTime === 'string' ? m.matchDateTime : '';
    if (dt.slice(0, 10) !== date || !/^\d{2}:\d{2}/.test(dt.slice(11, 16))) return [];
    const t1 = String((m.team1 as { teamName?: unknown } | undefined)?.teamName ?? '?'), t2 = String((m.team2 as { teamName?: unknown } | undefined)?.teamName ?? '?');
    const title = `${t1} – ${t2}`;
    return [{ time: dt.slice(11, 16), title, league: String(m.leagueName ?? ''), favorite: !!fav && title.toLowerCase().includes(fav) }];
  });
}
