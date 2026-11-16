import { createServer, type Server } from 'node:http';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { connect, runMigrations } from '../src/server/db/client.js';
import { setOutlookTest } from '../src/server/modules/outlook.js';
import { OUTLOOK_DEFAULTS, assess, easter, holidayName, parseBrightSky, parseOpenLiga, type WeatherHour } from '../src/shared/outlook.js';

const hours = (f: (h: number) => Partial<WeatherHour>): WeatherHour[] => Array.from({ length: 24 }, (_, h) => ({ hour: h, temp: 10, precip: 0, prob: 0, condition: 'dry', ...f(h) }));
const base = { settings: OUTLOOK_DEFAULTS, matches: [], events: [], reservations: { persons: 0, seats: 40, count: 0 } };

describe('Ausblick – Rechnung', () => {
  it('Ostern und bundesweite Feiertage', () => {
    expect(easter(2025)).toBe('2025-04-20');
    expect(easter(2026)).toBe('2026-04-05');
    expect(easter(2027)).toBe('2027-03-28');
    expect(holidayName('2026-04-03')).toBe('Karfreitag');
    expect(holidayName('2026-05-14')).toBe('Christi Himmelfahrt');
    expect(holidayName('2026-05-25')).toBe('Pfingstmontag');
    expect(holidayName('2026-10-03')).toBe('Tag der Deutschen Einheit');
    expect(holidayName('2026-11-16')).toBeNull();
  });

  it('kalt und nass am Samstag → viele Walk-ins; warm und trocken am Montag → wenige', () => {
    const wet = assess({ ...base, date: '2026-11-21', hours: hours(() => ({ temp: 3, precip: 1.2, condition: 'rain' })) });
    expect(wet.walkIn.level).toBe('hoch');
    expect(wet.walkIn.reasons.map((r) => r.text).join(' ')).toMatch(/Nass.*|Kalt/);
    const warm = assess({ ...base, date: '2026-07-06', hours: hours(() => ({ temp: 26 })) });
    expect(warm.walkIn.level).toBe('niedrig');
  });

  it('Fußball am Abend und Werktag → Gäste gehen eher früher; Lieblingsverein zählt extra', () => {
    const m = [{ time: '20:30', title: 'FC Beispiel – SV Muster', league: '1. Bundesliga', favorite: true }];
    const r = assess({ ...base, date: '2026-11-18', hours: null, matches: m, settings: { ...OUTLOOK_DEFAULTS, favoriteTeam: 'Beispiel' } });
    expect(r.leaveEarly.level).toBe('hoch');
    expect(r.leaveEarly.reasons.some((x) => x.text.includes('20:30'))).toBe(true);
    const calm = assess({ ...base, date: '2026-11-21', hours: null });
    expect(calm.leaveEarly.level).toBe('niedrig');
  });

  it('Erfahrung des Hauses: 10 °C und kälter plus Wintersaison → viele Walk-ins; Fußball → Gäste schnell weg', () => {
    const cold = assess({ ...base, date: '2026-11-18', hours: hours(() => ({ temp: 8 })) }); // Mittwoch, 8 °C, trocken
    expect(cold.walkIn.level).toBe('hoch');
    expect(cold.walkIn.reasons.map((r) => r.text).join(' ')).toMatch(/Wintersaison/);
    const mild = assess({ ...base, date: '2027-05-19', hours: hours(() => ({ temp: 15 })) }); // Mittwoch im Mai, 15 °C
    expect(mild.walkIn.level).toBe('mittel');
    const own = assess({ ...base, date: '2027-05-19', hours: hours(() => ({ temp: 8 })), settings: { ...OUTLOOK_DEFAULTS, coldC: 5 } });
    expect(own.walkIn.reasons.some((r) => r.text.startsWith('Kalt'))).toBe(false);
    const foot = assess({ ...base, date: '2026-11-17', hours: null, matches: [{ time: '20:45', title: 'A – B', league: 'X', favorite: false }] });
    expect(foot.leaveEarly.level).toBe('hoch');
    expect(foot.leaveEarly.reasons.some((r) => r.text.includes('schnell weg'))).toBe(true);
    const off = assess({ ...base, date: '2026-11-17', hours: null, matches: [{ time: '15:30', title: 'A – B', league: 'X', favorite: false }] });
    expect(off.leaveEarly.reasons.some((r) => r.text.includes('Fußball'))).toBe(false);
  });

  it('ohne Wetter wird trotzdem gerechnet; volle Reservierung gibt einen Hinweis', () => {
    const r = assess({ ...base, date: '2026-11-20', hours: null, reservations: { persons: 36, seats: 40, count: 9 } });
    expect(r.walkIn.score).toBeGreaterThan(0);
    expect(r.hints.join(' ')).toMatch(/36 von 40/);
  });

  it('liest Antworten der Dienste und ignoriert andere Tage', () => {
    const w = parseBrightSky({ weather: [
      { timestamp: '2026-11-16T12:00:00+01:00', temperature: 4.2, precipitation: 0.6, precipitation_probability: 80, condition: 'rain' },
      { timestamp: '2026-11-17T12:00:00+01:00', temperature: 9, precipitation: 0, condition: 'dry' },
    ] }, '2026-11-16');
    expect(w).toEqual([{ hour: 12, temp: 4.2, precip: 0.6, prob: 80, condition: 'rain' }]);
    expect(() => parseBrightSky({ foo: 1 }, '2026-11-16')).toThrow();
    const m = parseOpenLiga([
      { matchDateTime: '2026-11-16T20:30:00', leagueName: '1. Fußball-Bundesliga', team1: { teamName: 'FC Beispiel' }, team2: { teamName: 'SV Muster' } },
      { matchDateTime: '2026-11-17T15:30:00', team1: { teamName: 'A' }, team2: { teamName: 'B' } },
    ], '2026-11-16', 'muster');
    expect(m).toEqual([{ time: '20:30', title: 'FC Beispiel – SV Muster', league: '1. Fußball-Bundesliga', favorite: true }]);
  });
});

const url = process.env.TEST_DATABASE_URL ?? 'postgres://pms:pms@127.0.0.1:5432/pms_test';
if (!/test/.test(new URL(url).pathname)) throw new Error('Tests löschen die Datenbank – der Datenbankname muss „test“ enthalten');
const { db, close } = connect(url);
let app: FastifyInstance;
let fake: Server;
let calls: string[] = [];
let admin: Record<string, string>, user: Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => app.inject({ method, url: '/api/v1' + path, cookies, payload: payload as object | undefined });
const ok = async (method: Method, path: string, cookies: Record<string, string>, payload?: unknown) => {
  const res = await call(method, path, cookies, payload);
  expect(res.statusCode, `${method} ${path}: ${res.body.slice(0, 300)}`).toBe(200);
  return res.json();
};
const session = (res: { cookies: { name: string; value: string }[] }) => ({ pms_session: res.cookies.find((c) => c.name === 'pms_session')!.value });
const DAY = '2026-11-21';

beforeAll(async () => {
  fake = createServer((req, res) => {
    calls.push(req.url ?? '');
    res.setHeader('Content-Type', 'application/json');
    if (req.url?.startsWith('/weather')) res.end(JSON.stringify({ weather: Array.from({ length: 24 }, (_, h) => ({ timestamp: `${DAY}T${String(h).padStart(2, '0')}:00:00+01:00`, temperature: 2, precipitation: 1, precipitation_probability: 90, condition: 'rain' })) }));
    else if (req.url === '/liga/bl1') res.end(JSON.stringify([{ matchDateTime: `${DAY}T20:30:00`, leagueName: 'Bundesliga', team1: { teamName: 'FC Beispiel' }, team2: { teamName: 'SV Muster' } }]));
    else { res.statusCode = 500; res.end('{}'); }
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
  const port = (fake.address() as { port: number }).port;
  setOutlookTest({ weatherBase: `http://127.0.0.1:${port}/weather`, ligaBase: `http://127.0.0.1:${port}/liga`, allowPrivate: true });
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  app = await buildApp({ db, webDir: '/nonexistent' });
  admin = session(await call('POST', '/auth/setup', {}, { username: 'chef', name: 'Chefin', password: 'sehr-geheim-123' }));
  await ok('POST', '/users', admin, { username: 'service', name: 'Service', password: 'service-123', role: 'user' });
  user = session(await call('POST', '/auth/login', {}, { username: 'service', password: 'service-123' }));
});
afterAll(async () => { await app.close(); await close(); fake.close(); });

describe('Ausblick – Schnittstelle', () => {
  it('ohne Standort: kein Wetterabruf, trotzdem eine Einschätzung', async () => {
    await ok('PUT', '/restaurant/outlook/settings', admin, { ...OUTLOOK_DEFAULTS, leagues: '' });
    const o = await ok('GET', `/restaurant/outlook?date=${DAY}`, user);
    expect(o.weather.configured).toBe(false);
    expect(calls.length).toBe(0);
    expect(o.walkIn.level).toBeTruthy();
  });

  it('nur der Administrator stellt ein; Werte werden geprüft', async () => {
    expect((await call('PUT', '/restaurant/outlook/settings', user, OUTLOOK_DEFAULTS)).statusCode).toBe(403);
    expect((await call('PUT', '/restaurant/outlook/settings', admin, { ...OUTLOOK_DEFAULTS, dinnerFrom: 23, dinnerTo: 20 })).statusCode).toBe(400);
    expect((await call('PUT', '/restaurant/outlook/settings', admin, { ...OUTLOOK_DEFAULTS, leagues: 'bl1; drop' })).statusCode).toBe(400);
  });

  it('mit Standort: Wetter und Fußball fließen ein, nur Koordinaten werden gesendet, Antworten zwischengespeichert', async () => {
    await ok('PUT', '/restaurant/outlook/settings', admin, { ...OUTLOOK_DEFAULTS, lat: 50.1, lon: 8.6, leagues: 'bl1, xx', favoriteTeam: 'Muster' });
    const o = await ok('GET', `/restaurant/outlook?date=${DAY}`, user);
    expect(o.weather.dinner.label).toMatch(/2 °C, nass/);
    expect(o.walkIn.level).toBe('hoch');
    expect(o.matches).toHaveLength(1);
    expect(o.matchesError).toMatch(/xx/);
    expect(o.leaveEarly.reasons.some((r: { text: string }) => r.text.includes('Muster'))).toBe(true);
    expect(calls.find((c) => c.startsWith('/weather'))).toBe(`/weather?lat=50.1&lon=8.6&date=${DAY}&last_date=2026-11-22&tz=Europe/Berlin`);
    const n = calls.length;
    await ok('GET', `/restaurant/outlook?date=${DAY}`, user);
    expect(calls.length).toBe(n);
  });

  it('Veranstaltungen eintragen und löschen (auch ohne Administrator)', async () => {
    const e = await ok('POST', '/restaurant/events', user, { date: DAY, time: '19:00', title: 'Konzert in der Stadthalle', effect: 'leave' });
    expect((await call('POST', '/restaurant/events', user, { date: DAY, time: '', title: '', effect: 'more' })).statusCode).toBe(400);
    const o = await ok('GET', `/restaurant/outlook?date=${DAY}`, user);
    expect(o.events).toHaveLength(1);
    expect(o.leaveEarly.reasons.some((r: { text: string }) => r.text.includes('Stadthalle'))).toBe(true);
    await ok('DELETE', `/restaurant/events/${e.id}`, user);
    expect((await ok('GET', `/restaurant/outlook?date=${DAY}`, user)).events).toHaveLength(0);
  });
});
