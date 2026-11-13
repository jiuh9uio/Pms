import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { roomAllocations, roomCategories, rooms } from '../src/server/db/schema.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;

const ADMIN = { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' };
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => {
  const c = res.cookies.find((x) => x.name === 'pms_session');
  return c ? { pms_session: c.value } : {};
};
const call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', path: string, cookies: Record<string, string> = {}, payload?: unknown) =>
  app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
async function loginAs(username: string, password: string) {
  const res = await call('POST', '/auth/login', {}, { username, password });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}

let admin: Record<string, string>;

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
});
afterAll(async () => {
  await app.close();
  await close();
});

describe('Ersteinrichtung und Anmeldung', () => {
  it('verlangt die Ersteinrichtung und lässt sie nur einmal zu', async () => {
    expect((await call('GET', '/auth/state')).json()).toEqual({ needsSetup: true, user: null });
    const weak = await call('POST', '/auth/setup', {}, { ...ADMIN, password: 'kurz' });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.fields.password).toMatch(/Mindestens 10/);

    const res = await call('POST', '/auth/setup', {}, ADMIN);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('admin');
    admin = cookieOf(res);
    const cookie = res.cookies.find((c) => c.name === 'pms_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');

    expect((await call('POST', '/auth/setup', {}, { ...ADMIN, username: 'zweiter' })).statusCode).toBe(403);
    expect((await call('GET', '/auth/state', admin)).json().user.username).toBe('chef');
  });

  it('weist falsche Zugangsdaten ab und sperrt nach fünf Fehlversuchen', async () => {
    await call('POST', '/users', admin, { username: 'tester', name: 'Test', password: 'richtig-lang-1', role: 'user' });
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/auth/login', {}, { username: 'tester', password: 'falsch' });
      expect(r.statusCode).toBe(401);
    }
    const locked = await call('POST', '/auth/login', {}, { username: 'tester', password: 'richtig-lang-1' });
    expect(locked.statusCode).toBe(429);
    expect((await call('POST', '/auth/login', {}, { username: 'gibtsnicht', password: 'x' })).statusCode).toBe(401);
  });

  it('beendet die Sitzung beim Abmelden', async () => {
    const c = await loginAs('chef', ADMIN.password);
    expect((await call('POST', '/auth/logout', c)).statusCode).toBe(200);
    expect((await call('GET', '/users', c)).statusCode).toBe(401);
  });

  it('lehnt schreibende Anfragen fremder Herkunft ab', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/logout', cookies: admin, headers: { origin: 'https://boese.example', host: 'pms.local' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Rollen und Benutzerverwaltung', () => {
  let user: Record<string, string>;
  let userId: string;

  it('legt Benutzer an und verhindert doppelte Benutzernamen', async () => {
    const res = await call('POST', '/users', admin, { username: 'Rezeption', name: 'Rezeption', password: 'rezeption-123', role: 'user' });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('rezeption');
    expect(JSON.stringify(res.json())).not.toMatch(/hash/i);
    userId = res.json().id;
    expect((await call('POST', '/users', admin, { username: 'rezeption', name: 'X', password: 'rezeption-123', role: 'user' })).statusCode).toBe(409);
    user = await loginAs('rezeption', 'rezeption-123');
  });

  it('schützt Administrator-Funktionen serverseitig', async () => {
    expect((await call('GET', '/users')).statusCode).toBe(401);
    for (const [m, p, body] of [
      ['GET', '/users'], ['GET', '/audit'], ['POST', '/users', { username: 'neu', name: 'N', password: 'passwort-lang', role: 'admin' }],
      ['PATCH', `/users/${userId}`, { role: 'admin', version: 1 }], ['POST', `/users/${userId}/password`, { password: 'passwort-lang' }],
      ['PUT', '/settings/hotel', {}], ['POST', '/tax-rates', { name: 'x', ratePercent: 5 }],
    ] as const) expect((await call(m, p, user, body)).statusCode, `${m} ${p}`).toBe(403);
    expect((await call('GET', '/settings/hotel', user)).statusCode).toBe(200);
    expect((await call('GET', '/tax-rates', user)).statusCode).toBe(200);
  });

  it('lässt den letzten Administrator nicht entfernen', async () => {
    const me = (await call('GET', '/users', admin)).json().find((u: { username: string }) => u.username === 'chef');
    const demote = await call('PATCH', `/users/${me.id}`, admin, { role: 'user', version: me.version });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().error.code).toBe('last_admin');
    expect((await call('PATCH', `/users/${me.id}`, admin, { active: false, version: me.version })).statusCode).toBe(409);
  });

  it('erkennt veraltete Stände und meldet deaktivierte Benutzer sofort ab', async () => {
    const stale = await call('PATCH', `/users/${userId}`, admin, { name: 'Alt', version: 99 });
    expect(stale.json().error.code).toBe('stale');
    const off = await call('PATCH', `/users/${userId}`, admin, { active: false, version: 1 });
    expect(off.statusCode).toBe(200);
    expect((await call('GET', '/settings/hotel', user)).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', {}, { username: 'rezeption', password: 'rezeption-123' })).statusCode).toBe(401);
  });

  it('ändert das eigene Passwort nur mit dem aktuellen und setzt Passwörter zurück', async () => {
    const wrong = await call('POST', '/auth/password', admin, { current: 'falsch', password: 'neues-passwort-1' });
    expect(wrong.json().error.fields.current).toBeTruthy();
    const other = await loginAs('chef', ADMIN.password);
    expect((await call('POST', '/auth/password', admin, { current: ADMIN.password, password: 'neues-passwort-1' })).statusCode).toBe(200);
    expect((await call('GET', '/users', other)).statusCode).toBe(401); // andere Sitzung beendet
    expect((await call('GET', '/users', admin)).statusCode).toBe(200);

    // Zurücksetzen hebt auch die Sperre aus dem Anmeldetest auf
    const tester = (await call('GET', '/users', admin)).json().find((u: { username: string }) => u.username === 'tester');
    expect(tester.lockedUntil).not.toBeNull();
    expect((await call('POST', `/users/${tester.id}/password`, admin, { password: 'zurueckgesetzt-1' })).statusCode).toBe(200);
    await loginAs('tester', 'zurueckgesetzt-1');
  });
});

describe('Einstellungen und Steuersätze', () => {
  it('speichert Hotel-Stammdaten und prüft Eingaben', async () => {
    const cur = (await call('GET', '/settings/hotel', admin)).json();
    expect((await call('PUT', '/settings/hotel', admin, { ...cur, email: 'keine-mail' })).statusCode).toBe(400);
    const ok = await call('PUT', '/settings/hotel', admin, { ...cur, city: 'Musterstadt' });
    expect(ok.statusCode).toBe(200);
    expect((await call('GET', '/settings/hotel', admin)).json().city).toBe('Musterstadt');
  });

  it('liefert 7 % und 19 % vor und hält je Verwendung genau einen Standardsatz', async () => {
    const rates = (await call('GET', '/tax-rates', admin)).json();
    expect(rates.map((r: { ratePercent: number }) => r.ratePercent)).toEqual([7, 19]);
    const neu = await call('POST', '/tax-rates', admin, { name: 'Übernachtung neu', ratePercent: 9.5, defaultFor: 'lodging' });
    expect(neu.statusCode).toBe(200);
    const after = (await call('GET', '/tax-rates', admin)).json();
    expect(after.filter((r: { defaultFor: string | null }) => r.defaultFor === 'lodging').map((r: { ratePercent: number }) => r.ratePercent)).toEqual([9.5]);
    const off = await call('PATCH', `/tax-rates/${neu.json().id}`, admin, { active: false, version: neu.json().version });
    expect(off.json().defaultFor).toBeNull();
    expect((await call('POST', '/tax-rates', admin, { name: 'zu hoch', ratePercent: 150 })).statusCode).toBe(400);
  });
});

describe('Änderungsprotokoll', () => {
  it('zeichnet Änderungen mit Vorher/Nachher auf – ohne Passwörter', async () => {
    const log = (await call('GET', '/audit?limit=200', admin)).json();
    const actions = log.items.map((e: { entity: string; action: string }) => `${e.entity}:${e.action}`);
    for (const a of ['user:setup', 'user:create', 'user:update', 'user:password_reset', 'session:login', 'session:login_locked', 'settings:update', 'tax_rate:create'])
      expect(actions).toContain(a);
    const upd = log.items.find((e: { entity: string; action: string }) => e.entity === 'settings');
    expect(upd.before.city).toBe('');
    expect(upd.after.city).toBe('Musterstadt');
    expect(JSON.stringify(log)).not.toMatch(/scrypt|sehr-geheim|passwordHash/);
    const page = (await call('GET', '/audit?limit=2', admin)).json();
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe(page.items[1].id);
  });

  it('kann in der Datenbank weder geändert noch gelöscht werden', async () => {
    await expect(db.execute(sql`update audit_log set action = 'x'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_log`)).rejects.toThrow();
    await expect(db.execute(sql`truncate audit_log`)).rejects.toThrow();
  });
});

describe('Doppelbuchungsschutz in der Datenbank', () => {
  let roomId: string;
  const alloc = (period: string, active = true) => db.insert(roomAllocations).values({ roomId, period, kind: 'stay', active });

  beforeAll(async () => {
    const [cat] = await db.insert(roomCategories).values({ name: 'Doppelzimmer' }).returning();
    const [room] = await db.insert(rooms).values({ number: '1', categoryId: cat!.id }).returning();
    roomId = room!.id;
  });

  it('lässt von vielen gleichzeitigen Buchungen desselben Zeitraums genau eine zu', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => alloc('[2031-05-10,2031-05-13)')));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('weist Überschneidungen ab, erlaubt aber Anreise am Abreisetag', async () => {
    await expect(alloc('[2031-05-12,2031-05-14)')).rejects.toThrow();
    await expect(alloc('[2031-05-09,2031-05-11)')).rejects.toThrow();
    await expect(alloc('[2031-05-13,2031-05-15)')).resolves.toBeDefined();
    await expect(alloc('[2031-05-08,2031-05-10)')).resolves.toBeDefined();
  });

  it('ignoriert stornierte Belegungen und lehnt leere Zeiträume ab', async () => {
    await expect(alloc('[2031-05-10,2031-05-13)', false)).resolves.toBeDefined();
    await expect(alloc('[2031-06-01,2031-06-01)')).rejects.toThrow();
  });
});

describe('Benutzername ändern und Notfall-Zurücksetzung', () => {
  it('ändert den Benutzernamen, lehnt vergebene und ungültige Namen ab', async () => {
    const created = (await call('POST', '/users', admin, { username: 'aushilfe', name: 'Aushilfe', password: 'aushilfe-12345', role: 'user' })).json();
    expect((await call('PATCH', `/users/${created.id}`, admin, { username: ADMIN.username, version: created.version })).statusCode).toBe(409);
    expect((await call('PATCH', `/users/${created.id}`, admin, { username: 'x y', version: created.version })).statusCode).toBe(400);
    const res = await call('PATCH', `/users/${created.id}`, admin, { username: 'service', version: created.version });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe('service');
    expect((await call('POST', '/auth/login', {}, { username: 'aushilfe', password: 'aushilfe-12345' })).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', {}, { username: 'service', password: 'aushilfe-12345' })).statusCode).toBe(200);
  });

  it('setzt am PMS-Rechner ein Zufallspasswort und beendet alle Sitzungen', async () => {
    const { emergencyReset } = await import('../src/server/modules/users.js');
    const unknown = await emergencyReset(db, 'gibt-es-nicht');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.usernames.join(' ')).toContain('service (Benutzer)');
    const before = cookieOf(await call('POST', '/auth/login', {}, { username: 'service', password: 'aushilfe-12345' }));
    const r = await emergencyReset(db, 'SERVICE');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.password.length).toBeGreaterThanOrEqual(12);
    expect((await call('GET', '/settings/hotel', before)).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', {}, { username: 'service', password: 'aushilfe-12345' })).statusCode).toBe(401);
    expect((await call('POST', '/auth/login', {}, { username: 'service', password: r.password })).statusCode).toBe(200);
  });
});
