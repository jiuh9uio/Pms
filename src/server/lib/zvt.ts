import { connect, type Socket } from 'node:net';

/**
 * Kartenzahlung über ein EC-Gerät mit ZVT-Kassenschnittstelle im Netzwerk (TCP, üblich Port 20007).
 *
 * Ablauf: Anmeldung (06 00) → Autorisierung mit Betrag (06 01) → das Gerät meldet Zwischenstände (04 FF),
 * das Ergebnis (04 0F, Feld 27 = Ergebniscode) und schließt mit „Abschluss“ (06 0F) oder „Abbruch“ (06 1E).
 * Jede Nachricht des Geräts wird mit 80 00 00 bestätigt.
 *
 * Als bezahlt gilt eine Zahlung nur, wenn das Gerät Ergebniscode 00 UND den Abschluss gemeldet hat.
 * Reißt die Verbindung nach dem Senden des Betrags ab, ist der Ausgang unbekannt – das muss am Gerät geprüft werden.
 *
 * Nach dem öffentlichen ZVT-Protokoll umgesetzt und gegen ein simuliertes Gerät getestet, nicht gegen ein echtes.
 */

export type ZvtOutcome = 'approved' | 'declined' | 'unknown';
export interface ZvtResult {
  outcome: ZvtOutcome; message: string; resultCode: number | null;
  /** Angaben des Geräts zur Zahlung, soweit gemeldet */
  trace: string; receiptNo: string; cardName: string; terminalId: string; amountCents: number | null;
}
export interface ZvtOptions { host: string; port: number; password: string; timeoutMs?: number; onStatus?: (code: number) => void }

const ACK = Buffer.from([0x80, 0x00, 0x00]);
const bcd = (digits: string) => Buffer.from(digits.match(/../g)!.map((p) => parseInt(p, 16)));
const fromBcd = (b: Buffer) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export function apdu(cls: number, instr: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = data.length < 0xff ? Buffer.from([cls, instr, data.length]) : Buffer.from([cls, instr, 0xff, data.length & 0xff, data.length >> 8]);
  return Buffer.concat([head, data]);
}
/** Anmeldung: Passwort (6 Ziffern), Konfigurationsbyte 0x08 (Zwischenstände erwünscht, Belege druckt das Gerät), Währung EUR. */
export const registration = (password: string) => apdu(0x06, 0x00, Buffer.concat([bcd(password), Buffer.from([0x08, 0x09, 0x78])]));
/** Autorisierung: Feld 04 = Betrag in Cent (12 Ziffern), Feld 49 = Währung EUR (0978). */
export const authorization = (amountCents: number) =>
  apdu(0x06, 0x01, Buffer.concat([Buffer.from([0x04]), bcd(String(amountCents).padStart(12, '0')), Buffer.from([0x49, 0x09, 0x78])]));

/** Nimmt vollständige Nachrichten vom Anfang des Puffers; der Rest bleibt für später. */
export function splitApdus(buf: Buffer): { apdus: { cls: number; instr: number; data: Buffer }[]; rest: Buffer } {
  const out = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 3) break;
    let len = buf[off + 2]!, head = 3;
    if (len === 0xff) { if (buf.length - off < 5) break; len = buf.readUInt16LE(off + 3); head = 5; }
    if (buf.length - off < head + len) break;
    out.push({ cls: buf[off]!, instr: buf[off + 1]!, data: buf.subarray(off + head, off + head + len) });
    off += head + len;
  }
  return { apdus: out, rest: buf.subarray(off) };
}

// feste Feldlängen der Statusinformation; LL/LLL = Länge steht davor (je Ziffer ein Byte Fx)
const FIXED: Record<number, number> = { 0x01: 1, 0x02: 1, 0x03: 1, 0x04: 6, 0x05: 1, 0x0b: 3, 0x0c: 3, 0x0d: 2, 0x0e: 2, 0x17: 2, 0x19: 1, 0x27: 1, 0x29: 4, 0x2a: 15, 0x3a: 2, 0x3b: 8, 0x49: 2, 0x87: 2, 0x88: 3, 0x8a: 1, 0x8c: 1, 0x92: 1 };
const LLVAR = new Set([0x22, 0x23, 0x2d, 0x2e, 0x8b]);
const LLLVAR = new Set([0x24, 0x3c, 0x3d, 0x60, 0x9a, 0xa0, 0xaf]);

/** Liest die Felder einer Statusinformation; bei einem unbekannten Feld wird aufgehört (das Bisherige bleibt gültig). */
export function parseStatus(data: Buffer): Partial<Pick<ZvtResult, 'trace' | 'receiptNo' | 'cardName' | 'terminalId' | 'amountCents'>> & { resultCode?: number } {
  const r: ReturnType<typeof parseStatus> = {};
  let i = 0;
  while (i < data.length) {
    const tag = data[i++]!;
    let len: number;
    if (FIXED[tag] !== undefined) len = FIXED[tag]!;
    else if (LLVAR.has(tag)) { if (i + 2 > data.length) break; len = (data[i]! & 0x0f) * 10 + (data[i + 1]! & 0x0f); i += 2; }
    else if (LLLVAR.has(tag)) { if (i + 3 > data.length) break; len = (data[i]! & 0x0f) * 100 + (data[i + 1]! & 0x0f) * 10 + (data[i + 2]! & 0x0f); i += 3; }
    else break; // unbekanntes Feld oder TLV-Container (06)
    if (i + len > data.length) break;
    const v = data.subarray(i, i + len);
    i += len;
    if (tag === 0x27) r.resultCode = v[0]!;
    else if (tag === 0x04) r.amountCents = Number(fromBcd(v));
    else if (tag === 0x0b) r.trace = fromBcd(v);
    else if (tag === 0x87) r.receiptNo = fromBcd(v);
    else if (tag === 0x29) r.terminalId = fromBcd(v);
    else if (tag === 0x8b) r.cardName = v.toString('latin1').replace(/\0+$/, '').trim();
  }
  return r;
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
export function resultText(code: number): string {
  if (code === 0x00) return 'Zahlung erfolgreich';
  if (code === 0x6c) return 'Vorgang am Gerät abgebrochen (Abbruch-Taste oder Zeitüberschreitung)';
  if (code === 0x64) return 'Karte nicht lesbar';
  return `Zahlung nicht durchgeführt – das Gerät meldet Code ${hex(code)} (Näheres zeigt das Gerät bzw. sein Beleg)`;
}

const EMPTY = { trace: '', receiptNo: '', cardName: '', terminalId: '', amountCents: null };

/**
 * Führt Anmeldung und – wenn amountCents angegeben – eine Zahlung durch. Ohne Betrag wird nur die Verbindung geprüft.
 */
export function zvtRun(o: ZvtOptions, amountCents: number | null): Promise<ZvtResult> {
  return new Promise((resolve) => {
    let phase: 'connect' | 'register' | 'pay' = 'connect';
    let buf: Buffer = Buffer.alloc(0);
    let status: ReturnType<typeof parseStatus> = {};
    let done = false;
    const sock: Socket = connect({ host: o.host, port: o.port });
    const finish = (outcome: ZvtOutcome, message: string, resultCode: number | null = status.resultCode ?? null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ ...EMPTY, ...status, outcome, message, resultCode });
    };
    /** Ausgang ungewiss, sobald der Betrag ans Gerät gesendet wurde. */
    const broken = (why: string) => (phase === 'pay'
      ? finish('unknown', `${why} Ob die Zahlung durchgeführt wurde, ist unklar – bitte am EC-Gerät oder auf dessen Beleg prüfen, bevor erneut kassiert wird.`)
      : finish('declined', `${why} Es wurde nichts abgebucht.`));
    const timer = setTimeout(() => broken(phase === 'connect' ? `Das EC-Gerät ${o.host} antwortet nicht.` : 'Zeitüberschreitung beim EC-Gerät.'), o.timeoutMs ?? 180_000);
    sock.setTimeout(phase === 'connect' ? 8000 : 0);
    sock.on('timeout', () => { if (phase === 'connect') broken(`Das EC-Gerät ${o.host} ist nicht erreichbar (Zeitüberschreitung).`); });
    sock.on('error', (e: NodeJS.ErrnoException) => broken(
      e.code === 'ECONNREFUSED' ? `Das EC-Gerät ${o.host} nimmt auf Port ${o.port} keine Verbindung an (Kassenschnittstelle ZVT aktiv? Port richtig?).`
        : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `Das EC-Gerät ${o.host} ist im Netz nicht erreichbar.` : `Verbindung zum EC-Gerät gestört (${e.code ?? e.message}).`));
    sock.on('close', () => broken('Die Verbindung zum EC-Gerät wurde getrennt.'));
    sock.on('connect', () => { sock.setTimeout(0); phase = 'register'; sock.write(registration(o.password)); });
    sock.on('data', (chunk: Buffer) => {
      const split = splitApdus(Buffer.concat([buf, chunk]));
      buf = split.rest;
      for (const m of split.apdus) {
        if (done) return;
        const code = (m.cls << 8) | m.instr;
        if (m.cls === 0x80) continue; // Bestätigung unseres Kommandos
        if (m.cls === 0x84) { finish('declined', phase === 'register' ? `Das EC-Gerät lehnt die Anmeldung ab (Code ${hex(m.instr)}) – Passwort der Kassenschnittstelle prüfen. Es wurde nichts abgebucht.` : `Das EC-Gerät lehnt den Auftrag ab (Code ${hex(m.instr)}). Es wurde nichts abgebucht.`, m.instr); return; }
        sock.write(ACK);
        if (code === 0x04ff) o.onStatus?.(m.data[0] ?? 0);
        else if (code === 0x040f) status = { ...status, ...parseStatus(m.data) };
        else if (code === 0x061e) { // Abbruch
          const rc = m.data[0] ?? status.resultCode ?? 0xff;
          finish('declined', phase === 'register' ? `Das EC-Gerät hat die Anmeldung abgebrochen (Code ${hex(rc)}). Es wurde nichts abgebucht.` : `${resultText(rc === 0 ? 0xff : rc)}. Es wurde nichts abgebucht.`, rc);
          return;
        } else if (code === 0x060f) { // Abschluss
          if (phase === 'register') {
            if (amountCents === null) { finish('approved', 'Verbindung zum EC-Gerät steht.', null); return; }
            status = {};
            phase = 'pay';
            sock.write(authorization(amountCents));
          } else if (status.resultCode === 0x00) {
            if (status.amountCents != null && status.amountCents !== amountCents) finish('unknown', `Das EC-Gerät meldet einen anderen Betrag (${(status.amountCents / 100).toFixed(2)} €) als angefordert. Bitte am Gerät prüfen.`);
            else finish('approved', 'Zahlung erfolgreich');
            return;
          } else {
            finish(status.resultCode === undefined ? 'unknown' : 'declined',
              status.resultCode === undefined ? 'Das EC-Gerät hat den Vorgang ohne Ergebnis abgeschlossen – bitte am Gerät oder auf dessen Beleg prüfen, ob gezahlt wurde.' : `${resultText(status.resultCode)}. Es wurde nichts abgebucht.`);
            return;
          }
        }
        // Druckzeilen (06 D1 / 06 D3) und Sonstiges: nur bestätigen
      }
    });
  });
}
