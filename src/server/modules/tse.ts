import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { TseInfoDto, TseSettings, TseSignResult } from '../../shared/schemas.js';
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
 * Lesen, Selbsttest und Zertifikat kommen ohne Anmeldung aus. Einzige Ausnahme ist die Test-Signatur (unten): Sie meldet
 * sich mit der vom Benutzer eingegebenen Zeit-PIN an und zeichnet einen gekennzeichneten Testvorgang auf.
 * Zahlungen des PMS werden NICHT in der TSE aufgezeichnet.
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

/** Epsons Beispiele verwenden als Herstellerkürzel „TSE1“; der Modellname aus GetStorageInfo kann davon abweichen. */
const vendorOf = (info: TseReply | undefined) => ({ vendor: 'TSE1', altVendors: [str(info?.output.vendorType), 'TSE', ''] });

async function run(db: Exec, selfTest: boolean): Promise<TseInfoDto> {
  const t = await getTse(db);
  if (!t.enabled) throw conflict('Die TSE ist noch nicht eingerichtet (Einstellungen → TSE)', 'tse_not_configured');
  let replies: TseReply[];
  try {
    replies = await tseSession(t.host, t.port, [
      { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' },
      // der Selbsttest kann bis zu 60 Sekunden dauern
      (prev) => (selfTest && prev[0]?.result === 'EXECUTION_OK' ? { fn: 'RunTSESelfTest', ...vendorOf(prev[0]), timeoutMs: 120000 } : null),
      (prev) => (selfTest && prev[0]?.result === 'EXECUTION_OK' ? { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' } : null),
      (prev) => (prev[0]?.result === 'EXECUTION_OK' ? { fn: 'GetLogMessageCertificate', ...vendorOf(prev[0]) } : null),
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

// ---------- Test-Signatur ----------
const TEST_TYPE = 'SonstigerVorgang';
const TEST_DATA = 'PMS Testsignatur - kein Umsatz';

/** Meldung zu einem fehlgeschlagenen Schritt der Test-Signatur – mit der Zahl der verbleibenden PIN-Versuche, wenn die TSE sie nennt. */
function signFail(r: TseReply): never {
  const left = num(r.output.remainingRetries);
  const code = r.result;
  const msg = left != null ? `Die PIN wurde nicht angenommen. Noch ${left} ${left === 1 ? 'Versuch' : 'Versuche'}, danach ist die PIN gesperrt und nur mit der PUK wieder freizuschalten.`
    : code === 'OTHER_ERROR_HOST_AUTHENTICATION_FAILED' ? 'Die Anmeldung wurde abgelehnt: Der geheime Schlüssel passt nicht (Standard ist EPSONKEY). Es wurde kein PIN-Versuch verbraucht.'
    : code === 'TSE1_ERROR_CLIENT_NOT_REGISTERED' ? 'Diese Kassen-Kennung ist in der TSE nicht angemeldet. Sie muss zuerst mit der Admin-PIN registriert werden.'
    : code === 'TSE1_ERROR_TSE_NOT_INITIALIZED' ? 'Die TSE ist noch nicht in Betrieb genommen.'
    : code === 'TSE1_ERROR_CERTIFICATE_EXPIRED' ? 'Das Zertifikat der TSE ist abgelaufen – sie signiert nicht mehr.'
    : code === 'TSE1_ERROR_WRONG_STATE_NEEDS_PIN_CHANGE' || code === 'TSE1_ERROR_WRONG_STATE_NEEDS_PUK_CHANGE' ? 'Die TSE verlangt zuerst das Ändern der Auslieferungs-PIN bzw. -PUK (Inbetriebnahme).'
    : `Schritt „${r.fn}“ ist fehlgeschlagen`;
  throw new AppError(502, 'tse_failed', `${msg} (${[code, r.error?.fact].filter(Boolean).join(' – ')})`);
}

/**
 * Test-Signatur: meldet sich mit Kassen-Kennung und Zeit-PIN an, setzt die Uhrzeit, zeichnet einen als Test gekennzeichneten
 * Vorgang („SonstigerVorgang“) auf und meldet sich wieder ab. PIN und Schlüssel werden weder gespeichert noch protokolliert.
 * Der Vorgang bleibt dauerhaft in der TSE stehen.
 */
export async function tseTestSignature(db: Db, actor: Actor, v: { clientId: string; pin: string; secretKey: string; print: boolean }): Promise<TseSignResult> {
  const t = await getTse(db);
  if (!t.enabled) throw conflict('Die TSE ist noch nicht eingerichtet (Einstellungen → TSE)', 'tse_not_configured');
  const okSoFar = (prev: TseReply[]) => prev.every((r) => r.result === 'EXECUTION_OK');
  const by = (prev: TseReply[], fn: string) => prev.find((r) => r.fn === fn);
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  let replies: TseReply[];
  try {
    replies = await tseSession(t.host, t.port, [
      { fn: 'GetStorageInfo', storageType: 'COMMON', vendor: '' },
      (p) => {
        const info = (p[0]?.output.tseInformation ?? {}) as Record<string, unknown>;
        return okSoFar(p) && info.tseInitializationState === 'INITIALIZED' && info.hasPassedSelfTest === false ? { fn: 'RunTSESelfTest', ...vendorOf(p[0]), timeoutMs: 120000 } : null;
      },
      (p) => (okSoFar(p) && (p[0]!.output.tseInformation as Record<string, unknown> | undefined)?.tseInitializationState === 'INITIALIZED'
        ? { fn: 'GetChallenge', ...vendorOf(p[0]), input: { userId: v.clientId } } : null),
      (p) => {
        const challenge = str(by(p, 'GetChallenge')?.output.challenge);
        if (!okSoFar(p) || !challenge) return null;
        // nach Epsons Beispielprogramm: SHA-256 über Challenge + geheimen Schlüssel, Base64
        const hash = createHash('sha256').update(challenge + v.secretKey, 'utf8').digest('base64');
        return { fn: 'AuthenticateUserForTimeAdmin', ...vendorOf(p[0]), input: { clientId: v.clientId, pin: v.pin, hash } };
      },
      (p) => (okSoFar(p) && by(p, 'AuthenticateUserForTimeAdmin')
        ? { fn: 'UpdateTime', ...vendorOf(p[0]), input: { userId: v.clientId, newDateTime: new Date().toISOString().slice(0, 19) + 'Z', useTimeSync: false } } : null),
      (p) => (okSoFar(p) && by(p, 'UpdateTime') ? { fn: 'StartTransaction', ...vendorOf(p[0]), input: { clientId: v.clientId, processData: '', processType: '', additionalData: '' } } : null),
      (p) => {
        const start = by(p, 'StartTransaction');
        return okSoFar(p) && start ? { fn: 'FinishTransaction', ...vendorOf(p[0]), input: { clientId: v.clientId, transactionNumber: start.output.transactionNumber, processData: b64(TEST_DATA), processType: TEST_TYPE, additionalData: '' } } : null;
      },
      // abmelden, sobald die Anmeldung geklappt hat – auch wenn ein späterer Schritt gescheitert ist
      (p) => (by(p, 'AuthenticateUserForTimeAdmin')?.result === 'EXECUTION_OK' ? { fn: 'LogOutForTimeAdmin', ...vendorOf(p[0]), input: { clientId: v.clientId } } : null),
    ]);
  } catch (e) {
    throw new AppError(502, 'tse_failed', e instanceof TseError ? e.message : `TSE nicht erreichbar: ${e instanceof Error ? e.message : e}`);
  }
  const first = replies[0];
  if (!first || first.result !== 'EXECUTION_OK') fail(first, 'Die TSE-Daten ließen sich nicht lesen');
  const info = (first.output.tseInformation ?? {}) as Record<string, unknown>;
  if (info.tseInitializationState !== 'INITIALIZED')
    throw conflict(`Die TSE ist nicht in Betrieb (${str(info.tseInitializationState) || 'Zustand unbekannt'}). Signieren geht erst nach der Inbetriebnahme mit PUK und PINs.`, 'tse_not_initialized');
  const bad = replies.find((r) => r.result !== 'EXECUTION_OK' && r.fn !== 'LogOutForTimeAdmin');
  const start = by(replies, 'StartTransaction'), finish = by(replies, 'FinishTransaction');
  if (start?.result === 'EXECUTION_OK')
    await record(db, actor, { action: 'tse_test_signature', entity: 'program', entityId: 'tse', after: { clientId: v.clientId, transactionNumber: start.output.transactionNumber, finished: finish?.result === 'EXECUTION_OK' } });
  if (bad) {
    if (start?.result === 'EXECUTION_OK') throw new AppError(502, 'tse_failed', `Der Testvorgang Nr. ${start.output.transactionNumber} wurde begonnen, aber nicht abgeschlossen (${bad.result}). Er steht in der TSE als offener Vorgang.`);
    signFail(bad);
  }
  if (!start || !finish) throw new AppError(502, 'tse_failed', 'Die TSE hat den Testvorgang nicht ausgeführt.');
  const r: TseSignResult = {
    clientId: v.clientId, serialNumberHex: hex(str(info.serialNumber)), transactionNumber: num(start.output.transactionNumber),
    startTime: str(start.output.logTime), finishTime: str(finish.output.logTime), signatureCounter: num(finish.output.signatureCounter),
    signatureBase64: str(finish.output.signature), processType: TEST_TYPE, processData: TEST_DATA, printed: false, printError: '',
  };
  if (v.print) {
    try {
      const h = await getHotel(db);
      const t2 = (iso: string) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'medium' }) : '–');
      await printLines(db, (w) => {
        const row = (k: string, val: string): Line[] => [{ text: k, bold: true }, ...chunks(val || '–', w).map((text) => ({ text }))];
        return [
          { text: h.name, align: 'center', bold: true }, { text: 'TSE-TESTSIGNATUR', align: 'center', bold: true, big: true }, { text: 'Kein Umsatz – kein Kassenbeleg', align: 'center' }, { rule: true },
          ...row('Vorgangsart', r.processType), ...row('Inhalt', r.processData), ...row('Kassen-Kennung', r.clientId),
          ...row('Transaktionsnummer', String(r.transactionNumber ?? '–')), ...row('Signaturzähler', String(r.signatureCounter ?? '–')),
          ...row('Beginn', t2(r.startTime)), ...row('Ende', t2(r.finishTime)),
          ...row('Seriennummer der TSE (hex)', r.serialNumberHex), ...row('Signatur (Base64)', r.signatureBase64), { rule: true },
        ];
      });
      r.printed = true;
    } catch (e) { r.printError = e instanceof Error ? e.message : 'Druck fehlgeschlagen'; }
  }
  return r;
}
