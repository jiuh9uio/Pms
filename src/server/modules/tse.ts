import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { TseInfoDto, TseSettings } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { tseSession, TseError, type TseReply } from '../lib/epsontse.js';
import { isPrivateIp, type Line } from '../lib/escpos.js';
import { record, type Actor } from './audit.js';
import { printLines } from './quickprint.js';
import { getHotel } from './settings.js';

/**
 * TSE (Epson): Daten des Sticks anzeigen, Selbsttest ausführen, Datenblatt drucken, Zertifikat herunterladen.
 * Es werden ausschließlich Befehle ohne Anmeldung verwendet. Das PMS zeichnet KEINE Vorgänge in der TSE auf –
 * diese Seite dient dazu, den Stick zu prüfen.
 */
const DEFAULT: TseSettings = { enabled: false, host: '127.0.0.1', port: 8009 };
export async function getTse(db: Exec): Promise<TseSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'tse'));
  return { ...DEFAULT, ...((row?.value as Partial<TseSettings>) ?? {}) };
}
export async function saveTse(db: Db, actor: Actor, v: TseSettings) {
  if (!isPrivateIp(v.host)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { host: 'Adresse des Rechners mit der TSE im Hausnetz, für diesen Rechner 127.0.0.1' });
  await db.insert(settings).values({ key: 'tse', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'tse', after: v });
  return v;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
const hex = (b64: string) => { try { return Buffer.from(b64, 'base64').toString('hex'); } catch { return ''; } };

function fail(r: TseReply | undefined, what: string): never {
  const detail = r ? [r.result, r.error?.fact, r.error?.errorinfo].filter(Boolean).join(' – ') : 'keine Antwort';
  throw new AppError(502, 'tse_failed', `${what}: ${detail}`);
}

function toInfo(info: TseReply, cert: TseReply | undefined): TseInfoDto {
  const t = (info.output.tseInformation ?? {}) as Record<string, unknown>;
  const smart = (info.output.smartInformation ?? {}) as Record<string, unknown>;
  const pem = cert?.result === 'EXECUTION_OK' ? Buffer.from(str(cert.output.logMessageCertificate), 'base64').toString('utf8') : '';
  const first = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)?.[1]?.replace(/\s+/g, '') ?? '';
  return {
    readAt: new Date().toISOString(), vendorType: str(info.output.vendorType),
    serialNumberHex: hex(str(t.serialNumber)), serialNumberBase64: str(t.serialNumber), publicKeyBase64: str(t.tsePublicKey),
    signatureAlgorithm: str(t.signatureAlgorithm), description: str(t.tseDescription), cdcId: str(t.cdcId),
    initializationState: str(t.tseInitializationState), hasValidTime: bool(t.hasValidTime), hasPassedSelfTest: bool(t.hasPassedSelfTest), unlocked: bool(t.isTSEUnlocked),
    timeUntilNextSelfTest: num(t.timeUntilNextSelfTest), certificateExpirationDate: str(t.certificateExpirationDate), lastExportExecutedDate: str(t.lastExportExecutedDate),
    createdSignatures: num(t.createdSignatures), remainingSignatures: num(t.remainingSignatures), maxSignatures: num(t.maxSignatures),
    registeredClients: num(t.registeredClients), maxRegisteredClients: num(t.maxRegisteredClients), startedTransactions: num(t.startedTransactions),
    capacityBlocks: num(t.tseCapacity), usedBlocks: num(t.tseCurrentSize), softwareVersion: num(t.softwareVersion), hardwareVersion: num(t.hardwareVersion),
    healthStatus: str(smart.healthStatus ?? (smart.tseHealth as unknown)), certificatePem: pem,
    certificateFingerprint: first ? createHash('sha256').update(Buffer.from(first, 'base64')).digest('hex') : '',
    certificateNote: cert && cert.result !== 'EXECUTION_OK' ? `Zertifikat nicht lesbar (${cert.result})` : '',
  };
}

async function run(db: Exec, selfTest: boolean): Promise<TseInfoDto> {
  const t = await getTse(db);
  if (!t.enabled) throw conflict('Die TSE ist noch nicht eingerichtet (Einstellungen → TSE)', 'tse_not_configured');
  let replies: TseReply[];
  try {
    replies = await tseSession(t.host, t.port, [
      { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' },
      // der Selbsttest kann bis zu 60 Sekunden dauern
      (prev) => (selfTest && prev[0]?.result === 'EXECUTION_OK' ? { fn: 'RunTSESelfTest', vendor: str(prev[0].output.vendorType), timeoutMs: 120000 } : null),
      (prev) => (selfTest && prev[0]?.result === 'EXECUTION_OK' ? { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' } : null),
      (prev) => (prev[0]?.result === 'EXECUTION_OK' ? { fn: 'GetLogMessageCertificate', vendor: str(prev[0].output.vendorType) } : null),
    ]);
  } catch (e) {
    throw new AppError(502, 'tse_failed', e instanceof TseError ? e.message : `TSE nicht erreichbar: ${e instanceof Error ? e.message : e}`);
  }
  const first = replies[0];
  if (!first || first.result !== 'EXECUTION_OK') fail(first, 'Die TSE-Daten ließen sich nicht lesen');
  const test = replies.find((r) => r.fn === 'RunTSESelfTest');
  if (selfTest && (!test || test.result !== 'EXECUTION_OK')) fail(test, 'Der Selbsttest ist fehlgeschlagen');
  const info = [...replies].reverse().find((r) => r.fn === 'GetStorageInfo' && r.result === 'EXECUTION_OK') ?? first;
  return toInfo(info, replies.find((r) => r.fn === 'GetLogMessageCertificate'));
}

export const tseInfo = (db: Exec) => run(db, false);
export async function tseSelfTest(db: Db, actor: Actor) {
  const info = await run(db, true);
  await record(db, actor, { action: 'tse_selftest', entity: 'program', after: { serial: info.serialNumberHex.slice(0, 16), passed: info.hasPassedSelfTest } });
  return info;
}

const de = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso || '–');
const chunks = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g')) ?? [];

/** Datenblatt der TSE auf dem Bondrucker: die Angaben, die z. B. für die Meldung der Kasse gebraucht werden. */
export async function printTseSheet(db: Db, actor: Actor) {
  const [i, h] = [await tseInfo(db), await getHotel(db)];
  await printLines(db, (w) => {
    const row = (k: string, v: string): Line[] => [{ text: k, bold: true }, ...chunks(v || '–', w).map((text) => ({ text }))];
    return [
      { text: h.name, align: 'center', bold: true }, { text: 'TSE-DATENBLATT', align: 'center', bold: true, big: true },
      { text: `gelesen am ${new Date(i.readAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' })}`, align: 'center' }, { rule: true },
      ...row('Modell', i.vendorType), ...row('Seriennummer der TSE (hex)', i.serialNumberHex), ...row('BSI-Zertifizierung', i.description),
      ...row('Signaturverfahren', i.signatureAlgorithm), ...row('Zertifikat gültig bis', de(i.certificateExpirationDate)),
      ...row('Zustand', [i.initializationState, i.hasPassedSelfTest ? 'Selbsttest bestanden' : 'Selbsttest offen', i.hasValidTime ? 'Zeit gesetzt' : 'Zeit nicht gesetzt'].filter(Boolean).join(', ')),
      ...row('Signaturen', `${i.createdSignatures ?? '–'} erzeugt, ${i.remainingSignatures ?? '–'} übrig`),
      ...row('Angemeldete Kassen (Clients)', `${i.registeredClients ?? '–'}`),
      ...row('Öffentlicher Schlüssel (Base64)', i.publicKeyBase64),
      ...(i.certificateFingerprint ? row('Zertifikat SHA-256', i.certificateFingerprint) : []),
      { rule: true }, { text: 'Auszug aus den Daten des Sticks – kein Kassenbeleg und kein Nachweis einer Aufzeichnung.', align: 'center' },
    ];
  });
  await record(db, actor, { action: 'print', entity: 'program', entityId: 'tse', after: { serial: i.serialNumberHex.slice(0, 16) } });
  return { ok: true };
}
