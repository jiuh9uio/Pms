import { connect } from 'node:net';

/**
 * Druck auf Epson-Bondruckern (und kompatiblen) im Netzwerk: ESC/POS-Befehle über TCP, üblicherweise Port 9100.
 * Text wird in der Zeichentabelle CP858 gesendet (Umlaute, ß, €); unbekannte Zeichen werden vereinfacht oder durch „?“ ersetzt.
 */

const CP858: Record<string, number> = {
  'ä': 0x84, 'ö': 0x94, 'ü': 0x81, 'Ä': 0x8e, 'Ö': 0x99, 'Ü': 0x9a, 'ß': 0xe1, '€': 0xd5, 'é': 0x82, 'è': 0x8a, 'ê': 0x88, 'à': 0x85, 'á': 0xa0, 'â': 0x83,
  'ç': 0x87, 'ñ': 0xa4, 'ó': 0xa2, 'ô': 0x93, 'ú': 0xa3, 'í': 0xa1, 'É': 0x90, '°': 0xf8, '·': 0xfa, '×': 0x9e, '–': 0x2d, '—': 0x2d, '„': 0x22, '“': 0x22, '”': 0x22, '‚': 0x27, '’': 0x27, '…': 0x2e,
};
export function encodeCp858(text: string): Buffer {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 0x0a || (code >= 0x20 && code < 0x7f)) out.push(code);
    else if (CP858[ch] !== undefined) out.push(CP858[ch]!);
    else {
      const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out.push(plain.length === 1 && plain.charCodeAt(0) < 0x7f && plain.charCodeAt(0) >= 0x20 ? plain.charCodeAt(0) : 0x3f);
    }
  }
  return Buffer.from(out);
}

export type Line = { text: string; align?: 'left' | 'center'; bold?: boolean; big?: boolean } | { rule: true } | { feed: number };

/** Baut den Druckauftrag: Initialisieren, Zeichentabelle, Zeilen, Vorschub, Schnitt. */
export function buildJob(lines: Line[], width: number): Buffer {
  const ESC = 0x1b, GS = 0x1d;
  const parts: Buffer[] = [Buffer.from([ESC, 0x40, ESC, 0x74, 19])]; // ESC @, ESC t 19 (CP858)
  for (const l of lines) {
    if ('rule' in l) parts.push(encodeCp858('-'.repeat(width) + '\n'));
    else if ('feed' in l) parts.push(Buffer.from([ESC, 0x64, Math.min(10, Math.max(0, l.feed))]));
    else {
      parts.push(Buffer.from([ESC, 0x61, l.align === 'center' ? 1 : 0, ESC, 0x45, l.bold ? 1 : 0, GS, 0x21, l.big ? 0x11 : 0x00]));
      parts.push(encodeCp858(l.text + '\n'));
    }
  }
  parts.push(Buffer.from([ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x64, 4, GS, 0x56, 66, 0])); // zurücksetzen, Vorschub, Teilschnitt
  return Buffer.concat(parts);
}

/** Zwei Spalten in einer Zeile: links Text, rechts bündig. */
export const columns = (left: string, right: string, width: number) => {
  const space = width - right.length - 1;
  const l = left.length > space ? left.slice(0, Math.max(0, space - 1)) + '.' : left;
  return l + ' '.repeat(Math.max(1, width - l.length - right.length)) + right;
};

/** Nur Adressen im eigenen Netz (private Bereiche) – der Drucker steht im Haus. */
export const isPrivateIp = (ip: string) => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m || m.slice(1).some((p) => Number(p) > 255)) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
};

export function sendToPrinter(host: string, port: number, data: Buffer, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    const fail = (message: string) => { sock.destroy(); reject(new Error(message)); };
    sock.setTimeout(timeoutMs, () => fail(`Der Drucker ${host} antwortet nicht (Zeitüberschreitung). Ist er eingeschaltet und im Netz?`));
    sock.on('error', (e: NodeJS.ErrnoException) => fail(
      e.code === 'ECONNREFUSED' ? `Der Drucker ${host} nimmt auf Port ${port} keine Verbindung an` :
      e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `Der Drucker ${host} ist im Netz nicht erreichbar` : `Druckfehler: ${e.message}`));
    sock.on('connect', () => sock.end(data));
    sock.on('close', (hadError) => { if (!hadError) resolve(); });
  });
}
