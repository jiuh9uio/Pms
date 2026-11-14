import { createHash, randomBytes } from 'node:crypto';

/**
 * TR-064: die Steuerschnittstelle der FRITZ!Box im Hausnetz (SOAP über HTTP, Port 49000, Anmeldung per HTTP-Digest).
 * Dienste und Aktionen nach der AVM-Schnittstellenbeschreibung („TR-064 – First Steps“, deviceconfigSCPD, wanpppconnSCPD, wanipconnSCPD).
 * Das Kennwort wird dabei nie im Klartext übertragen.
 */
export interface Tr064Config { host: string; port: number; user: string; password: string }
export class Tr064Error extends Error { constructor(message: string, public status = 0, public code = '') { super(message); } }

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const param = (h: string, k: string) => new RegExp(`${k}="?([^",]+)"?`, 'i').exec(h)?.[1] ?? '';

/** Antwortkopf für die Digest-Anmeldung (RFC 2617, qop=auth). */
export function digestHeader(www: string, method: string, path: string, user: string, password: string, cnonce = randomBytes(8).toString('hex')) {
  const realm = param(www, 'realm'), nonce = param(www, 'nonce'), qop = /qop="?[^",]*auth/i.test(www) ? 'auth' : '', opaque = param(www, 'opaque');
  const ha1 = md5(`${user}:${realm}:${password}`), ha2 = md5(`${method}:${path}`);
  const nc = '00000001';
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  return `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${response}"${qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : ''}${opaque ? `, opaque="${opaque}"` : ''}`;
}

/** Ruft eine Aktion auf und liefert die Ausgabewerte (New…) der Antwort. */
export async function tr064(c: Tr064Config, path: string, service: string, action: string, timeoutMs = 10_000): Promise<Record<string, string>> {
  const url = `http://${c.host}:${c.port}${path}`;
  const body = `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${service}"/></s:Body></s:Envelope>`;
  const headers: Record<string, string> = { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${service}#${action}"` };
  const post = (extra: Record<string, string> = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body, signal: AbortSignal.timeout(timeoutMs) });
  let res: Response;
  try {
    res = await post();
    if (res.status === 401) {
      const www = res.headers.get('www-authenticate') ?? '';
      await res.arrayBuffer().catch(() => {});
      if (!/digest/i.test(www)) throw new Tr064Error('Die FRITZ!Box verlangt eine Anmeldung, die das Programm nicht kennt.', 401);
      res = await post({ Authorization: digestHeader(www, 'POST', path, c.user, c.password) });
    }
  } catch (e) {
    if (e instanceof Tr064Error) throw e;
    const x = e as { name?: string; cause?: { code?: string } };
    throw new Tr064Error(x.name === 'TimeoutError' ? `Die FRITZ!Box unter ${c.host} antwortet nicht.` : `Die FRITZ!Box unter ${c.host} ist nicht erreichbar (${x.cause?.code ?? 'Verbindung fehlgeschlagen'}).`);
  }
  const text = await res.text();
  if (res.status === 401) throw new Tr064Error('Anmeldung an der FRITZ!Box abgelehnt. Bitte Benutzername und Kennwort prüfen; der Benutzer braucht das Recht „FRITZ!Box Einstellungen“.', 401);
  if (!res.ok) {
    const code = /<errorCode>(\d+)<\/errorCode>/.exec(text)?.[1] ?? '';
    const desc = /<errorDescription>([^<]*)<\/errorDescription>/.exec(text)?.[1] ?? '';
    throw new Tr064Error(res.status === 404 ? 'Die FRITZ!Box kennt diese Funktion nicht. Ist unter Heimnetz → Netzwerk → Netzwerkeinstellungen „Zugriff für Anwendungen zulassen“ eingeschaltet?'
      : `Die FRITZ!Box hat die Aktion abgelehnt (${[res.status, code, desc].filter(Boolean).join(' ')}).`, res.status, code);
  }
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/<(New[A-Za-z0-9_-]+)>([^<]*)<\/\1>/g)) out[m[1]!] = m[2]!;
  return out;
}
