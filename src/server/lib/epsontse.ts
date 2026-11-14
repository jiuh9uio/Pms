import { connect } from 'node:net';

/**
 * Epson-TSE (USB-Stick oder microSD) über die lokale ePOS-Device-XML-Schnittstelle des „Epson TSE Driver“ (Windows)
 * bzw. eines Epson-Druckers/TSE-Servers: TCP-Port 8009, XML-Nachrichten jeweils mit einem NUL-Byte abgeschlossen.
 *
 * Ablauf nach Epsons Handbüchern (ePOS-Device XML User's Manual; Germany Fiscal Element JSON Specification):
 * Server sendet <connect> → <open_device> local_TSE / type_storage → je Befehl <device_data> mit <type>operate</type>
 * und JSON in <requestdata> → Antwort <type>operateresult</type> mit JSON in <resultdata> → <close_device>.
 *
 * Hier werden nur Befehle ohne Anmeldung verwendet (Rolle „-“): Sie lesen Informationen oder führen den Selbsttest aus,
 * schreiben aber keine Vorgänge und verbrauchen keine PIN-Versuche.
 */
export interface TseCall { fn: string; input?: Record<string, unknown>; /** COMMON nur für GetStorageInfo erlaubt */ storageType?: 'TSE' | 'COMMON'; vendor?: string; /** weitere Schreibweisen, falls die Schnittstelle `vendor` ablehnt */ altVendors?: string[]; timeoutMs?: number }
export interface TseReply { fn: string; result: string; output: Record<string, unknown>; error?: { fact?: string; errorinfo?: string } }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() ?? null;

export const openDevice = '<open_device><device_id>local_TSE</device_id><data><type>type_storage</type></data></open_device>';
export const closeDevice = '<close_device><device_id>local_TSE</device_id></close_device>';
export function operate(c: TseCall): string {
  const json = JSON.stringify({ storage: { type: c.storageType ?? 'TSE', vendor: c.vendor ?? '' }, function: c.fn, input: c.input ?? {}, compress: { required: false, type: '' } });
  return `<device_data><device_id>local_TSE</device_id><data><type>operate</type><timeout>${Math.min(120000, Math.max(100, c.timeoutMs ?? 10000))}</timeout><requestdata>${esc(json)}</requestdata></data></device_data>`;
}
export function parseOperateResult(xml: string, fn: string): TseReply {
  const raw = tag(xml, 'resultdata');
  if (!raw) {
    const code = tag(xml, 'code') ?? 'keine Antwortdaten';
    return { fn, result: `ERROR_${code}`, output: {}, error: { fact: `Die Schnittstelle meldet: ${code}` } };
  }
  try {
    const j = JSON.parse(unesc(raw)) as { result?: string; output?: Record<string, unknown>; error?: TseReply['error'] };
    return { fn, result: j.result ?? 'ERROR_UNBEKANNT', output: (j.output && typeof j.output === 'object' ? j.output : {}) as Record<string, unknown>, error: j.error };
  } catch { return { fn, result: 'ERROR_ANTWORT_UNLESBAR', output: {}, error: { fact: raw.slice(0, 200) } }; }
}

export class TseError extends Error {}

/** Führt die Befehle der Reihe nach aus. `calls` darf auf frühere Antworten zugreifen (z. B. den Modellnamen). */
export function tseSession(host: string, port: number, calls: (TseCall | ((prev: TseReply[]) => TseCall | null))[], connectTimeoutMs = 6000): Promise<TseReply[]> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    const replies: TseReply[] = [];
    let buf = '';
    let step: 'hello' | 'open' | 'run' | 'close' = 'hello';
    let index = 0;
    let current: TseCall | null = null;
    let timer: NodeJS.Timeout | null = null;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(replies);
    };
    const arm = (ms: number, what: string) => { if (timer) clearTimeout(timer); timer = setTimeout(() => finish(new TseError(`Zeitüberschreitung: ${what}`)), ms); };
    const send = (xml: string) => sock.write(xml + '\0');
    const next = () => {
      for (;;) {
        const c = calls[index];
        if (c === undefined) { step = 'close'; arm(5000, 'Schließen der TSE-Verbindung'); send(closeDevice); return; }
        current = typeof c === 'function' ? c(replies) : c;
        if (current) break;
        index++; // Befehl entfällt (z. B. weil eine Voraussetzung fehlt)
      }
      arm((current.timeoutMs ?? 10000) + 5000, `keine Antwort auf ${current.fn}`);
      send(operate(current));
    };
    arm(connectTimeoutMs, `Die TSE-Schnittstelle ${host}:${port} antwortet nicht`);
    sock.on('error', (e: NodeJS.ErrnoException) => finish(new TseError(
      e.code === 'ECONNREFUSED' ? `Unter ${host}:${port} läuft keine TSE-Schnittstelle. Ist der „Epson TSE Driver“ installiert und gestartet und steckt der Stick?`
        : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `${host} ist im Netz nicht erreichbar.` : `Verbindung zur TSE-Schnittstelle gestört (${e.code ?? e.message}).`)));
    sock.on('close', () => finish(step === 'close' ? undefined : new TseError('Die TSE-Schnittstelle hat die Verbindung getrennt.')));
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      for (;;) {
        const end = buf.indexOf('\0');
        if (end < 0) break;
        const msg = buf.slice(0, end);
        buf = buf.slice(end + 1);
        if (step === 'hello' && msg.includes('<connect>')) { step = 'open'; arm(8000, 'Öffnen der TSE'); send(openDevice); }
        else if (step === 'open' && msg.includes('<open_device>')) {
          const code = tag(msg, 'code');
          if (code !== 'OK') {
            finish(new TseError(code === 'DEVICE_NOT_FOUND' ? 'Die Schnittstelle findet keine TSE (kein Stick gesteckt oder nicht erkannt).'
              : code === 'DEVICE_IN_USE' ? 'Die TSE wird gerade von einem anderen Programm verwendet (z. B. der Kassensoftware).' : `Die TSE lässt sich nicht öffnen (${code ?? 'unbekannter Fehler'}).`));
            return;
          }
          step = 'run';
          next();
        } else if (step === 'run' && msg.includes('<device_data>') && current) {
          const reply = parseOperateResult(msg, current.fn);
          const alt = current.altVendors?.find((x) => x !== current!.vendor);
          if (reply.result === 'JSON_ERROR_UNEXPECTED_STORAGE_VENDOR' && alt !== undefined) {
            // andere Schreibweise des Herstellerkürzels versuchen
            current = { ...current, vendor: alt, altVendors: current.altVendors!.filter((x) => x !== alt && x !== current!.vendor) };
            arm((current.timeoutMs ?? 10000) + 5000, `keine Antwort auf ${current.fn}`);
            send(operate(current));
            continue;
          }
          replies.push(reply);
          index++;
          next();
        } else if (step === 'close' && msg.includes('<close_device>')) finish();
      }
    });
  });
}
