import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { reverse } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { eq } from 'drizzle-orm';
import type { NetDeviceDto, NetScanDto } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { netDevices } from '../db/schema.js';
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
  if (nets.length === 0) return { scannedAt: new Date().toISOString(), networks: [], devices: [], note: 'Dieser Rechner hat gerade keine Netzwerkverbindung.' };
  await probe(nets);
  const inNet = (ip: string) => nets.some((n) => { const a = ipToInt(ip); return a > n.net && a < n.net + n.size - 1; });
  const found = parseNeighbors(await neighborTable()).filter((d) => inNet(d.ip));
  for (const n of nets) if (!found.some((d) => d.mac === n.mac)) found.push({ ip: n.address, mac: n.mac });
  const names = new Map((await db.select().from(netDevices)).map((d) => [d.mac, d.name]));
  const devices: NetDeviceDto[] = await Promise.all(found.map(async (d) => ({
    ...d, hostname: (await withTimeout(reverse(d.ip), 1500, [] as string[]))[0] ?? '', name: names.get(d.mac) ?? '',
    self: nets.some((n) => n.mac === d.mac), randomMac: (parseInt(d.mac.slice(0, 2), 16) & 2) === 2,
  })));
  devices.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
  const big = nets.some((n) => n.size - 2 > MAX_HOSTS);
  return { scannedAt: new Date().toISOString(), networks: nets.map((n) => n.cidr), devices, note: big ? `Das Netz ist sehr groß – geprüft wurden je Netz die ersten ${MAX_HOSTS} Adressen.` : null };
}

export async function nameDevice(db: Db, actor: Actor, mac: string, name: string) {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) throw new AppError(400, 'validation', 'Ungültige Geräteadresse');
  if (name) await db.insert(netDevices).values({ mac, name }).onConflictDoUpdate({ target: netDevices.mac, set: { name, updatedAt: new Date() } });
  else await db.delete(netDevices).where(eq(netDevices.mac, mac));
  await record(db, actor, { action: 'update', entity: 'net_device', entityId: mac, after: { name } });
}
