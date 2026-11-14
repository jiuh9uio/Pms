import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { imapFetch } from '../src/server/modules/inbox.js';

/** Sehr kleiner IMAP-Server (ohne TLS): gerade genug für Anmelden, Ordner nur lesend öffnen, Suchen, Abholen, Abmelden. */
const MAILS: Record<number, string> = {
  7: 'From: A <a@example.com>\r\nSubject: Eins\r\n\r\nHallo eins\r\n',
  9: 'From: B <b@example.com>\r\nSubject: Zwei\r\n\r\nHallo zwei\r\n',
};
const log: string[] = [];
let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((sock) => {
    sock.on('error', () => {});
    sock.write('* OK IMAP4rev1 bereit\r\n');
    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      for (;;) {
        const end = buf.indexOf('\r\n');
        if (end < 0) break;
        const line = buf.slice(0, end);
        buf = buf.slice(end + 2);
        const [tag, ...rest] = line.split(' ');
        const cmd = rest.join(' ');
        const up = cmd.toUpperCase();
        log.push(up.startsWith('LOGIN') ? 'LOGIN' : cmd);
        const ok = (extra = '') => sock.write(`${extra}${tag} OK fertig\r\n`);
        if (up.startsWith('CAPABILITY')) ok('* CAPABILITY IMAP4rev1\r\n');
        else if (up.startsWith('LOGIN')) cmd.includes('geheim') ? ok() : sock.write(`${tag} NO [AUTHENTICATIONFAILED] falsches Passwort\r\n`);
        else if (up.startsWith('AUTHENTICATE')) sock.write(`${tag} NO nicht unterstützt\r\n`);
        else if (up.startsWith('EXAMINE') || up.startsWith('SELECT')) sock.write(`* 2 EXISTS\r\n* 0 RECENT\r\n* FLAGS (\\Seen)\r\n* OK [PERMANENTFLAGS ()] keine\r\n* OK [UIDVALIDITY 4711] gültig\r\n* OK [UIDNEXT 10] nächste\r\n${tag} OK [${up.startsWith('EXAMINE') ? 'READ-ONLY' : 'READ-WRITE'}] geöffnet\r\n`);
        else if (up.startsWith('UID SEARCH')) ok(`* SEARCH ${up.includes('UID 8:*') ? '9' : '7 9'}\r\n`);
        else if (up.startsWith('UID FETCH')) {
          const uids = cmd.split(' ')[2]!.split(',').map(Number);
          let out = '';
          uids.forEach((uid, i) => { const m = MAILS[uid]!; out += `* ${i + 1} FETCH (UID ${uid} INTERNALDATE "14-Nov-2026 09:00:00 +0100" BODY[] {${Buffer.byteLength(m)}}\r\n${m})\r\n`; });
          ok(out);
        } else if (up.startsWith('LOGOUT')) { sock.write(`* BYE tschüss\r\n${tag} OK fertig\r\n`); sock.end(); }
        else ok(); // NOOP, ID, NAMESPACE, ENABLE …
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { server.close(); });

describe('IMAP-Abruf', () => {
  const cfg = () => ({ host: '127.0.0.1', port, user: 'info@example.org', pass: 'geheim', folder: 'INBOX' });
  it('öffnet den Ordner nur lesend und holt die Nachrichten im Original', async () => {
    const r = await imapFetch(cfg(), { uidValidity: '', lastUid: 0 }).catch((e) => { console.log(log); throw e; });
    expect(r.uidValidity).toBe('4711');
    expect(r.mails.map((m) => [m.uid, m.source.toString().includes(m.uid === 7 ? 'Hallo eins' : 'Hallo zwei')])).toEqual([[7, true], [9, true]]);
    expect(log.some((l) => /^EXAMINE/i.test(l))).toBe(true);
    expect(log.some((l) => /^(SELECT|STORE|UID STORE|EXPUNGE|UID MOVE|UID COPY|APPEND|DELETE)/i.test(l))).toBe(false); // nichts wird verändert
    expect(log.find((l) => /UID FETCH/i.test(l))).toMatch(/BODY\.PEEK\[\]/i); // nicht als gelesen markieren
  });
  it('holt danach nur noch neuere Nachrichten', async () => {
    const r = await imapFetch(cfg(), { uidValidity: '4711', lastUid: 7 });
    expect(r.mails.map((m) => m.uid)).toEqual([9]);
  });
  it('meldet ein falsches Passwort', async () => {
    await expect(imapFetch({ ...cfg(), pass: 'falsch' }, { uidValidity: '', lastUid: 0 })).rejects.toMatchObject({ authenticationFailed: true });
  });
});
