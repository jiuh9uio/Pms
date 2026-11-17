import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { kassenbelegData, splitByParts } from '../../shared/kassenbeleg.js';
import type { TseRecordDto, TseUseDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { settings, tseRecords } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { tseSession, type TseReply } from '../lib/epsontse.js';
import { record, type Actor } from './audit.js';
import { STORNO_IN, STORNO_OUT } from './billing.js';
import { decrypt, encrypt } from './mail.js';
import { getTse } from './tse.js';

/**
 * Zahlungen in der TSE aufzeichnen: Nach dem Buchen einer Zahlung wird ein Vorgang „Kassenbeleg-V1“ begonnen und beendet,
 * das Ergebnis (Transaktionsnummer, Signaturzähler, Zeiten, Signatur) wird zur Zahlung gespeichert.
 * Scheitert die Aufzeichnung, bleibt die Zahlung gebucht und wird als „TSE-Ausfall“ vermerkt – nachsigniert wird nicht.
 * Lehnt die TSE die Anmeldung ab, pausiert das Signieren sofort, damit keine weiteren PIN-Versuche verbraucht werden.
 * Nicht enthalten: Belegdruck mit QR-Code, DSFinV-K-Export, TAR-Export der TSE. Mit einem echten Stick nicht erprobt.
 */
interface Stored { enabled: boolean; clientId: string; methods: 'cash' | 'all'; pinEnc: string; keyEnc: string; since: string | null; pausedReason: string }
const DEFAULT: Stored = { enabled: false, clientId: '', methods: 'cash', pinEnc: '', keyEnc: '', since: null, pausedReason: '' };
const KEY = 'tse_sign';
async function load(db: Exec): Promise<Stored> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return { ...DEFAULT, ...((row?.value as Partial<Stored>) ?? {}) };
}
const store = (db: Exec, v: Stored) => db.insert(settings).values({ key: KEY, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
const dto = (s: Stored): TseUseDto => ({ enabled: s.enabled, clientId: s.clientId, methods: s.methods, pinSet: s.pinEnc !== '', since: s.since, pausedReason: s.pausedReason });

export const getUse = async (db: Exec) => dto(await load(db));
export async function saveUse(db: Db, actor: Actor, v: { enabled: boolean; clientId: string; pin: string; secretKey: string; methods: 'cash' | 'all' }) {
  const cur = await load(db);
  const next: Stored = {
    enabled: v.enabled, clientId: v.clientId, methods: v.methods, pinEnc: v.pin ? encrypt(v.pin) : cur.pinEnc, keyEnc: v.secretKey ? encrypt(v.secretKey) : cur.keyEnc,
    // neu eingeschaltet oder nach einer Pause wieder aufgenommen: erst Zahlungen ab jetzt aufzeichnen
    since: v.enabled ? (cur.enabled && !cur.pausedReason && cur.since ? cur.since : new Date().toISOString()) : null,
    // Pause wegen abgelehnter PIN bleibt bestehen, bis eine neue PIN eingetragen wird – auch über Aus- und Einschalten hinweg
    // (sonst würde die alte PIN erneut versucht und ein weiterer Versuch verbraucht)
    pausedReason: cur.pausedReason && !v.pin ? cur.pausedReason : '',
  };
  if (next.enabled && !next.pinEnc) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { pin: 'Bitte die Zeit-PIN eintragen' });
  if (next.enabled && !(await getTse(db)).enabled) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { enabled: 'Zuerst oben die Verbindung zur TSE einrichten und „TSE-Daten lesen“' });
  await store(db, next);
  await record(db, actor, { action: 'update', entity: 'settings', entityId: KEY, after: { enabled: next.enabled, clientId: next.clientId, methods: next.methods } });
  return dto(next);
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
type Raw = Record<string, unknown>;
interface Outcome { ok: boolean; authFailed: boolean; error: string; serialHex: string; publicKey: string; algorithm: string; start?: TseReply; finish?: TseReply }

/**
 * Neuer Vorgang (Start + Abschluss) – oder mit openTx nur den Abschluss eines früher gestarteten, nicht abgeschlossenen Vorgangs nachholen.
 */
async function transact(host: string, port: number, clientId: string, pin: string, key: string, processData: string, openTx: number | null = null): Promise<Outcome> {
  const vendor = (p: TseReply[]) => ({ vendor: 'TSE1', altVendors: [str(p[0]?.output.vendorType), 'TSE', ''] });
  const by = (p: TseReply[], fn: string) => p.find((r) => r.fn === fn);
  const fine = (p: TseReply[]) => p.every((r) => r.result === 'EXECUTION_OK');
  const info = (p: TseReply[]) => (p[0]?.output.tseInformation ?? {}) as Raw;
  const out: Outcome = { ok: false, authFailed: false, error: '', serialHex: '', publicKey: '', algorithm: '' };
  let replies: TseReply[];
  try {
    replies = await tseSession(host, port, [
      { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' },
      (p) => (fine(p) && info(p).tseInitializationState === 'INITIALIZED' && info(p).hasPassedSelfTest === false ? { fn: 'RunTSESelfTest', ...vendor(p), timeoutMs: 120000 } : null),
      (p) => (fine(p) && info(p).tseInitializationState === 'INITIALIZED' ? { fn: 'GetChallenge', ...vendor(p), input: { userId: clientId } } : null),
      (p) => {
        const challenge = str(by(p, 'GetChallenge')?.output.challenge);
        if (!fine(p) || !challenge) return null;
        return { fn: 'AuthenticateUserForTimeAdmin', ...vendor(p), input: { clientId, pin, hash: createHash('sha256').update(challenge + key, 'utf8').digest('base64') } };
      },
      (p) => (fine(p) && by(p, 'AuthenticateUserForTimeAdmin') ? { fn: 'UpdateTime', ...vendor(p), input: { userId: clientId, newDateTime: new Date().toISOString().slice(0, 19) + 'Z', useTimeSync: false } } : null),
      (p) => (fine(p) && by(p, 'UpdateTime') && openTx == null ? { fn: 'StartTransaction', ...vendor(p), input: { clientId, processData: '', processType: '', additionalData: '' } } : null),
      (p) => {
        const start = by(p, 'StartTransaction');
        const txNo = openTx ?? start?.output.transactionNumber;
        return fine(p) && by(p, 'UpdateTime') && (start || openTx != null) ? { fn: 'FinishTransaction', ...vendor(p), input: { clientId, transactionNumber: txNo, processData: Buffer.from(processData, 'utf8').toString('base64'), processType: 'Kassenbeleg-V1', additionalData: '' } } : null;
      },
      (p) => (by(p, 'AuthenticateUserForTimeAdmin')?.result === 'EXECUTION_OK' ? { fn: 'LogOutForTimeAdmin', ...vendor(p), input: { clientId } } : null),
    ]);
  } catch (e) { out.error = e instanceof Error ? e.message : 'TSE nicht erreichbar'; return out; }
  const first = replies[0];
  if (!first || first.result !== 'EXECUTION_OK') { out.error = `TSE-Daten nicht lesbar (${first?.result ?? 'keine Antwort'})`; return out; }
  const t = info(replies);
  try { out.serialHex = Buffer.from(str(t.serialNumber), 'base64').toString('hex'); } catch { /* bleibt leer */ }
  out.publicKey = str(t.tsePublicKey); out.algorithm = str(t.signatureAlgorithm);
  if (t.tseInitializationState !== 'INITIALIZED') { out.error = `Die TSE ist nicht in Betrieb (${str(t.tseInitializationState) || 'Zustand unbekannt'})`; return out; }
  out.start = by(replies, 'StartTransaction'); out.finish = by(replies, 'FinishTransaction');
  const bad = replies.find((r) => r.result !== 'EXECUTION_OK' && r.fn !== 'LogOutForTimeAdmin');
  if (bad) {
    out.authFailed = bad.fn === 'AuthenticateUserForTimeAdmin' || bad.fn === 'GetChallenge';
    out.error = `${bad.fn}: ${[bad.result, bad.error?.fact].filter(Boolean).join(' – ')}`;
    return out;
  }
  if ((openTx == null && out.start?.result !== 'EXECUTION_OK') || out.finish?.result !== 'EXECUTION_OK') { out.error = 'Die TSE hat den Vorgang nicht ausgeführt'; return out; }
  out.ok = true;
  return out;
}

let chain: Promise<unknown> = Promise.resolve();
/** Zeichnet alle noch nicht aufgezeichneten Zahlungen seit dem Einschalten auf. Wirft nie – eine Zahlung scheitert nicht an der TSE. */
export function signPending(db: Db): Promise<void> {
  const run = chain.then(() => work(db)).catch((e) => { console.error('TSE-Aufzeichnung:', e); });
  chain = run;
  return run;
}

async function work(db: Db) {
  let s = await load(db);
  if (!s.enabled || !s.since) return;
  await finishOpen(db);
  s = await load(db);
  const rows = Array.from(await db.execute(sql`
    select p.id, p.booking_id, p.invoice_id, p.amount_cents, p.method, p.recorded_by, p.reverses_id, p.created_at from payments p
    where p.created_at >= ${s.since}::timestamptz and not exists (select 1 from tse_records t where t.payment_id = p.id)
      -- interne Umbuchung beim Storno (kein Geldfluss, keine Kasseneinnahme) – nicht als Kassenbeleg signieren
      and not (p.note like ${STORNO_OUT + '%'} or p.note like ${STORNO_IN + '%'})
      ${s.methods === 'cash' ? sql`and p.method = 'Bar'` : sql``} order by p.created_at, p.id`)) as Raw[];
  if (!rows.length) return;
  // eine Zahlung, die beim Buchen auf mehrere Rechnungen verteilt wurde, ist ein Vorgang
  const groups = new Map<string, Raw[]>();
  for (const r of rows) {
    const k = r.reverses_id ? `r:${r.id}` : [new Date(r.created_at as string).toISOString(), r.booking_id, r.method, r.recorded_by].join('|');
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const [def] = await db.execute(sql`select rate_percent from tax_rates where default_for = 'lodging' and active order by created_at limit 1`);
  const lodgingRate = def ? Number((def as Raw).rate_percent) : 7;
  const t = await getTse(db);
  for (const group of groups.values()) {
    const parts: { rate: number; cents: number }[] = [];
    let total = 0;
    for (const p of group) {
      const cents = p.amount_cents as number;
      total += cents;
      const lines = p.invoice_id ? (Array.from(await db.execute(sql`select tax_rate_percent as rate, sum(total_cents)::int as cents from invoice_lines where invoice_id = ${p.invoice_id as string} group by 1`)) as Raw[]).map((l) => ({ rate: Number(l.rate), cents: l.cents as number })) : [];
      const split = splitByParts(cents, lines);
      // Anzahlung ohne Rechnung (oder Rechnung ohne Positionen): Steuersatz der Übernachtung
      parts.push(...(split.length ? split : [{ rate: lodgingRate, cents }]));
    }
    const data = kassenbelegData(parts, total, group[0]!.method === 'Bar');
    const o: Outcome = s.pausedReason
      ? { ok: false, authFailed: false, error: `Aufzeichnung pausiert: ${s.pausedReason}`, serialHex: '', publicKey: '', algorithm: '' }
      : !t.enabled ? { ok: false, authFailed: false, error: 'Die Verbindung zur TSE ist abgeschaltet (Einstellungen → TSE)', serialHex: '', publicKey: '', algorithm: '' }
      : await transact(t.host, t.port, s.clientId, decrypt(s.pinEnc), s.keyEnc ? decrypt(s.keyEnc) : 'EPSONKEY', data);
    if (o.authFailed) {
      s = { ...(await load(db)), pausedReason: `Die TSE hat die Anmeldung abgelehnt (${o.error}). Bitte Kennung und Zeit-PIN prüfen und neu speichern.` };
      await store(db, s);
    }
    await db.insert(tseRecords).values(group.map((p) => ({
      paymentId: p.id as string, status: o.ok ? 'signed' as const : 'failed' as const, clientId: s.clientId, serialHex: o.serialHex,
      transactionNumber: num(o.start?.output.transactionNumber), signatureCounter: num(o.finish?.output.signatureCounter),
      startTime: str(o.start?.output.logTime), finishTime: str(o.finish?.output.logTime), signature: str(o.finish?.output.signature),
      processType: 'Kassenbeleg-V1', processData: data, publicKey: o.publicKey, algorithm: o.algorithm, error: o.error.slice(0, 400),
    }))).onConflictDoNothing();
  }
}

/**
 * Gestartete, aber nicht abgeschlossene TSE-Vorgänge (z. B. Verbindung beim Abschluss abgebrochen) nachträglich abschließen,
 * damit auf der TSE keine offenen Transaktionen liegen bleiben. Höchstens 20 je Lauf; Versuche nur bis 7 Tage nach dem Vorgang.
 */
async function finishOpen(db: Db) {
  const s = await load(db);
  const t = await getTse(db);
  if (s.pausedReason || !t.enabled) return;
  const open = Array.from(await db.execute(sql`
    select transaction_number, min(process_data) as process_data, min(client_id) as client_id from tse_records
    where status = 'failed' and transaction_number is not null and signature = '' and finish_time = '' and created_at > now() - interval '7 days'
    group by transaction_number order by transaction_number limit 20`)) as Raw[];
  for (const r of open) {
    const txNo = r.transaction_number as number;
    const o = await transact(t.host, t.port, (r.client_id as string) || s.clientId, decrypt(s.pinEnc), s.keyEnc ? decrypt(s.keyEnc) : 'EPSONKEY', r.process_data as string, txNo);
    if (!o.ok) {
      if (o.authFailed) return;
      continue;
    }
    await db.execute(sql`update tse_records set status = 'signed', signature_counter = ${num(o.finish?.output.signatureCounter)}, finish_time = ${str(o.finish?.output.logTime)},
      signature = ${str(o.finish?.output.signature)}, serial_hex = case when serial_hex = '' then ${o.serialHex} else serial_hex end,
      public_key = case when public_key = '' then ${o.publicKey} else public_key end, algorithm = case when algorithm = '' then ${o.algorithm} else algorithm end,
      error = ${'nachträglich abgeschlossen'}
      where status = 'failed' and transaction_number = ${txNo} and signature = '' and finish_time = ''`);
  }
}

export async function listRecords(db: Exec): Promise<TseRecordDto[]> {
  const rows = await db.execute(sql`
    select t.id, t.created_at, t.status, p.amount_cents, p.method, i.number as invoice_number, b.number as booking_number,
      t.transaction_number, t.signature_counter, t.start_time, t.finish_time, t.process_data, t.error
    from tse_records t join payments p on p.id = t.payment_id left join invoices i on i.id = p.invoice_id left join bookings b on b.id = p.booking_id
    order by t.created_at desc, t.id limit 100`);
  return Array.from(rows).map((r) => {
    const x = r as Raw;
    return {
      id: x.id as string, createdAt: new Date(x.created_at as string).toISOString(), status: x.status as 'signed' | 'failed', amountCents: x.amount_cents as number, method: x.method as string,
      invoiceNumber: (x.invoice_number as string) ?? null, bookingNumber: (x.booking_number as string) ?? null, transactionNumber: (x.transaction_number as number) ?? null,
      signatureCounter: (x.signature_counter as number) ?? null, startTime: x.start_time as string, finishTime: x.finish_time as string, processData: x.process_data as string, error: x.error as string,
    };
  });
}

