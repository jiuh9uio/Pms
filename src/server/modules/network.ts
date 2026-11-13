import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { reverse } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { desc, eq, isNull, lt } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { InternetStatusDto, NetDeviceDto, NetOutagesDto, NetScanDto, WifiDto, WifiSettings } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { netDevices, netOutages, settings } from '../db/schema.js';
import { getHotel } from './settings.js';
import { AppError } from '../lib/errors.js';
import { record, type Actor } from './audit.js';

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
/** Prüft alle zwei Minuten; ein Ausfall wird ab der zweiten fehlgeschlagenen Prüfung in Folge eingetragen (Beginn = erste). */
export function startOutageMonitor(db: Db, check: () => Promise<boolean> = online, everyMs = 120_000) {
  let firstFail: Date | null = null;
  let open: string | null = null;
  const tick = async () => {
    try {
      if (await check()) {
        if (open) await db.update(netOutages).set({ endedAt: new Date() }).where(eq(netOutages.id, open));
        open = null; firstFail = null;
      } else if (!firstFail) firstFail = new Date();
      else if (!open) open = (await db.insert(netOutages).values({ startedAt: firstFail }).returning({ id: netOutages.id }))[0]!.id;
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
