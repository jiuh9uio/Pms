import { asc, eq } from 'drizzle-orm';
import { PLACEHOLDER, type BonPrinter, type QuickPrintDto, type QuickSlipDto, type ReviewSlip, type SlipSuggestionDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { printTemplates, settings } from '../db/schema.js';
import { AppError, conflict, notFound, stale } from '../lib/errors.js';
import { buildJob, columns, isPrivateIp, sendToPrinter, wrap, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { getPrinter as getKitchenPrinter } from './breakfast.js';
import { getWifi, wifiQrText } from './network.js';
import { getHotel } from './settings.js';

/**
 * Schnelldruck: kurze Info-Zettel für Gäste auf dem Bondrucker – Öffnungszeiten und Kontakt, WLAN-Zugang, eigene Vorlagen, freier Text.
 * Gedruckt wird auf dem „Bondrucker vorne“; ist keiner eingerichtet, auf dem Küchendrucker.
 */

const FRONT_DEFAULT: BonPrinter = { enabled: false, host: '', port: 9100, width: 48 };
export async function getFrontPrinter(db: Exec): Promise<BonPrinter> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'front_printer'));
  return { ...FRONT_DEFAULT, ...((row?.value as Partial<BonPrinter>) ?? {}) };
}
export async function saveFrontPrinter(db: Db, actor: Actor, v: BonPrinter) {
  if (v.host && !isPrivateIp(v.host)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { host: 'Bitte die IP-Adresse des Druckers im Hausnetz eintragen, z. B. 192.168.1.51' });
  await db.insert(settings).values({ key: 'front_printer', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'front_printer', after: v });
  return v;
}
async function target(db: Exec): Promise<{ printer: BonPrinter; name: string } | null> {
  const front = await getFrontPrinter(db);
  if (front.enabled && front.host) return { printer: front, name: 'Bondrucker vorne' };
  const kitchen = await getKitchenPrinter(db);
  return kitchen.enabled && kitchen.host ? { printer: kitchen, name: 'Küchendrucker' } : null;
}
async function send(db: Exec, make: (width: number) => Line[], copies = 1) {
  const t = await target(db);
  if (!t) throw conflict('Es ist noch kein Bondrucker eingerichtet (Verwaltung → Einstellungen → Bondrucker vorne)', 'printer_not_configured');
  const job = buildJob(make(t.printer.width), t.printer.width);
  try { for (let i = 0; i < copies; i++) await sendToPrinter(t.printer.host, t.printer.port, job); }
  catch (e) { throw new AppError(502, 'printer_failed', e instanceof Error ? e.message : 'Druckfehler'); }
}
export const testFrontPrinter = async (db: Exec) => {
  const p = await getFrontPrinter(db);
  if (!p.enabled || !p.host) throw conflict('Bitte zuerst IP-Adresse eintragen und „Bondrucker verwenden“ ankreuzen', 'printer_not_configured');
  const h = await getHotel(db);
  try { await sendToPrinter(p.host, p.port, buildJob([{ text: h.name, align: 'center', bold: true }, { text: 'Testdruck Bondrucker vorne', align: 'center' }, { rule: true }, { text: 'Umlaute: ä ö ü Ä Ö Ü ß  Euro: €' }], p.width)); }
  catch (e) { throw new AppError(502, 'printer_failed', e instanceof Error ? e.message : 'Druckfehler'); }
};

// ---------- Bewertungs-Zettel (zum Anheften an die Rechnung) ----------
const REVIEW_DEFAULT: ReviewSlip = {
  url: '', headline: 'Hat es Ihnen gefallen?',
  text: 'Dann freuen wir uns sehr über Ihre Bewertung bei Google. Sie hilft uns und anderen Gästen.',
  thanks: 'Vielen Dank für Ihren Besuch!',
};
export async function getReview(db: Exec): Promise<ReviewSlip> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'review_slip'));
  const v = { ...REVIEW_DEFAULT, ...((row?.value as Partial<ReviewSlip>) ?? {}) };
  // leere Texte fallen auf die Vorgabe zurück
  return { url: v.url, headline: v.headline || REVIEW_DEFAULT.headline, text: v.text || REVIEW_DEFAULT.text, thanks: v.thanks || REVIEW_DEFAULT.thanks };
}
export async function saveReview(db: Db, actor: Actor, v: ReviewSlip) {
  await db.insert(settings).values({ key: 'review_slip', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'review_slip', after: v });
  return getReview(db);
}

// ---------- Zettel ----------
type Slip = { review?: ReviewSlip; blocked?: string; id: string; title: string; custom: boolean; hint?: string; lines: (width: number) => Line[]; body?: string; sort?: number; version?: number };
const center = (text: string, width: number, o: { bold?: boolean; big?: boolean } = {}): Line[] =>
  wrap(text, o.big ? Math.floor(width / 2) : width).map((t) => ({ text: t, align: 'center' as const, ...o }));

async function slips(db: Exec): Promise<Slip[]> {
  const [h, wifi, review, own] = [await getHotel(db), await getWifi(db), await getReview(db), await db.select().from(printTemplates).orderBy(asc(printTemplates.sort), asc(printTemplates.title))];
  const address = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const head = (w: number): Line[] => [...center(h.name, w, { bold: true, big: true }), ...(address ? center(address, w) : []), { rule: true }];
  const contact = (w: number): Line[] => [h.phone && `Telefon: ${h.phone}`, h.email && `E-Mail: ${h.email}`, h.website].filter(Boolean).flatMap((t) => center(t as string, w));
  const out: Slip[] = [{
    id: 'info', title: 'Öffnungszeiten und Kontakt', custom: false,
    hint: h.openingHours ? undefined : 'Öffnungszeiten sind noch nicht eingetragen (Verwaltung → Einstellungen → Hotel).',
    lines: (w) => [...head(w), ...(h.openingHours ? [{ text: 'Öffnungszeiten', align: 'center' as const, bold: true }, ...center(h.openingHours, w), { rule: true as const }] : []), ...contact(w),
      { feed: 1 }, ...center('Wir freuen uns auf Ihren Besuch!', w)],
  }];
  if (wifi.ssid && (wifi.open || wifi.password)) out.push({
    id: 'wifi', title: 'WLAN-Zugang', custom: false,
    lines: (w) => [...head(w), { text: 'WLAN für unsere Gäste', align: 'center', bold: true }, { feed: 1 }, { qr: wifiQrText(wifi) },
      ...center(`Netz: ${wifi.ssid}`, w, { bold: true }), ...center(wifi.open ? 'ohne Passwort' : `Passwort: ${wifi.password}`, w, { bold: true }), ...(wifi.note ? center(wifi.note, w) : [])],
  });
  out.push({
    id: 'stay', title: 'Ihr Aufenthalt', custom: false,
    hint: h.breakfastTimes ? 'Für Hotelgäste bei der Anreise.' : 'Frühstückszeiten sind noch nicht eingetragen (Verwaltung → Einstellungen → Hotel).',
    lines: (w) => [...head(w), ...center('Herzlich willkommen!', w, { bold: true, big: true }), { feed: 1 },
      { text: columns('Anreise (Check-in)', `ab ${h.checkinTime} Uhr`, w) }, { text: columns('Abreise (Check-out)', `bis ${h.checkoutTime} Uhr`, w) },
      ...(h.breakfastTimes ? [{ feed: 1 } as Line, { text: 'Frühstück', bold: true } as Line, ...wrap(h.breakfastTimes, w).map((text) => ({ text }))] : []),
      ...(h.openingHours ? [{ feed: 1 } as Line, { text: 'Restaurant', bold: true } as Line, ...wrap(h.openingHours, w).map((text) => ({ text }))] : []),
      ...(wifi.ssid && (wifi.open || wifi.password) ? [{ feed: 1 } as Line, { text: 'WLAN', bold: true } as Line, { text: columns('Netz', wifi.ssid, w) }, { text: columns('Passwort', wifi.open ? 'ohne' : wifi.password, w) }] : []),
      { rule: true }, ...(h.phone ? center(`Fragen? Wir sind für Sie da: ${h.phone}`, w) : []), ...center('Wir wünschen einen angenehmen Aufenthalt!', w, { bold: true })],
  });
  const site = /^https?:\/\//.test(h.website) ? h.website : h.website ? `https://${h.website}` : '';
  if (site) out.push({
    id: 'web', title: 'Unsere Website', custom: false, hint: 'QR-Code zur Website aus den Hotel-Einstellungen.',
    lines: (w) => [...head(w), ...center('Besuchen Sie uns online', w, { bold: true }), { feed: 1 }, { qr: site, size: 7 }, ...center(h.website, w), { feed: 1 }, ...contact(w).slice(0, 2)],
  });
  out.push({
    id: 'review', title: 'Bitte um Google-Bewertung', custom: false, review,
    hint: review.url ? 'Zum Anheften an die Rechnung.' : 'Der Link zu Ihrer Google-Bewertungsseite fehlt noch.',
    blocked: review.url ? undefined : 'Bitte zuerst den Link zur Google-Bewertung eintragen (Schnelldruck → „Bitte um Google-Bewertung“ → ändern)',
    lines: (w) => [
      { rule: true, char: '=' }, { feed: 1 },
      { text: '* * * * *', align: 'center', bold: true, big: true }, { feed: 1 },
      ...center(review.headline, w, { bold: true, big: true }), { feed: 1 },
      ...center(review.text, w - 4), { feed: 1 },
      ...(review.url ? [{ qr: review.url, size: 7 } as Line] : center('[hier erscheint der QR-Code]', w)),
      ...center('Einfach mit der Handy-Kamera scannen', w), { feed: 1 },
      { rule: true }, ...center(review.thanks, w, { bold: true }), ...center(h.name, w),
      { rule: true, char: '=' },
    ],
  });
  for (const t of own) out.push({
    id: t.id, title: t.title, custom: true, body: t.body, sort: t.sort, version: t.version,
    hint: t.body.includes(PLACEHOLDER) ? 'Enthält noch Platzhalter – bitte über „ändern“ ausfüllen.' : undefined,
    blocked: t.body.includes(PLACEHOLDER) ? `Der Zettel „${t.title}“ enthält noch Platzhalter „${PLACEHOLDER}“ – bitte zuerst ausfüllen` : undefined,
    lines: (w) => [...head(w), ...center(t.title, w, { bold: true }), { feed: 1 }, ...wrap(t.body, w).map((text) => ({ text })), { rule: true }, ...contact(w)],
  });
  return out;
}
const preview = (lines: Line[], width: number) => lines.map((l) =>
  'rule' in l ? (l.char ?? '-').repeat(width) : 'feed' in l ? '' : 'qr' in l ? '[QR-Code]'.padStart(Math.floor((width + 9) / 2)) :
  l.align === 'center' ? ' '.repeat(Math.max(0, Math.floor((width - l.text.length * (l.big ? 2 : 1)) / 2 / (l.big ? 2 : 1)))) + l.text : l.text).join('\n');

export async function overview(db: Exec): Promise<QuickPrintDto> {
  const t = await target(db);
  const width = t?.printer.width ?? 48;
  const list: QuickSlipDto[] = (await slips(db)).map((s) => ({ id: s.id, title: s.title, custom: s.custom, hint: s.hint, review: s.review, body: s.body, sort: s.sort, version: s.version, preview: preview(s.lines(width), width) }));
  return { printerReady: !!t, printerName: t?.name ?? '', slips: list };
}

export async function printSlip(db: Db, actor: Actor, id: string, copies: number) {
  const slip = (await slips(db)).find((s) => s.id === id);
  if (!slip) throw notFound('Zettel');
  if (slip.blocked) throw conflict(slip.blocked, 'slip_incomplete');
  await send(db, slip.lines, copies);
  await record(db, actor, { action: 'print', entity: 'quickprint', entityId: slip.id, after: { title: slip.title, copies } });
  return { ok: true };
}
export async function printText(db: Db, actor: Actor, v: { title: string; text: string; copies: number }) {
  const h = await getHotel(db);
  await send(db, (w) => [...center(h.name, w, { bold: true }), { rule: true }, ...(v.title ? [...center(v.title, w, { bold: true }), { feed: 1 } as Line] : []), ...wrap(v.text, w).map((text) => ({ text }))], v.copies);
  await record(db, actor, { action: 'print', entity: 'quickprint', entityId: 'text', after: { title: v.title || 'Freier Text', copies: v.copies } });
  return { ok: true };
}

// ---------- eigene Vorlagen (Administrator) ----------
export async function saveTemplate(db: Db, actor: Actor, id: string | null, v: { title: string; body: string; sort: number }, version?: number) {
  return db.transaction(async (tx) => {
    if (!id) {
      const [row] = await tx.insert(printTemplates).values(v).returning();
      await record(tx, actor, { action: 'create', entity: 'print_template', entityId: row!.id, after: v });
      return { id: row!.id };
    }
    const [before] = await tx.select().from(printTemplates).where(eq(printTemplates.id, id)).for('update');
    if (!before) throw notFound('Vorlage');
    if (before.version !== version) throw stale();
    await tx.update(printTemplates).set({ ...v, version: before.version + 1, updatedAt: new Date() }).where(eq(printTemplates.id, id));
    await record(tx, actor, { action: 'update', entity: 'print_template', entityId: id, before: { title: before.title, body: before.body }, after: v });
    return { id };
  });
}
export async function removeTemplate(db: Db, actor: Actor, id: string) {
  const [row] = await db.delete(printTemplates).where(eq(printTemplates.id, id)).returning();
  if (!row) throw notFound('Vorlage');
  await record(db, actor, { action: 'remove', entity: 'print_template', entityId: id, before: { title: row.title, body: row.body } });
}

// ---------- Vorschläge für eigene Zettel ----------
const P = PLACEHOLDER;
/** Vorlagen zum Übernehmen. Bundesweit einheitliche Rufnummern sind eingetragen, alles Örtliche trägt der Betrieb selbst ein. */
const SUGGESTIONS: SlipSuggestionDto[] = [
  { key: 'notfall', title: 'Wichtige Rufnummern', body: `Notruf Feuerwehr / Rettungsdienst: 112\nPolizei: 110\nÄrztlicher Bereitschaftsdienst: 116 117\n\nNächste Apotheke: ${P}\nNächstes Krankenhaus: ${P}\nZahnärztlicher Notdienst: ${P}` },
  { key: 'taxi', title: 'Taxi', body: `Taxi: ${P}\n\nGern rufen wir Ihnen ein Taxi – sprechen Sie uns einfach an.` },
  { key: 'parken', title: 'Parken', body: `Parkplätze für unsere Gäste: ${P}\n\nBitte keine Wertsachen im Fahrzeug lassen.` },
  { key: 'bahn', title: 'Bus und Bahn', body: `Nächste Haltestelle: ${P}\nNächster Bahnhof: ${P}\n\nAktuelle Abfahrtszeiten: bahn.de oder in der App „DB Navigator“.` },
  { key: 'ausflug', title: 'Ausflugstipps', body: `Unsere Empfehlungen in der Umgebung:\n\n1. ${P}\n2. ${P}\n3. ${P}\n\nWeitere Tipps geben wir Ihnen gern persönlich.` },
  { key: 'feiern', title: 'Feiern bei uns', body: `Sie planen eine Familienfeier, ein Jubiläum oder ein Firmenessen?\n\nWir richten Ihre Feier gern aus – sprechen Sie uns an oder rufen Sie uns an. Wir beraten Sie persönlich und machen Ihnen ein Angebot.` },
  { key: 'gutschein', title: 'Gutscheine', body: `Verschenken Sie Genuss: Gutscheine für Restaurant und Übernachtung erhalten Sie direkt bei uns – in jeder gewünschten Höhe.` },
  { key: 'hausordnung', title: 'Gut zu wissen', body: `Nachtruhe: ${P}\nRauchen: nur im Freien, die Zimmer sind Nichtraucherzimmer.\nHaustiere: ${P}\nZimmerschlüssel: bei Abreise bitte an der Rezeption abgeben.` },
  { key: 'allergene', title: 'Allergene und Zusatzstoffe', body: `Informationen zu Allergenen und Zusatzstoffen in unseren Speisen und Getränken erhalten Sie von unserem Servicepersonal – bitte sprechen Sie uns an.` },
];

export async function suggestions(db: Exec): Promise<SlipSuggestionDto[]> {
  const have = new Set((await db.select({ title: printTemplates.title }).from(printTemplates)).map((t) => t.title));
  return SUGGESTIONS.filter((s) => !have.has(s.title));
}
export async function addSuggestions(db: Db, actor: Actor, keys: string[]) {
  const open = (await suggestions(db)).filter((s) => keys.includes(s.key));
  let sort = (await db.select().from(printTemplates)).length;
  for (const s of open) await saveTemplate(db, actor, null, { title: s.title, body: s.body, sort: ++sort });
  return { added: open.length };
}
