import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';

/**
 * Sicherheitsprüfung „von außen“: Jede Adresse des Servers wird ohne Anmeldung aufgerufen. Wer den Programmcode der Seite liest,
 * kennt alle Adressen – geschützt sein muss deshalb jede einzelne auf dem Server, nicht in der Oberfläche.
 */
const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let routes: { method: string; path: string }[] = [];
let ip = 0;
const call = (method: string, path: string, cookies: Record<string, string> = {}) =>
  app.inject({ method: method as 'GET', url: path, cookies, payload: method === 'GET' || method === 'DELETE' ? undefined : {}, remoteAddress: `10.99.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}` });

/** Öffentlich (ohne Anmeldung) dürfen nur diese Adressen etwas anderes als „nicht angemeldet“ liefern. */
const PUBLIC = [
  /^\/api\/v1\/health$/, /^\/api\/v1\/auth\/(state|login|setup)$/, /^\/api\/v1\/public\//, /^\/api\/v1\/desktop-shortcut\.bat$/,
];
const sample = (p: string) => p.replace(/:id\b/g, '00000000-0000-4000-8000-000000000000').replace(/:key\b/g, 'hero').replace(/:mac\b/g, 'aa:bb:cc:dd:ee:ff').replace(/:token\b/g, 'x').replace(/:[a-zA-Z]+/g, 'x');

beforeAll(async () => {
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  await app.ready();
  // alle Adressen aus dem Routenbaum lesen
  const tree = app.printRoutes({ commonPrefix: false });
  for (const line of tree.split('\n')) {
    const m = /(\/\S*)\s+\(([^)]+)\)/.exec(line);
    if (!m) continue;
    for (const method of m[2]!.split(',').map((x) => x.trim())) if (!['HEAD', 'OPTIONS'].includes(method)) routes.push({ method, path: m[1]! });
  }
  routes = routes.filter((r) => r.path.startsWith('/api/v1/'));
  await call('POST', '/api/v1/auth/setup');
  await app.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { username: 'chef', name: 'Chef', password: 'sehr-geheim-123' } });
});
afterAll(async () => { await app.close(); await close(); });

describe('Sicherheit: Zugriff ohne Anmeldung und ohne Rechte', () => {
  it('findet alle Adressen des Servers', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('lässt ohne Anmeldung nur die öffentlichen Adressen zu', async () => {
    const open: string[] = [];
    for (const r of routes) {
      if (PUBLIC.some((re) => re.test(r.path))) continue;
      const res = await call(r.method, sample(r.path));
      if (res.statusCode !== 401) open.push(`${r.method} ${r.path} → ${res.statusCode}`);
    }
    expect(open).toEqual([]);
  });

  it('lässt einen Benutzer ohne freigegebene Bereiche an keine Administrator- oder Bereichsfunktion', async () => {
    const admin = (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'chef', password: 'sehr-geheim-123' } })).cookies.find((c) => c.name === 'pms_session')!.value;
    await app.inject({ method: 'POST', url: '/api/v1/users', cookies: { pms_session: admin }, payload: { username: 'leer', name: 'Ohne Rechte', password: 'ohne-rechte-123', role: 'user', modules: [] } });
    const user = { pms_session: (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'leer', password: 'ohne-rechte-123' } })).cookies.find((c) => c.name === 'pms_session')!.value };
    // was ein Benutzer ohne Bereiche trotzdem darf: sich selbst verwalten, Team/Übergabebuch, Suche, allgemeine Hinweise
    const ALLOWED = [/^\/api\/v1\/(auth|public)\//, /^\/api\/v1\/(health|desktop-shortcut\.bat|sync|search|changelog)$/, /^\/api\/v1\/team(\/|$)/, /^\/api\/v1\/network\/alert$/,
      /^\/api\/v1\/settings\/(notices|security|hotel)$/, /^\/api\/v1\/update\/(status|changelog)$/,
      // ohne Gast- oder Geschäftsdaten: Steuersätze; die Übersicht „Heute im Haus“ zeigt nur Bereiche, die freigegeben sind (hier: nichts)
      /^\/api\/v1\/tax-rates$/, /^\/api\/v1\/overview$/];
    const open: string[] = [];
    for (const r of routes) {
      if (ALLOWED.some((re) => re.test(r.path))) continue;
      const res = await call(r.method, sample(r.path), user);
      if (![401, 403].includes(res.statusCode)) open.push(`${r.method} ${r.path} → ${res.statusCode}`);
    }
    expect(open).toEqual([]);
  });

  it('bremst massenhaftes Ausprobieren von Passwörtern je Absender', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.55.0.9', payload: { username: `niemand${i}`, password: 'falsch-falsch' } })).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 401)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
    // andere Absender sind davon nicht betroffen
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.55.0.10', payload: { username: 'chef', password: 'sehr-geheim-123' } })).statusCode).toBe(200);
    const overview = await app.inject({ method: 'GET', url: '/api/v1/overview', cookies: { pms_session: (await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'leer', password: 'ohne-rechte-123' } })).cookies.find((c) => c.name === 'pms_session')!.value } });
    expect(overview.json()).toEqual([]); // ohne Bereiche: nichts
  });

  it('setzt die Sicherheits-Header, mit HSTS nur im HTTPS-Betrieb', async () => {
    const h = (await call('GET', '/api/v1/health')).headers;
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['permissions-policy']).toContain('camera=()');
    expect(h['cross-origin-opener-policy']).toBe('same-origin');
    expect(h['strict-transport-security']).toBeUndefined(); // ohne HTTPS (Betrieb im Hausnetz) kein HSTS
    const secure = await buildApp({ db, webDir: '/nonexistent', cookieSecure: true });
    expect((await secure.inject({ method: 'GET', url: '/api/v1/health' })).headers['strict-transport-security']).toBe('max-age=31536000');
    await secure.close();
  });

  it('meldet Eingabefehler auf Deutsch und ohne interne Einzelheiten', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/public/site/availability?from=2026-13-45&to=x&adults=-1', remoteAddress: '10.66.0.1' });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toMatch(/Invalid|expected|Too small/);
  });

  it('verrät öffentlich keine internen Angaben und lässt die Ersteinrichtung nicht wiederholen', async () => {
    const state = await call('GET', '/api/v1/auth/state');
    expect(state.json()).toEqual({ needsSetup: false, user: null, guestHome: false });
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/setup', payload: { username: 'boese', name: 'Böse', password: 'nochmal-123456' } })).statusCode).toBe(403);
    // gefälschte Herkunft: schreibende Anfragen von fremden Seiten werden abgelehnt
    const foreign = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://boese.example' }, payload: { username: 'chef', password: 'sehr-geheim-123' } });
    expect(foreign.statusCode).toBe(403);
    // Fehlermeldungen ohne interne Einzelheiten
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: '{kaputt' });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/stack|node_modules|at .*\.ts/i);
  });
});
