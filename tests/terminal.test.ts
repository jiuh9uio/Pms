import { createServer, type Server, type Socket } from 'node:net';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { apdu, authorization, parseStatus, registration, splitApdus } from '../src/server/lib/zvt.js';

process.env.PMS_TERMINAL_TIMEOUT_MS = '1500';
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

/** Simuliertes EC-Gerät: spricht die Kassenschnittstelle so, wie das Protokoll sie beschreibt. */
type Mode = 'approve' | 'decline' | 'drop' | 'bad-password' | 'silent' | 'wrong-amount';
let mode: Mode = 'approve';
let seen: string[] = [];
let server: Server;
let port: number;
const ACK = Buffer.from([0x80, 0, 0]);
const hex = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
function terminal(sock: Socket) {
  let buf: Buffer = Buffer.alloc(0);
  sock.on('error', () => {});
  sock.on('data', (chunk: Buffer) => {
    const s = splitApdus(Buffer.concat([buf, chunk]));
    buf = s.rest;
    for (const m of s.apdus) {
      const code = (m.cls << 8) | m.instr;
      if (m.cls === 0x80) continue;
      seen.push(`${code.toString(16).padStart(4, '0')}:${m.data.toString('hex')}`);
      if (code === 0x0600) {
        if (mode === 'bad-password') { sock.write(Buffer.from([0x84, 0x6f, 0])); continue; }
        sock.write(Buffer.concat([ACK, apdu(0x06, 0x0f)]));
      } else if (code === 0x0601) {
        const amount = m.data.subarray(1, 7).toString('hex');
        sock.write(ACK);
        if (mode === 'silent') continue;
        sock.write(apdu(0x04, 0xff, Buffer.from([0x0a]))); // Zwischenstatus „Karte einstecken“
        if (mode === 'drop') { setTimeout(() => sock.destroy(), 30); continue; }
        if (mode === 'decline') { sock.write(Buffer.concat([apdu(0x04, 0x0f, hex('27 6c')), apdu(0x06, 0x1e, hex('6c'))])); continue; }
        // Ergebnis 00, Betrag, TA-Nr., Zeit, Datum, Terminal-ID, Belegnr., Kartenname (LLVAR), danach ein TLV-Container
        const amt = mode === 'wrong-amount' ? '000000000001' : amount;
        const name = Buffer.from('girocard\0', 'latin1');
        const status = Buffer.concat([hex(`27 00 04 ${amt} 0b 000123 0c 143000 0d 1113 29 52500001 87 0045 8b f0 f9`), name, hex('06 03 1f 10 00')]);
        // absichtlich in zwei Stücken gesendet: Nachrichten können über Paketgrenzen laufen
        const all = Buffer.concat([apdu(0x04, 0x0f, status), apdu(0x06, 0xd1, Buffer.from('Beleg')), apdu(0x06, 0x0f)]);
        sock.write(all.subarray(0, 9));
        setTimeout(() => sock.write(all.subarray(9)), 20);
      }
    }
  });
}

let bookingId: string;
beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  const cat = await ok('POST', '/categories', admin, { name: 'Doppelzimmer', description: '', stdOccupancy: 2, maxPersons: 2, basePriceCents: 9900, sort: 1 });
  await ok('POST', '/rooms/bulk', admin, { categoryId: cat.id, count: 1, firstNumber: 101, floor: '1' });
  const room = (await ok('GET', '/rooms', admin))[0];
  const guest = { salutation: '', firstName: 'Test', lastName: 'Gast', company: '', email: '', phone: '', street: '', zip: '', city: '', country: '', birthdate: '', nationality: '', idNumber: '', notes: '' };
  bookingId = (await ok('POST', '/bookings', admin, { guest, groupName: '', source: 'Telefon', paymentMethod: '', notes: '', breakfast: false,
    rooms: [{ roomId: room.id, from: '2031-05-08', to: '2031-05-09', adults: 2, children: 0, status: 'confirmed', pricePerNightCents: null }] })).id;
  server = createServer(terminal);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  server.close();
  await app.close();
  await close();
});

const paid = async () => (await ok('GET', `/bookings/${bookingId}/billing`, admin)).payments as { amountCents: number; method: string; note: string }[];

describe('EC-Gerät (Kassenschnittstelle ZVT)', () => {
  it('baut Nachrichten nach dem Protokoll und liest Statusfelder', () => {
    expect(registration('000000').toString('hex')).toBe('060006000000080978');
    expect(authorization(9900).toString('hex')).toBe('06010a04000000009900490978');
    expect(authorization(123456789).toString('hex')).toBe('06010a04000123456789490978');
    expect(apdu(0x04, 0x0f, Buffer.alloc(300)).subarray(0, 5).toString('hex')).toBe('040fff2c01'); // lange Nachricht: Länge in zwei Bytes
    expect(parseStatus(hex('27 00 04 000000009900 0b 000123 87 0045 8b f0 f8 67 69 72 6f 63 61 72 64 06 02 aa bb')))
      .toEqual({ resultCode: 0, amountCents: 9900, trace: '000123', receiptNo: '0045', cardName: 'girocard' });
    expect(splitApdus(hex('800000 040f')).apdus).toHaveLength(1);
  });

  it('ist ohne Einrichtung gesperrt und nimmt nur Adressen im Hausnetz', async () => {
    expect((await ok('GET', '/terminal/status', admin)).ready).toBe(false);
    expect((await call('POST', '/payments/terminal', admin, { bookingId, amountCents: 9900, payer: '', note: '' })).json().error.code).toBe('terminal_not_configured');
    expect((await call('PUT', '/settings/terminal', admin, { enabled: true, host: '8.8.8.8', port, password: '000000' })).statusCode).toBe(400);
    expect((await call('PUT', '/settings/terminal', admin, { enabled: true, host: '127.0.0.1', port, password: '12' })).statusCode).toBe(400);
    await ok('PUT', '/settings/terminal', admin, { enabled: true, host: '127.0.0.1', port, password: '000000' });
    expect((await ok('GET', '/terminal/status', admin)).ready).toBe(true);
    expect(JSON.stringify(await ok('GET', '/audit?entity=settings&limit=5', admin))).not.toContain('"password"');
  });

  it('prüft die Verbindung, ohne etwas abzubuchen', async () => {
    seen = [];
    expect((await ok('POST', '/settings/terminal/test', admin, {})).message).toContain('steht');
    expect(seen).toEqual(['0600:000000080978']);
    mode = 'bad-password';
    const bad = await call('POST', '/settings/terminal/test', admin, {});
    expect(bad.statusCode).toBe(502);
    expect(bad.json().error.message).toContain('Passwort');
    mode = 'approve';
  });

  it('bucht eine erfolgreiche Kartenzahlung mit Angaben des Geräts', async () => {
    seen = [];
    const r = await ok('POST', '/payments/terminal', admin, { bookingId, amountCents: 9900, payer: '', note: 'Anzahlung' });
    expect(r.message).toContain('girocard');
    expect(seen[1]).toBe('0601:04000000009900490978');
    const list = await paid();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ amountCents: 9900, method: 'Karte' });
    expect(list[0]!.note).toContain('Beleg 0045');
    expect(list[0]!.note).toContain('TA-Nr. 000123');
    expect(list[0]!.note).toContain('Anzahlung');
  });

  it('bucht nichts bei Ablehnung, Abbruch der Verbindung, falschem Betrag oder fehlender Antwort', async () => {
    for (const [m, status, code, text] of [
      ['decline', 409, 'terminal_declined', 'abgebrochen'], ['drop', 502, 'terminal_unknown', 'unklar'],
      ['wrong-amount', 502, 'terminal_unknown', 'anderen Betrag'], ['silent', 502, 'terminal_unknown', 'Zeitüberschreitung'],
    ] as const) {
      mode = m;
      const res = await call('POST', '/payments/terminal', admin, { bookingId, amountCents: 5000, payer: '', note: '' });
      expect(res.statusCode, m).toBe(status);
      expect(res.json().error.code, m).toBe(code);
      expect(res.json().error.message, m).toContain(text);
    }
    mode = 'approve';
    expect(await paid()).toHaveLength(1); // nur die erfolgreiche von vorhin
    const log = await ok('GET', '/terminal/log', admin);
    expect(log.map((l: { outcome: string }) => l.outcome)).toEqual(['unknown', 'unknown', 'unknown', 'declined', 'approved']);
  }, 20_000);

  it('startet das Gerät nicht, wenn sich die Zahlung gar nicht buchen ließe', async () => {
    seen = [];
    expect((await call('POST', '/payments/terminal', admin, { bookingId: '00000000-0000-4000-8000-000000000000', amountCents: 100, payer: '', note: '' })).statusCode).toBe(404);
    expect((await call('POST', '/payments/terminal', admin, { bookingId, amountCents: 0, payer: '', note: '' })).statusCode).toBe(400);
    expect(seen).toEqual([]);
    await ok('POST', '/users', admin, { username: 'kueche', name: 'Küche', password: 'sehr-geheim-456', role: 'user', modules: ['kontrollen'] });
    const user = session(await call('POST', '/auth/login', {}, { username: 'kueche', password: 'sehr-geheim-456' }));
    expect((await call('POST', '/payments/terminal', user, { bookingId, amountCents: 100, payer: '', note: '' })).statusCode).toBe(403);
  });
});
