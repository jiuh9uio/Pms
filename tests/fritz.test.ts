import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let admin: Record<string, string>;
let user: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });

/** Nachgebaute FRITZ!Box: TR-064 über HTTP mit Digest-Anmeldung, wie in der AVM-Beschreibung. */
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const calls: string[] = [];
let dsl = true;
let box: Server;
let port: number;
const envelope = (inner: string) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${inner}</s:Body></s:Envelope>`;
const fault = (code: number, text: string) => envelope(`<s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:dslforum-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault>`);
beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user', modules: ['internet'] });
  user = session(await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' }));
  box = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const auth = req.headers.authorization ?? '';
      const get = (k: string) => new RegExp(`${k}="?([^",]+)"?`).exec(auth)?.[1] ?? '';
      const expected = md5(`${md5('pms:F!Box SOAP-Auth:box-geheim')}:n0nce:${get('nc')}:${get('cnonce')}:auth:${md5(`POST:${req.url}`)}`);
      if (!auth.startsWith('Digest') || get('username') !== 'pms' || get('response') !== expected) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="F!Box SOAP-Auth", nonce="n0nce", qop="auth", algorithm=MD5' }); res.end('unauthorized'); return;
      }
      const action = String(req.headers.soapaction).replace(/"/g, '');
      expect(body).toContain(`<u:${action.split('#')[1]} xmlns:u="${action.split('#')[0]}"/>`);
      calls.push(`${req.url} ${action.split('#')[1]}`);
      const send = (status: number, xml: string) => { res.writeHead(status, { 'Content-Type': 'text/xml' }); res.end(xml); };
      if (req.url === '/upnp/control/deviceinfo') send(200, envelope('<u:GetInfoResponse><NewModelName>FRITZ!Box 7590</NewModelName><NewSoftwareVersion>154.07.57</NewSoftwareVersion><NewUpTime>93784</NewUpTime></u:GetInfoResponse>'));
      else if (req.url === '/upnp/control/deviceconfig') send(200, envelope('<u:RebootResponse></u:RebootResponse>'));
      else if (req.url === '/upnp/control/wanpppconn1' && dsl) send(action.endsWith('GetInfo') ? 200 : 500, action.endsWith('GetInfo') ? envelope('<u:GetInfoResponse><NewConnectionStatus>Connected</NewConnectionStatus><NewExternalIPAddress>203.0.113.7</NewExternalIPAddress></u:GetInfoResponse>') : fault(707, 'DisconnectInProgress'));
      else if (req.url === '/upnp/control/wanipconnection1' && !dsl) send(200, action.endsWith('GetInfo') ? envelope('<u:GetInfoResponse><NewConnectionStatus>Connected</NewConnectionStatus><NewExternalIPAddress>198.51.100.9</NewExternalIPAddress></u:GetInfoResponse>') : envelope('<u:ForceTerminationResponse></u:ForceTerminationResponse>'));
      else send(500, fault(401, 'Invalid Action'));
    });
  });
  await new Promise<void>((r) => box.listen(0, '127.0.0.1', () => r()));
  port = (box.address() as { port: number }).port;
});
afterAll(async () => { box.close(); await app.close(); await close(); });

describe('FRITZ!Box steuern', () => {
  it('ist ohne Einrichtung gesperrt; einrichten darf nur der Administrator', async () => {
    expect((await call('POST', '/network/fritz/action', user, { action: 'reboot' })).statusCode).toBe(409);
    expect((await call('PUT', '/network/fritz', user, { enabled: true, host: '127.0.0.1', port, user: 'pms', password: 'x' })).statusCode).toBe(403);
    expect((await call('PUT', '/network/fritz', admin, { enabled: true, host: '8.8.8.8', port, user: 'pms', password: 'x' })).statusCode).toBe(400); // nur Adressen im Hausnetz
    const saved = await ok('PUT', '/network/fritz', admin, { enabled: true, host: '127.0.0.1', port, user: 'pms', password: 'box-geheim' });
    expect(saved).toEqual({ enabled: true, host: '127.0.0.1', port, user: 'pms', hasPassword: true, available: true });
    const stored = await db.execute(sql`select value::text as v from settings where key = 'fritzbox'`);
    expect(String(stored[0]!.v)).not.toContain('box-geheim');
    expect(await ok('GET', '/network/fritz', user)).toMatchObject({ hasPassword: true, user: 'pms' });
  });

  it('meldet sich per Digest an und liest Modell, Laufzeit und Verbindungszustand', async () => {
    expect(await ok('GET', '/network/fritz/info', user)).toEqual({ model: 'FRITZ!Box 7590', version: '154.07.57', uptimeSec: 93784, externalIp: '203.0.113.7', connection: 'Connected' });
  });

  it('baut die Verbindung neu auf (DSL und Kabel) und startet die Box neu', async () => {
    calls.length = 0;
    await ok('POST', '/network/fritz/action', user, { action: 'reconnect' }); // DSL: die Box meldet 707 „trennt bereits“ – gilt als Erfolg
    expect(calls).toEqual(['/upnp/control/wanpppconn1 ForceTermination']);
    dsl = false; calls.length = 0;
    await ok('POST', '/network/fritz/action', user, { action: 'reconnect' }); // Kabel: zweite Anschlussart
    expect(calls).toEqual(['/upnp/control/wanpppconn1 ForceTermination', '/upnp/control/wanipconnection1 ForceTermination']);
    calls.length = 0;
    await ok('POST', '/network/fritz/action', user, { action: 'reboot' });
    expect(calls).toEqual(['/upnp/control/deviceconfig Reboot']);
    const log = await db.execute(sql`select action from audit_log where action like 'fritz_%' order by id`);
    expect(log.map((r) => r.action)).toEqual(['fritz_reconnect', 'fritz_reconnect', 'fritz_reboot']);
  });

  it('meldet ein falsches Kennwort und eine nicht erreichbare Box verständlich', async () => {
    await ok('PUT', '/network/fritz', admin, { enabled: true, host: '127.0.0.1', port, user: 'pms', password: 'falsch' });
    const bad = await call('POST', '/network/fritz/action', user, { action: 'reboot' });
    expect(bad.statusCode).toBe(502);
    expect(bad.body).toContain('Anmeldung an der FRITZ!Box abgelehnt');
    await ok('PUT', '/network/fritz', admin, { enabled: true, host: '127.0.0.1', port: 1, user: 'pms', password: 'box-geheim' });
    const gone = await call('GET', '/network/fritz/info', user);
    expect(gone.statusCode).toBe(502);
    expect(gone.body).toContain('nicht erreichbar');
  });
});
