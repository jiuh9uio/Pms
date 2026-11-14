import { createServer, type Server, type Socket } from 'node:net';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { openDevice, operate, parseOperateResult } from '../src/server/lib/epsontse.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });

/** Simulierte ePOS-Device-Schnittstelle mit TSE, nach Epsons Handbüchern. */
let mode: 'ok' | 'no-stick' | 'selftest-fails' | 'in-use' = 'ok';
let seen: { fn: string; storage: { type: string; vendor: string }; timeout: string }[] = [];
let tested = false;
/** Herstellerkürzel, das die simulierte Schnittstelle für TSE-Befehle annimmt */
let acceptVendor = 'TSE1';
const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const PEM = '-----BEGIN CERTIFICATE-----\nTUlJQmV4YW1wbGU=\n-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----\nUk9PVA==\n-----END CERTIFICATE-----\n';
function tseServer(sock: Socket) {
  let buf = '';
  const send = (xml: string) => sock.write(xml + '\0');
  sock.on('error', () => {});
  send('<connect><data><client_id>sock123</client_id><protocol_version>2</protocol_version></data></connect>');
  sock.on('data', (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    for (;;) {
      const end = buf.indexOf('\0');
      if (end < 0) break;
      const msg = buf.slice(0, end);
      buf = buf.slice(end + 1);
      if (msg.startsWith('<open_device>')) {
        expect(msg).toBe(openDevice);
        send(`<open_device><device_id>local_TSE</device_id><code>${mode === 'in-use' ? 'DEVICE_IN_USE' : 'OK'}</code><data_id>1</data_id></open_device>`);
      } else if (msg.startsWith('<close_device>')) send('<close_device><device_id>local_TSE</device_id><code>OK</code><data_id>9</data_id></close_device>');
      else if (msg.startsWith('<device_data>')) {
        const req = JSON.parse(/<requestdata>([\s\S]*)<\/requestdata>/.exec(msg)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        seen.push({ fn: req.function, storage: req.storage, timeout: /<timeout>(\d+)<\/timeout>/.exec(msg)![1]! });
        let result: object;
        if (req.storage.type === 'TSE' && req.storage.vendor !== acceptVendor) result = { result: 'JSON_ERROR_UNEXPECTED_STORAGE_VENDOR', function: req.function, output: {} };
        else if (mode === 'no-stick') result = { result: 'OTHER_ERROR_NO_STORAGE_FOUND', function: req.function, output: {}, error: { fact: 'No valid storage is inserted' } };
        else if (req.function === 'GetStorageInfo') result = { result: 'EXECUTION_OK', function: 'GetStorageInfo', output: {
          vendorType: 'EPSON-USB-TSE', smartInformation: { healthStatus: 'PASS' },
          tseInformation: { serialNumber: Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex').toString('base64'), tsePublicKey: 'BEtleQ==', signatureAlgorithm: 'ecdsa-plain-SHA384',
            tseDescription: 'BSI-K-TR-0373-2019', cdcId: 'DE0123456789012345', tseInitializationState: 'INITIALIZED', hasValidTime: false, hasPassedSelfTest: tested, isTSEUnlocked: false,
            timeUntilNextSelfTest: 90000, certificateExpirationDate: '2028-12-31T23:59:59Z', createdSignatures: 1234, remainingSignatures: 9998766, maxSignatures: 10000000,
            registeredClients: 2, maxRegisteredClients: 100, startedTransactions: 0, tseCapacity: 14000000, tseCurrentSize: 0, softwareVersion: 65792, hardwareVersion: 65536 } } };
        else if (req.function === 'RunTSESelfTest') { tested = mode !== 'selftest-fails'; result = tested ? { result: 'EXECUTION_OK', function: req.function, output: {} } : { result: 'TSE1_ERROR_IO', function: req.function, output: {}, error: { fact: 'self test' } }; }
        else if (req.function === 'GetLogMessageCertificate') result = { result: 'EXECUTION_OK', function: req.function, output: { logMessageCertificate: Buffer.from(PEM).toString('base64') } };
        else result = { result: 'JSON_ERROR_UNEXPECTED_FUNCTION', function: req.function, output: {} };
        send(`<device_data><device_id>local_TSE</device_id><data><type>operateresult</type><success>true</success><code>SUCCESS</code><resultdata>${xmlEsc(JSON.stringify(result))}</resultdata></data><data_id>2</data_id></device_data>`);
      }
    }
  });
}
let server: Server;
let port: number;
let printer: Server;
const printed: Buffer[] = [];

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  server = createServer(tseServer);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
  printer = createServer({ allowHalfOpen: true }, (s) => { s.on('data', (d) => printed.push(d)); });
  await new Promise<void>((r) => printer.listen(0, '127.0.0.1', () => r()));
});
afterAll(async () => {
  server.close(); printer.close();
  await app.close();
  await close();
});

describe('TSE (Epson) prüfen', () => {
  it('baut die Nachrichten nach Epsons Handbuch', () => {
    expect(operate({ fn: 'GetStorageInfo', storageType: 'COMMON' })).toBe(
      '<device_data><device_id>local_TSE</device_id><data><type>operate</type><timeout>10000</timeout><requestdata>{&quot;storage&quot;:{&quot;type&quot;:&quot;COMMON&quot;,&quot;vendor&quot;:&quot;&quot;},&quot;function&quot;:&quot;GetStorageInfo&quot;,&quot;input&quot;:{},&quot;compress&quot;:{&quot;required&quot;:false,&quot;type&quot;:&quot;&quot;}}</requestdata></data></device_data>');
    expect(parseOperateResult('<data><type>operateresult</type><resultdata>{&quot;result&quot;:&quot;EXECUTION_OK&quot;,&quot;output&quot;: {}}</resultdata></data>', 'X')).toEqual({ fn: 'X', result: 'EXECUTION_OK', output: {}, error: undefined });
    expect(parseOperateResult('<device_data><data><type>operateresult</type><success>false</success><code>ERROR_TIMEOUT</code></data></device_data>', 'X').result).toBe('ERROR_ERROR_TIMEOUT');
  });

  it('ist ohne Einrichtung gesperrt und nur für Administratoren', async () => {
    expect((await call('GET', '/tse/info', admin)).json().error.code).toBe('tse_not_configured');
    expect((await call('PUT', '/settings/tse', admin, { enabled: true, host: '8.8.8.8', port })).statusCode).toBe(400);
    await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
    const user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
    expect((await call('GET', '/tse/info', user)).statusCode).toBe(403);
    await ok('PUT', '/settings/tse', admin, { enabled: true, host: '127.0.0.1', port });
  });

  it('liest die Daten des Sticks, ohne sich anzumelden oder etwas zu schreiben', async () => {
    seen = [];
    const i = await ok('GET', '/tse/info', admin);
    expect(seen.map((s) => s.fn)).toEqual(['GetStorageInfo', 'GetLogMessageCertificate']);
    expect(seen[0]!.storage).toEqual({ type: 'COMMON', vendor: '' });
    expect(seen[1]!.storage).toEqual({ type: 'TSE', vendor: 'TSE1' });
    expect(i).toMatchObject({
      vendorType: 'EPSON-USB-TSE', serialNumberHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', description: 'BSI-K-TR-0373-2019', signatureAlgorithm: 'ecdsa-plain-SHA384',
      initializationState: 'INITIALIZED', hasPassedSelfTest: false, hasValidTime: false, createdSignatures: 1234, remainingSignatures: 9998766, registeredClients: 2,
      certificateExpirationDate: '2028-12-31T23:59:59Z', healthStatus: 'PASS',
    });
    expect(i.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(i.certificateFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('führt den Selbsttest mit langer Wartezeit aus und meldet Fehler verständlich', async () => {
    seen = [];
    const i = await ok('POST', '/tse/selftest', admin, {});
    expect(seen.map((s) => s.fn)).toEqual(['GetStorageInfo', 'RunTSESelfTest', 'GetStorageInfo', 'GetLogMessageCertificate']);
    expect(seen[1]!.timeout).toBe('120000');
    expect(i.hasPassedSelfTest).toBe(true);
    for (const [m, text] of [['selftest-fails', 'Selbsttest ist fehlgeschlagen'], ['no-stick', 'OTHER_ERROR_NO_STORAGE_FOUND'], ['in-use', 'anderen Programm']] as const) {
      mode = m;
      const res = await call('POST', '/tse/selftest', admin, {});
      expect(res.statusCode, m).toBe(502);
      expect(res.json().error.message, m).toContain(text);
    }
    mode = 'ok';
    await ok('PUT', '/settings/tse', admin, { enabled: true, host: '127.0.0.1', port: 9 });
    expect((await call('GET', '/tse/info', admin)).json().error.message).toContain('keine TSE-Schnittstelle');
    await ok('PUT', '/settings/tse', admin, { enabled: true, host: '127.0.0.1', port });
  });

  it('versucht ein anderes Herstellerkürzel, wenn die Schnittstelle „TSE1“ ablehnt', async () => {
    acceptVendor = 'EPSON-USB-TSE';
    seen = [];
    const info = await ok('GET', '/tse/info', admin);
    expect(info.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(seen.map((x) => `${x.fn}:${x.storage.vendor}`)).toEqual(['GetStorageInfo:', 'GetLogMessageCertificate:TSE1', 'GetLogMessageCertificate:EPSON-USB-TSE']);
    acceptVendor = 'TSE1';
  });

  it('druckt das Datenblatt auf dem Bondrucker', async () => {
    expect((await call('POST', '/tse/print', admin, {})).json().error.code).toBe('printer_not_configured');
    await ok('PUT', '/settings/front-printer', admin, { enabled: true, host: '127.0.0.1', port: (printer.address() as { port: number }).port, width: 48 });
    await ok('POST', '/tse/print', admin, {});
    await new Promise((r) => setTimeout(r, 150));
    const bon = Buffer.concat(printed).toString('latin1');
    expect(bon).toContain('TSE-DATENBLATT');
    expect(bon).toContain('0123456789abcdef0123456789abcdef0123456789abcdef');
    expect(bon).toContain('BSI-K-TR-0373-2019');
    expect(bon).toContain('kein Kassenbeleg');
    await new Promise((r) => setTimeout(r, 2200));
  });
});
