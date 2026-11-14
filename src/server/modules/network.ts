import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { reverse } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { desc, eq, isNull, lt } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { FritzInfoDto, FritzSettingsDto, InternetStatusDto, NetAlertDto, NetDeviceDto, NetOutagesDto, NetScanDto, WifiDto, WifiSettings } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { netDevices, netOutages, settings } from '../db/schema.js';
import { getHotel } from './settings.js';
import { AppError, conflict } from '../lib/errors.js';
import { isPrivateIp } from '../lib/escpos.js';
import { tr064, Tr064Error, type Tr064Config } from '../lib/tr064.js';
import { decrypt, encrypt } from './mail.js';
import { record, SYSTEM, type Actor } from './audit.js';

/**
 * Geräte im Hausnetz: Welche Geräte sind im selben Netz wie der PMS-Rechner gerade erreichbar?
 * Dazu wird jede Adresse des eigenen Netzes einmal angesprochen und danach die Nachbartabelle des Betriebssystems gelesen
 * (wie „arp -a“). Es wird kein Datenverkehr mitgelesen und nichts gespeichert außer den vom Administrator vergebenen Namen.
 */

const MAX_HOSTS = 1024;
const ipToInt = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
export const normMac = (m: string) => m.toLowerCase().replace(/-/g, ':').split(':').map((p) => p.padStart(2, '0')).join(':');

/** Liest IP- und Geräteadressen aus der Ausgabe von „arp -a“ (Windows, beliebige Sprache) oder /proc/net/arp (Linux). */
export function parseNeighbors(text: string): { ip: string; mac: string }[] {
  const out = new Map<string, { ip: string; mac: string }>();
  for (const line of text.split(/\r?\n/)) {
    const m = /(\d{1,3}(?:\.\d{1,3}){3})\D.*?\b((?:[0-9a-f]{1,2}[:-]){5}[0-9a-f]{1,2})\b/i.exec(line);
    if (!m) continue;
    const ip = m[1]!, mac = normMac(m[2]!);
    const first = Number(ip.split('.')[0]);
    if (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff' || mac.startsWith('01:00:5e') || first >= 224 || ip.endsWith('.255')) continue; // unvollständig, Rundruf, Multicast
    out.set(mac, { ip, mac });
  }
  return [...out.values()];
}

function localNets() {
  return Object.values(networkInterfaces()).flat()
    .filter((i): i is NonNullable<typeof i> => !!i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => {
      const mask = ipToInt(i.netmask), addr = ipToInt(i.address);
      const size = 2 ** 32 - mask;
      const net = addr - (addr % size);
      return { address: i.address, mac: normMac(i.mac), net, size, cidr: `${intToIp(net)}/${32 - Math.log2(size)}` };
    });
}

/** Spricht jede Adresse einmal an (ein leeres UDP-Paket), damit das Betriebssystem die Geräteadresse ermittelt. */
async function probe(nets: ReturnType<typeof localNets>) {
  const sock = createSocket('udp4');
  sock.on('error', () => {});
  await new Promise<void>((r) => sock.bind(0, () => r()));
  for (const n of nets) {
    const hosts = Math.min(n.size - 2, MAX_HOSTS);
    for (let i = 1; i <= hosts; i++) {
      sock.send(Buffer.alloc(0), 9, intToIp(n.net + i), () => {});
      if (i % 64 === 0) await new Promise((r) => setTimeout(r, 30));
    }
  }
  await new Promise((r) => setTimeout(r, 1800));
  sock.close();
}

async function neighborTable(): Promise<string> {
  if (process.platform === 'linux') return readFile('/proc/net/arp', 'utf8').catch(() => '');
  return new Promise((resolve) => execFile('arp', ['-a'], { windowsHide: true, timeout: 10_000 }, (_e, stdout) => resolve(String(stdout ?? ''))));
}

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

let running: Promise<NetScanDto> | null = null;

export function scan(db: Exec): Promise<NetScanDto> {
  running ??= doScan(db).finally(() => { running = null; });
  return running;
}

async function doScan(db: Exec): Promise<NetScanDto> {
  // Auf einem gemieteten Server gehört das umgebende Netz dem Rechenzentrum – dort wird nicht gesucht.
  if (process.env.PMS_HOSTED === 'true') return { scannedAt: new Date().toISOString(), networks: [], devices: [], note: 'Das Programm läuft auf einem Server im Internet. Die Gerätesuche gibt es nur, wenn es auf einem Rechner im Haus läuft.', gateway: null };
  const nets = localNets();
  if (nets.length === 0) return { scannedAt: new Date().toISOString(), networks: [], devices: [], note: 'Dieser Rechner hat gerade keine Netzwerkverbindung.', gateway: null };
  await probe(nets);
  const inNet = (ip: string) => nets.some((n) => { const a = ipToInt(ip); return a > n.net && a < n.net + n.size - 1; });
  const found = parseNeighbors(await neighborTable()).filter((d) => inNet(d.ip));
  for (const n of nets) if (!found.some((d) => d.mac === n.mac)) found.push({ ip: n.address, mac: n.mac });
  const names = new Map((await db.select().from(netDevices)).map((d) => [d.mac, d.name]));
  const devices: NetDeviceDto[] = await Promise.all(found.map(async (d) => ({
    ...d, hostname: (await withTimeout(reverse(d.ip), 1500, [] as string[]))[0] ?? '', name: names.get(d.mac) ?? '',
    self: nets.some((n) => n.mac === d.mac), online: true, randomMac: (parseInt(d.mac.slice(0, 2), 16) & 2) === 2,
  })));
  devices.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
  // benannte Geräte, die gerade nicht antworten (z. B. ausgeschalteter Drucker), ans Ende
  for (const [mac, name] of names) if (!devices.some((d) => d.mac === mac))
    devices.push({ ip: '', mac, hostname: '', name, self: false, online: false, randomMac: (parseInt(mac.slice(0, 2), 16) & 2) === 2 });
  const gw = await gateway();
  const big = nets.some((n) => n.size - 2 > MAX_HOSTS);
  return { scannedAt: new Date().toISOString(), networks: nets.map((n) => n.cidr), devices, note: big ? `Das Netz ist sehr groß – geprüft wurden je Netz die ersten ${MAX_HOSTS} Adressen.` : null, gateway: gw && inNet(gw) ? gw : null };
}

export async function nameDevice(db: Db, actor: Actor, mac: string, name: string) {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) throw new AppError(400, 'validation', 'Ungültige Geräteadresse');
  if (name) await db.insert(netDevices).values({ mac, name }).onConflictDoUpdate({ target: netDevices.mac, set: { name, updatedAt: new Date() } });
  else await db.delete(netDevices).where(eq(netDevices.mac, mac));
  await record(db, actor, { action: 'update', entity: 'net_device', entityId: mac, after: { name } });
}

/** Internetverbindung prüfen: eine kurze Anfrage an die Adresse, die auch das Programm-Update verwendet. */
export async function internetStatus(): Promise<InternetStatusDto> {
  const addresses = localNets().map((n) => n.address);
  const start = Date.now();
  if (await online()) return { online: true, ms: Date.now() - start, checkedAt: new Date().toISOString(), addresses, error: null };
  return { online: false, ms: null, checkedAt: new Date().toISOString(), addresses, error: 'Keine Antwort aus dem Internet innerhalb von 8 Sekunden' };
}

/** Adresse des Routers (Standardgateway) aus der Routentabelle des Betriebssystems. */
export function parseGateway(text: string, linux: boolean): string | null {
  for (const line of text.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (linux) {
      // /proc/net/route: Iface Destination Gateway … (hexadezimal, Bytes in umgekehrter Reihenfolge)
      if (c[1] === '00000000' && c[2] && c[2] !== '00000000') return c[2].match(/../g)!.reverse().map((h) => parseInt(h, 16)).join('.');
    } else if (c[0] === '0.0.0.0' && c[1] === '0.0.0.0' && /^\d+(\.\d+){3}$/.test(c[2] ?? '')) return c[2]!;
  }
  return null;
}
async function gateway(): Promise<string | null> {
  if (process.platform === 'linux') return parseGateway(await readFile('/proc/net/route', 'utf8').catch(() => ''), true);
  return new Promise((resolve) => execFile('route', ['print', '-4', '0.0.0.0'], { windowsHide: true, timeout: 10_000 }, (_e, out) => resolve(parseGateway(String(out ?? ''), false))));
}

// ---------- Gäste-WLAN: Zugangsdaten als QR-Code zum Aushängen ----------
const WIFI_DEFAULT: WifiSettings = { ssid: '', password: '', open: false, note: '' };
const wifiEscape = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');
/** Inhalt des WLAN-QR-Codes, wie ihn Handy-Kameras verstehen. */
export const wifiQrText = (w: WifiSettings) => `WIFI:T:${w.open ? 'nopass' : 'WPA'};S:${wifiEscape(w.ssid)};${w.open ? '' : `P:${wifiEscape(w.password)};`};`;

export async function getWifi(db: Exec): Promise<WifiDto> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'wifi'));
  const w = { ...WIFI_DEFAULT, ...((row?.value as Partial<WifiSettings>) ?? {}) };
  const ready = !!w.ssid && (w.open || !!w.password);
  const qr = ready ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(wifiQrText(w), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })).toString('base64')}` : null;
  return { ...w, qr, hotelName: (await getHotel(db)).name };
}
export async function saveWifi(db: Db, actor: Actor, v: WifiSettings) {
  await db.insert(settings).values({ key: 'wifi', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  // das Passwort selbst gehört nicht ins Änderungsprotokoll
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'wifi', after: { ssid: v.ssid, open: v.open, note: v.note } });
  return getWifi(db);
}

// ---------- Ausfallprotokoll der Internetverbindung ----------
const CHECK_URLS = ['https://api.github.com/zen', 'https://www.cloudflare.com/cdn-cgi/trace'];
const reachable = (url: string) => fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'pms' } }).then(() => true, () => false);
/** Internet gilt als erreichbar, wenn mindestens eine von zwei unabhängigen Adressen antwortet. */
export const online = async () => (await Promise.all((process.env.PMS_ONLINE_CHECK_URL ? [process.env.PMS_ONLINE_CHECK_URL] : CHECK_URLS).map(reachable))).some(Boolean);

let monitoring = false;
/** laufender Ausfall, wie ihn die Überwachung zuletzt gesehen hat (für den Hinweis am Bildschirm) */
let currentOutage: { id: string; startedAt: Date } | null = null;
/** Prüft jede Minute; ein Ausfall wird ab der zweiten fehlgeschlagenen Prüfung in Folge eingetragen (Beginn = erste). */
export function startOutageMonitor(db: Db, check: () => Promise<boolean> = online, everyMs = 60_000) {
  let firstFail: Date | null = null;
  let open: string | null = null;
  const tick = async () => {
    try {
      if (await check()) {
        if (open) await db.update(netOutages).set({ endedAt: new Date() }).where(eq(netOutages.id, open));
        open = null; firstFail = null; currentOutage = null;
      } else if (!firstFail) firstFail = new Date();
      else {
        if (!open) open = (await db.insert(netOutages).values({ startedAt: firstFail }).returning({ id: netOutages.id }))[0]!.id;
        currentOutage = { id: open, startedAt: firstFail };
        await fritzAutoTick(db, currentOutage).catch((e) => console.error('FRITZ!Box automatisch:', e instanceof Error ? e.message : e));
      }
    } catch (e) { console.error('Ausfallprotokoll:', e instanceof Error ? e.message : e); }
  };
  const init = async () => {
    // offene Einträge aus einem früheren Lauf: Ende wurde nicht beobachtet
    await db.update(netOutages).set({ endedAt: new Date(), uncertain: true }).where(isNull(netOutages.endedAt));
    await db.delete(netOutages).where(lt(netOutages.startedAt, new Date(Date.now() - 400 * 86_400_000)));
    monitoring = true;
  };
  void init().catch((e) => console.error('Ausfallprotokoll:', e instanceof Error ? e.message : e));
  if (everyMs > 0) setInterval(() => void tick(), everyMs).unref();
  return tick;
}

export async function listOutages(db: Exec): Promise<NetOutagesDto> {
  const rows = await db.select().from(netOutages).orderBy(desc(netOutages.startedAt)).limit(50);
  return { monitoring, outages: rows.map((r) => ({ id: r.id, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt?.toISOString() ?? null, uncertain: r.uncertain })) };
}

// ---------- FRITZ!Box: Verbindung neu aufbauen oder Box neu starten ----------
interface FritzStored { enabled: boolean; host: string; port: number; user: string; passEnc: string; auto: boolean; autoAfterMin: number }
const FRITZ0: FritzStored = { enabled: false, host: '', port: 49000, user: '', passEnc: '', auto: false, autoAfterMin: 5 };
const hosted = () => process.env.PMS_HOSTED === 'true';
async function fritzLoad(db: Exec): Promise<FritzStored> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'fritzbox'));
  return { ...FRITZ0, ...((row?.value as Partial<FritzStored>) ?? {}) };
}
const fritzDto = (s: FritzStored): FritzSettingsDto => ({ auto: s.auto, autoAfterMin: s.autoAfterMin, enabled: s.enabled, host: s.host, port: s.port, user: s.user, hasPassword: !!s.passEnc, available: !hosted() });
export async function getFritz(db: Exec): Promise<FritzSettingsDto> {
  const s = await fritzLoad(db);
  // Vorschlag für die Adresse: der Router dieses Rechners
  return fritzDto(s.host || hosted() ? s : { ...s, host: (await gateway().catch(() => null)) ?? '' });
}
export async function saveFritz(db: Db, actor: Actor, v: { enabled: boolean; host: string; port: number; user: string; password: string; auto: boolean; autoAfterMin: number }) {
  if (v.host && !isPrivateIp(v.host)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { host: 'Bitte die Adresse der FRITZ!Box im Hausnetz eintragen, z. B. 192.168.178.1' });
  const cur = await fritzLoad(db);
  const next: FritzStored = { auto: v.auto, autoAfterMin: v.autoAfterMin, enabled: v.enabled, host: v.host, port: v.port, user: v.user, passEnc: v.password ? encrypt(v.password) : cur.passEnc };
  await db.insert(settings).values({ key: 'fritzbox', value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'fritzbox', after: fritzDto(next) }); // ohne Kennwort
  return fritzDto(next);
}
async function fritzConfig(db: Exec): Promise<Tr064Config> {
  if (hosted()) throw conflict('Das Programm läuft auf einem Server im Internet – die FRITZ!Box lässt sich nur von einem Rechner im Haus steuern.', 'fritz_unavailable');
  const s = await fritzLoad(db);
  if (!s.enabled || !s.host || !s.passEnc) throw conflict('Die FRITZ!Box ist noch nicht eingerichtet (Internet → Internetverbindung)', 'fritz_not_configured');
  return { host: s.host, port: s.port, user: s.user, password: decrypt(s.passEnc) };
}
const fritzFail = (e: unknown): never => { throw e instanceof AppError ? e : new AppError(502, 'fritz_failed', e instanceof Tr064Error ? e.message : `FRITZ!Box: ${e instanceof Error ? e.message : e}`); };
const WAN = [
  { path: '/upnp/control/wanpppconn1', service: 'urn:dslforum-org:service:WANPPPConnection:1' }, // DSL
  { path: '/upnp/control/wanipconnection1', service: 'urn:dslforum-org:service:WANIPConnection:1' }, // Kabel, Glasfaser, hinter einem Modem
];

/** Modell, Version, Laufzeit und – soweit die Box sie nennt – Zustand der Internetverbindung. Dient auch als Verbindungstest. */
export async function fritzInfo(db: Exec): Promise<FritzInfoDto> {
  try {
    const c = await fritzConfig(db);
    const d = await tr064(c, '/upnp/control/deviceinfo', 'urn:dslforum-org:service:DeviceInfo:1', 'GetInfo');
    let externalIp = '', connection = '';
    for (const w of WAN) {
      try {
        const i = await tr064(c, w.path, w.service, 'GetInfo');
        if (i.NewConnectionStatus) { connection = i.NewConnectionStatus; externalIp = i.NewExternalIPAddress ?? ''; if (connection === 'Connected') break; }
      } catch { /* diese Anschlussart gibt es an der Box nicht */ }
    }
    return { model: d.NewModelName ?? '', version: d.NewSoftwareVersion ?? '', uptimeSec: d.NewUpTime ? Number(d.NewUpTime) : null, externalIp, connection };
  } catch (e) { return fritzFail(e); }
}

/** reconnect = Internetverbindung trennen (die Box baut sie von selbst neu auf); reboot = die ganze Box neu starten (WLAN und Telefon fallen einige Minuten aus). */
export async function fritzAction(db: Db, actor: Actor, action: 'reconnect' | 'reboot') {
  try {
    const c = await fritzConfig(db);
    if (action === 'reboot') await tr064(c, '/upnp/control/deviceconfig', 'urn:dslforum-org:service:DeviceConfig:1', 'Reboot');
    else {
      let done = false, last: unknown = null;
      for (const w of WAN) {
        try { await tr064(c, w.path, w.service, 'ForceTermination'); done = true; break; }
        catch (e) {
          // 707 „DisconnectInProgress“: die Box trennt bereits – das ist der gewünschte Erfolg
          if (e instanceof Tr064Error && e.code === '707') { done = true; break; }
          if (e instanceof Tr064Error && e.status === 401) throw e;
          last = e;
        }
      }
      if (!done) throw last ?? new Tr064Error('Die FRITZ!Box bietet das Trennen der Verbindung nicht an.');
    }
    await record(db, actor, { action: action === 'reboot' ? 'fritz_reboot' : 'fritz_reconnect', entity: 'program', entityId: 'fritzbox', after: { host: c.host } });
    return { ok: true };
  } catch (e) { return fritzFail(e); }
}

// ---------- Automatisches Zurücksetzen bei Ausfall ----------
interface AutoState { outageId: string; reconnectAt?: string; rebootAt?: string; steps: string[]; /** Zeitpunkte automatischer Neustarts der letzten Tage */ reboots: string[] }
const AUTO0: AutoState = { outageId: '', steps: [], reboots: [] };
/** höchstens so viele automatische Neustarts in 24 Stunden – bei einer Störung des Anbieters hilft Neustarten nicht */
const MAX_AUTO_REBOOTS = 2;
const clock = (d: Date) => d.toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

/**
 * Je Ausfall höchstens zwei Schritte: nach der eingestellten Wartezeit die Internetverbindung neu aufbauen und – wenn das Internet
 * danach noch einmal so lange weg bleibt – die Box einmal neu starten. Danach unternimmt das Programm bei diesem Ausfall nichts mehr.
 */
export async function fritzAutoTick(db: Db, outage: { id: string; startedAt: Date }, now = new Date()): Promise<'none' | 'reconnect' | 'reboot'> {
  if (hosted()) return 'none';
  const s = await fritzLoad(db);
  if (!s.enabled || !s.auto || !s.host || !s.passEnc) return 'none';
  const [row] = await db.select().from(settings).where(eq(settings.key, 'fritz_auto'));
  const prev = { ...AUTO0, ...((row?.value as Partial<AutoState>) ?? {}) };
  const st: AutoState = prev.outageId === outage.id ? prev : { outageId: outage.id, steps: [], reboots: prev.reboots };
  const wait = s.autoAfterMin * 60_000;
  const save = () => db.insert(settings).values({ key: 'fritz_auto', value: st }).onConflictDoUpdate({ target: settings.key, set: { value: st, updatedAt: new Date() } });
  const attempt = async (action: 'reconnect' | 'reboot', label: string) => {
    try { await fritzAction(db, SYSTEM, action); st.steps.push(`${clock(now)} Uhr: ${label}`); }
    catch (e) { st.steps.push(`${clock(now)} Uhr: ${label} – fehlgeschlagen (${e instanceof Error ? e.message : 'Fehler'})`); }
  };
  if (!st.reconnectAt) {
    if (now.getTime() - outage.startedAt.getTime() < wait) return 'none';
    st.reconnectAt = now.toISOString();
    await save(); // erst merken, dann handeln: kein zweiter Versuch, falls die Aktion hängt
    await attempt('reconnect', 'Internetverbindung automatisch neu aufgebaut');
    await save();
    return 'reconnect';
  }
  if (!st.rebootAt && now.getTime() - Date.parse(st.reconnectAt) >= wait) {
    st.rebootAt = now.toISOString();
    st.reboots = st.reboots.filter((t) => now.getTime() - Date.parse(t) < 86_400_000);
    if (st.reboots.length >= MAX_AUTO_REBOOTS) {
      st.steps.push(`${clock(now)} Uhr: kein weiterer automatischer Neustart (schon ${MAX_AUTO_REBOOTS} in 24 Stunden) – bitte den Anbieter prüfen`);
      await save();
      return 'none';
    }
    st.reboots.push(now.toISOString());
    await save();
    await attempt('reboot', 'FRITZ!Box automatisch neu gestartet');
    await save();
    return 'reboot';
  }
  return 'none';
}

/** Für den Hinweis am Bildschirm: läuft gerade ein Ausfall, seit wann, und was wurde automatisch unternommen? */
export async function netAlert(db: Exec): Promise<NetAlertDto> {
  if (hosted() || !currentOutage) return { offline: false, since: null, steps: [] };
  const [row] = await db.select().from(settings).where(eq(settings.key, 'fritz_auto'));
  const st = row?.value as Partial<AutoState> | undefined;
  return { offline: true, since: currentOutage.startedAt.toISOString(), steps: st?.outageId === currentOutage.id ? st.steps ?? [] : [] };
}
