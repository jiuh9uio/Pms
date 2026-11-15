import { sql } from 'drizzle-orm';
import type { Db, Exec } from '../db/client.js';
import { companies, guests } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

/**
 * Import der Kundendatei des alten Programms („Kunden.dat“).
 * Aufbau (aus der Datei ermittelt): feste Datensätze zu 512 Byte, Textfelder als Längenbyte + Text (Zeichensatz Windows-1252/Latin-1).
 *   4 Kundennummer · 21 Name (Person oder Firma) · 62 Zusatz/Ansprechpartner · 103 Straße · 144 PLZ · 151 Ort
 *   192 Telefon · 242 Mobil · 267 E-Mail · 300 Website
 * Nicht übernommen: Bemerkungsfeld (enthält nur einen Mustertext des alten Programms) und zwei Datumsfelder unbekannter Bedeutung.
 * Firmen (Rechtsform/Stichwort im Namen oder „Herr/Frau …“ als Ansprechpartner) werden Firmen, alle anderen Gäste.
 */
const R = 512;
const F = { number: [4, 16], name: [21, 40], extra: [62, 40], street: [103, 40], zip: [144, 6], city: [151, 40], phone: [192, 40], mobile: [242, 24], email: [267, 32], web: [300, 32] } as const;
type Field = keyof typeof F;
const LEGAL = /\b(GmbH|AG|KG|OHG|UG|GbR|e\.\s?V\.|eG|mbH|Co\.|Firma|Hotel|Gasthof|Gasthaus|Pension|Restaurant|Verein|Stadt|Gemeinde|Schule|Kirche|Praxis|Handel|Service|Verwaltung|Amt|Landratsamt|Sparkasse|Bank|Club|Innung|Verband|Kreis|Bedarf|Technik|Bau|Werk|Werke|Zentrum|Institut|Stiftung|Kanzlei|Agentur|Versicherung|Autohaus|Klinik|Krankenhaus|Universität|Hochschule)\b/i;

const clean = (s: string) => s.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
function field(rec: Buffer, f: Field): string {
  const [o, max] = F[f];
  const len = rec[o]!;
  if (len === 0 || len > max) return '';
  return clean(rec.subarray(o + 1, o + 1 + len).toString('latin1'));
}

export interface LegacyGuest { kind: 'guest'; number: string; salutation: '' | 'Herr' | 'Frau'; firstName: string; lastName: string; street: string; zip: string; city: string; country: string; phone: string; email: string; notes: string }
export interface LegacyCompany { kind: 'company'; number: string; name: string; contactName: string; street: string; zip: string; city: string; country: string; phone: string; email: string; notes: string }
export interface LegacyParse { records: number; guests: LegacyGuest[]; companies: LegacyCompany[]; skipped: { placeholder: number; empty: number } }

/** Datei lesen und in Gäste und Firmen aufteilen – ändert nichts. */
export function parseKundenDat(buf: Buffer): LegacyParse {
  if (buf.length < R || buf.length % R !== 0) throw new AppError(400, 'bad_file', 'Das ist keine Kundendatei des alten Programms (unerwartete Dateigröße).');
  const n = buf.length / R;
  let recognized = 0;
  for (let k = 0; k < n; k++) if (/^K-\d+$/.test(field(buf.subarray(k * R, (k + 1) * R), 'number'))) recognized++;
  if (recognized < n * 0.8) throw new AppError(400, 'bad_file', 'Das ist keine Kundendatei des alten Programms (keine Kundennummern gefunden).');
  const out: LegacyParse = { records: n, guests: [], companies: [], skipped: { placeholder: 0, empty: 0 } };
  for (let k = 0; k < n; k++) {
    const rec = buf.subarray(k * R, (k + 1) * R);
    const v = Object.fromEntries((Object.keys(F) as Field[]).map((f) => [f, field(rec, f)])) as Record<Field, string>;
    if (!v.name) { out.skipped.empty++; continue; }
    if (v.name.startsWith('***') || v.name.endsWith('***')) { out.skipped.placeholder++; continue; }
    const zip = v.zip;
    const country = /^\d{5}$/.test(zip) ? 'Deutschland' : '';
    const email = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.email) ? v.email : '';
    const phone = v.phone || v.mobile;
    const notesParts = [`Übernommen aus dem alten Programm (Kundennr. ${v.number})`];
    if (v.phone && v.mobile) notesParts.push(`Mobil: ${v.mobile}`);
    if (v.email && !email) notesParts.push(`E-Mail laut Altdaten: ${v.email}`);
    if (v.web) notesParts.push(`Website: ${v.web}`);
    const contactIsPerson = /^(Herrn?|Frau)\b/.test(v.extra);
    if (LEGAL.test(v.name) || contactIsPerson) {
      out.companies.push({ kind: 'company', number: v.number, name: v.name.slice(0, 160), contactName: v.extra.slice(0, 120), street: v.street, zip, city: v.city, country: country || 'Deutschland', phone, email, notes: notesParts.join('\n') });
      continue;
    }
    let salutation: LegacyGuest['salutation'] = '';
    let rest = v.name;
    const sal = /^(Herrn?|Frau)\s+(.+)$/.exec(rest);
    if (sal) { salutation = sal[1]!.startsWith('Herr') ? 'Herr' : 'Frau'; rest = sal[2]!; }
    let firstName = '', lastName = rest;
    const fam = /^(Familie|Fam\.)\s+(.+)$/i.exec(rest);
    if (fam) { lastName = fam[2]!; notesParts.push('Familie'); }
    else if (rest.includes(',')) { const [l, f] = rest.split(',').map((x) => x.trim()); lastName = l || rest; firstName = f ?? ''; }
    else { const w = rest.split(' '); if (w.length >= 2) { lastName = w.at(-1)!; firstName = w.slice(0, -1).join(' '); } }
    if (v.extra) notesParts.push(`Zusatz: ${v.extra}`);
    out.guests.push({ kind: 'guest', number: v.number, salutation, firstName: firstName.slice(0, 80), lastName: lastName.slice(0, 80), street: v.street, zip, city: v.city, country, phone: phone.slice(0, 60), email, notes: notesParts.join('\n') });
  }
  return out;
}

const key = (...p: string[]) => p.map((x) => x.trim().toLowerCase()).join('|');

export interface LegacyImportResult {
  records: number; guests: number; companies: number; duplicates: number; skipped: { placeholder: number; empty: number }; withoutAddress: number;
  /** Vorschau der ersten Einträge je Art (nur bei der Prüfung) */
  sample: { guests: LegacyGuest[]; companies: LegacyCompany[] }; dryRun: boolean;
}
/**
 * Importieren (oder nur prüfen): schon vorhandene Gäste (gleicher Vor-/Nachname und PLZ) und Firmen (gleicher Name und PLZ) werden übersprungen,
 * damit ein zweiter Lauf nichts doppelt anlegt. Alles in einer Transaktion.
 */
export async function importKundenDat(db: Db, actor: Actor, buf: Buffer, dryRun: boolean): Promise<LegacyImportResult> {
  const p = parseKundenDat(buf);
  const existingGuests = new Set((await db.execute(sql`select first_name, last_name, zip from guests`) as unknown as { first_name: string; last_name: string; zip: string }[]).map((g) => key(g.first_name, g.last_name, g.zip)));
  const existingCompanies = new Set((await db.execute(sql`select name, zip from companies`) as unknown as { name: string; zip: string }[]).map((c) => key(c.name, c.zip)));
  const newGuests = p.guests.filter((g) => { const k = key(g.firstName, g.lastName, g.zip); if (existingGuests.has(k)) return false; existingGuests.add(k); return true; });
  const newCompanies = p.companies.filter((c) => { const k = key(c.name, c.zip); if (existingCompanies.has(k)) return false; existingCompanies.add(k); return true; });
  const result: LegacyImportResult = {
    records: p.records, guests: newGuests.length, companies: newCompanies.length,
    duplicates: p.guests.length - newGuests.length + p.companies.length - newCompanies.length, skipped: p.skipped,
    withoutAddress: [...newGuests, ...newCompanies].filter((x) => !x.street && !x.zip && !x.city).length,
    sample: dryRun ? { guests: newGuests.slice(0, 8), companies: newCompanies.slice(0, 5) } : { guests: [], companies: [] }, dryRun,
  };
  if (dryRun) return result;
  await db.transaction(async (tx: Exec) => {
    for (let i = 0; i < newGuests.length; i += 200) {
      await tx.insert(guests).values(newGuests.slice(i, i + 200).map((g) => ({ salutation: g.salutation, firstName: g.firstName, lastName: g.lastName, street: g.street, zip: g.zip, city: g.city, country: g.country, phone: g.phone, email: g.email, notes: g.notes })));
    }
    for (let i = 0; i < newCompanies.length; i += 200) {
      await tx.insert(companies).values(newCompanies.slice(i, i + 200).map((c) => ({ name: c.name, contactName: c.contactName, street: c.street, zip: c.zip, city: c.city, country: c.country, phone: c.phone, email: c.email, notes: c.notes })));
    }
    // im Protokoll nur die Anzahl – keine Namen
    await record(tx, actor, { action: 'import', entity: 'guests', after: { quelle: 'Kunden.dat', gaeste: result.guests, firmen: result.companies, doppelt: result.duplicates, uebersprungen: p.skipped } });
  });
  return result;
}
