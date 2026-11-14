import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Seiten aus dem Internet abrufen, ohne dass sich das Programm als Sprungbrett ins eigene Netz missbrauchen lässt:
 * nur http/https, keine Adressen im Hausnetz oder auf diesem Rechner (auch nicht über Weiterleitungen), begrenzte Größe und Zeit.
 */
export class FetchBlocked extends Error {}
const privateV4 = (ip: string) => {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};
const privateIp = (ip: string) => (isIP(ip) === 4 ? privateV4(ip) : /^(::1|::|fc|fd|fe80|::ffff:)/i.test(ip));

async function check(url: URL, allowPrivate: boolean) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlocked('Nur Adressen mit http:// oder https:// sind möglich.');
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new FetchBlocked(`Die Adresse „${host}“ wurde nicht gefunden.`); })).map((x) => x.address);
  if (!ips.length || ips.some(privateIp)) throw new FetchBlocked('Diese Adresse liegt im eigenen Netz und wird nicht abgerufen.');
}

export interface FetchedPage { url: string; contentType: string; text: string }
export async function fetchPublic(raw: string, o: { allowPrivate?: boolean; maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<FetchedPage> {
  let url = new URL(raw);
  const signal = AbortSignal.timeout(o.timeoutMs ?? 12_000), max = o.maxBytes ?? 1_500_000;
  for (let hop = 0; hop < 5; hop++) {
    await check(url, !!o.allowPrivate);
    const res = await fetch(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'SchuetzenhausPMS (Adressabfrage)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'de', ...o.headers } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location')!, url); await res.arrayBuffer().catch(() => {}); continue; }
    if (!res.ok) throw new FetchBlocked(`Die Seite antwortet mit Fehler ${res.status}.`);
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) { await reader.cancel().catch(() => {}); break; }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    const type = res.headers.get('content-type') ?? '';
    const charset = /charset=([\w-]+)/i.exec(type)?.[1] ?? (/<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 2000).toString('latin1'))?.[1] ?? 'utf-8');
    let text: string;
    try { text = new TextDecoder(charset).decode(buf); } catch { text = buf.toString('utf8'); }
    return { url: url.toString(), contentType: type, text };
  }
  throw new FetchBlocked('Zu viele Weiterleitungen.');
}
