import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import type { Db, Exec } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getSecretKey, setSecretKey } from './mail.js';
import { getBackupStatus, runBackup } from '../backup.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '../lib/password.js';
import { getGoLive } from './purge.js';

/**
 * Umzug auf einen anderen Rechner oder Server: alle Daten der Datenbank plus der Schlüssel der Installation (E-Mail-Passwort,
 * Zwei-Faktor-Geheimnisse, Gäste-Links) in EINER Datei, verschlüsselt mit einem Passwort, das der Administrator wählt.
 * Die Daten werden tabellenweise als JSON übertragen – unabhängig von der PostgreSQL-Version auf dem Zielrechner.
 * Beim Einspielen wird alles im Ziel ersetzt (in einer Transaktion: scheitert etwas, bleibt das Ziel unverändert).
 */
const MAGIC = Buffer.from('PMSUMZUG1');
const N = 1 << 15;
const deriveKey = (password: string, salt: Buffer) => scryptSync(password, salt, 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

interface Payload { format: 'pms-umzug'; version: string; createdAt: string; migrations: number; secretKey: string; tables: Record<string, unknown[]> }

async function tables(db: Exec): Promise<string[]> {
  const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' order by tablename`) as unknown as { tablename: string }[];
  return rows.map((r) => r.tablename);
}
/** Reihenfolge zum Einfügen: Tabellen, auf die verwiesen wird, zuerst (Fremdschlüssel). */
async function insertOrder(db: Exec, names: string[]): Promise<string[]> {
  const fks = await db.execute(sql`
    select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent from pg_constraint c
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace`) as unknown as { child: string; parent: string }[];
  const strip = (t: string) => t.replace(/^public\./, '').replace(/"/g, '');
  const deps = new Map(names.map((n) => [n, new Set<string>()]));
  for (const f of fks) { const c = strip(f.child), p = strip(f.parent); if (c !== p && deps.has(c) && deps.has(p)) deps.get(c)!.add(p); }
  const out: string[] = [], seen = new Set<string>();
  const visit = (n: string, path: Set<string>) => {
    if (seen.has(n) || path.has(n)) return;
    path.add(n);
    for (const p of deps.get(n) ?? []) visit(p, path);
    path.delete(n); seen.add(n); out.push(n);
  };
  for (const n of names) visit(n, new Set());
  return out;
}
async function migrationCount(db: Exec): Promise<number> {
  try { return Number(((await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`))[0] as { n: number }).n); } catch { return 0; }
}
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Umzugspaket erstellen (nur lesend). */
export async function exportPackage(db: Db, actor: Actor, password: string, version: string): Promise<{ file: Buffer; name: string }> {
  if (password.length < 10) throw new AppError(400, 'validation', 'Eingaben prüfen', { password: 'Bitte ein Passwort mit mindestens 10 Zeichen wählen' });
  const payload: Payload = { format: 'pms-umzug', version, createdAt: new Date().toISOString(), migrations: await migrationCount(db), secretKey: getSecretKey().toString('base64'), tables: {} };
  // in einer Transaktion lesen: ein stimmiger Stand, auch wenn währenddessen jemand arbeitet
  await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction isolation level repeatable read`);
    for (const t of await tables(tx)) {
      const [r] = await tx.execute(sql.raw(`select coalesce(json_agg(x), '[]'::json) as j from ${q(t)} x`)) as unknown as { j: unknown[] }[];
      payload.tables[t] = r!.j;
    }
  });
  const salt = randomBytes(16), iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv);
  const enc = Buffer.concat([c.update(gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))), c.final()]);
  await record(db, actor, { action: 'export', entity: 'program', after: { umzugspaket: true, tabellen: Object.keys(payload.tables).length } });
  const stamp = payload.createdAt.slice(0, 16).replace(/[-:T]/g, '');
  return { file: Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]), name: `Umzug-${stamp}.pmsumzug` };
}

/** Paket entschlüsseln und prüfen (ändert nichts). */
export function readPackage(file: Buffer, password: string): Payload {
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new AppError(400, 'bad_file', 'Das ist kein Umzugspaket des Programms.');
  let o = MAGIC.length;
  const salt = file.subarray(o, o += 16), iv = file.subarray(o, o += 12), tag = file.subarray(o, o += 16);
  try {
    const d = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    d.setAuthTag(tag);
    const p = JSON.parse(gunzipSync(Buffer.concat([d.update(file.subarray(o)), d.final()])).toString('utf8')) as Payload;
    if (p.format !== 'pms-umzug' || typeof p.tables !== 'object') throw new Error('Format');
    return p;
  } catch {
    throw new AppError(400, 'bad_password', 'Das Passwort stimmt nicht oder die Datei ist beschädigt.');
  }
}

/** Was auf DIESER Installation schon steht (würde beim Einspielen ersetzt) */
export async function targetCounts(db: Exec) {
  const [r] = await db.execute(sql`select (select count(*) from bookings)::int as bookings, (select count(*) from invoices)::int as invoices, (select count(*) from guests)::int as guests`) as unknown as { bookings: number; invoices: number; guests: number }[];
  // alle Daten zählen (auch z. B. Temperaturwerte, Tischreservierungen, Angebote) – ohne Einstellungen, Benutzer, Anmeldungen,
  // Protokoll und die Grunddaten, die jede neue Installation von selbst mitbringt (Steuersätze, Muster-Kontrollen, Mustervorlagen)
  const skip = new Set(['settings', 'users', 'sessions', '__drizzle_migrations', 'audit_log', 'tax_rates', 'hygiene_areas', 'inspection_types', 'inspection_items', 'offer_templates']);
  const names = (await tables(db)).filter((t) => !skip.has(t));
  let other = 0;
  if (names.length) {
    const [c] = await db.execute(sql.raw(`select (${names.map((t) => `(select count(*) from ${q(t)})`).join(' + ')})::int as n`)) as unknown as { n: number }[];
    other = c?.n ?? 0;
  }
  return { ...r!, total: other };
}

export interface ImportSummary { version: string; createdAt: string; tables: number; rows: number; guests: number; bookings: number; invoices: number; users: number }
const count = (p: Payload, t: string) => (Array.isArray(p.tables[t]) ? p.tables[t]!.length : 0);
export const summarize = (p: Payload): ImportSummary => ({
  version: p.version, createdAt: p.createdAt, tables: Object.keys(p.tables).length, rows: Object.values(p.tables).reduce((s, r) => s + (Array.isArray(r) ? r.length : 0), 0),
  guests: count(p, 'guests'), bookings: count(p, 'bookings'), invoices: count(p, 'invoices'), users: count(p, 'users'),
});

/**
 * Umzugspaket einspielen: ersetzt ALLE Daten dieser Installation durch die aus dem Paket und übernimmt den Schlüssel.
 * Voraussetzung: dieses Programm ist mindestens so neu wie das, mit dem das Paket erstellt wurde.
 */
export async function importPackage(db: Db, actor: Actor, file: Buffer, password: string, o: { adminPassword: string; overwrite: boolean }): Promise<ImportSummary> {
  // Wer einspielt, bestätigt mit dem eigenen Passwort
  const [me] = await db.select().from(users).where(eq(users.id, actor.userId!));
  if (!me || !(await verifyPassword(o.adminPassword, me.passwordHash))) throw new AppError(400, 'validation', 'Eingaben prüfen', { adminPassword: 'Ihr Passwort (Anmeldung auf diesem Rechner) stimmt nicht' });
  const p = readPackage(file, password);
  // Stehen hier schon Buchungen oder Rechnungen, nur nach ausdrücklicher Bestätigung ersetzen
  const t = await targetCounts(db);
  // Nach dem Start des Echtbetriebs dürfen Rechnungen, Zahlungen und TSE-Daten nicht durch ein Paket ersetzt werden
  if (t.invoices > 0 && (await getGoLive(db)).active)
    throw new AppError(409, 'go_live', 'Auf diesem Rechner läuft der Echtbetrieb und es gibt bereits Rechnungen. Ein Umzugspaket kann hier nicht mehr eingespielt werden, weil dabei Rechnungen, Zahlungen und TSE-Daten ersetzt würden. Für einen Umzug das Paket auf einem neuen, leeren Rechner einspielen.');
  if (t.total > 0 && !o.overwrite)
    throw new AppError(409, 'target_not_empty', `Auf diesem Rechner stehen schon Daten (${t.bookings} Buchungen, ${t.invoices} Rechnungen, insgesamt ${t.total} Einträge). Sie würden durch das Paket ersetzt. Bitte ausdrücklich bestätigen.`);
  // vorher sichern (nur Windows-Version mit eingebauter Sicherung)
  if (getBackupStatus().supported) runBackup();
  const mine = await migrationCount(db);
  if (p.migrations > mine) throw new AppError(409, 'too_old', `Das Paket stammt von einer neueren Programmversion (${p.version}). Bitte dieses Programm zuerst aktualisieren.`);
  const names = await tables(db);
  const order = await insertOrder(db, names);
  await db.transaction(async (tx) => {
    // Schutz vor Ändern/Löschen (Protokoll, Rechnungen, Zahlungen) nur in dieser Transaktion aussetzen
    for (const t of names) await tx.execute(sql.raw(`alter table ${q(t)} disable trigger user`));
    await tx.execute(sql.raw(`truncate table ${names.map(q).join(', ')} restart identity cascade`));
    for (const t of order) {
      const rows = p.tables[t];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const cols = (await tx.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${t}`) as unknown as { column_name: string }[]).map((c) => c.column_name);
      const present = cols.filter((c) => Object.prototype.hasOwnProperty.call(rows[0], c));
      const list = present.map(q).join(', ');
      // in Häppchen, damit auch große Tabellen (Bilder, Video) nicht als ein riesiger Block übertragen werden
      let chunk: unknown[] = [], size = 0;
      const flush = async () => {
        if (!chunk.length) return;
        await tx.execute(sql`${sql.raw(`insert into ${q(t)} (${list}) select ${list} from json_populate_recordset(null::${q(t)}, `)}${JSON.stringify(chunk)}${sql.raw('::json)')}`);
        chunk = []; size = 0;
      };
      for (const r of rows) {
        chunk.push(r); size += JSON.stringify(r).length;
        if (chunk.length >= 500 || size > 20_000_000) await flush();
      }
      await flush();
    }
    // Zähler fortlaufender Nummern (z. B. Protokoll) hinter den höchsten Wert setzen
    const seqs = await tx.execute(sql`
      select s.relname as seq, t.relname as tbl, a.attname as col from pg_class s
      join pg_depend d on d.objid = s.oid and d.deptype = 'a' join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      where s.relkind = 'S' and s.relnamespace = 'public'::regnamespace and t.relnamespace = 'public'::regnamespace`) as unknown as { seq: string; tbl: string; col: string }[];
    for (const s of seqs) await tx.execute(sql.raw(`select setval('public.${q(s.seq).replace(/'/g, "''")}', coalesce((select max(${q(s.col)}) from ${q(s.tbl)}), 1), (select count(*) > 0 from ${q(s.tbl)}))`));
    for (const t of names) await tx.execute(sql.raw(`alter table ${q(t)} enable trigger user`));
    await record(tx, actor, { action: 'import', entity: 'program', after: { umzugspaket: true, vonVersion: p.version, erstellt: p.createdAt } });
  });
  // Schlüssel erst nach geglückter Übernahme der Daten ersetzen
  setSecretKey(Buffer.from(p.secretKey, 'base64'));
  return summarize(p);
}
