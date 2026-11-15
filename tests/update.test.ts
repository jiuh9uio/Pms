import { describe, expect, it } from 'vitest';
import { parseGateway, parseNeighbors, wifiQrText } from '../src/server/modules/network.js';
import { downloadFile, getChangelog, getUpdateStatus, installUpdate, isNewer, parseChangelog, updateErrorText } from '../src/server/update.js';

describe('Programm-Update', () => {
  it('vergleicht Versionsnummern', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('2.0', '1.9.9')).toBe(true);
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.9', '1.0.0')).toBe(false);
  });
  it('ist außerhalb der gepackten Version abgeschaltet', async () => {
    expect(getUpdateStatus().supported).toBe(false);
    await expect(installUpdate()).rejects.toMatchObject({ code: 'update_unsupported' });
  });
});

describe('Update-Download', () => {
  it('lädt große Dateien ohne feste Gesamtzeit, setzt nach Abbruch fort und übersetzt Fehler', async () => {
    const { createServer } = await import('node:http');
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const data = Buffer.alloc(3_000_000, 7); data.write('ANFANG', 0); data.write('ENDE', data.length - 4);
    let hits = 0; const ranges: string[] = [];
    const server = createServer((req, res) => {
      hits++;
      const m = /bytes=(\d+)-/.exec(String(req.headers.range ?? ''));
      ranges.push(String(req.headers.range ?? ''));
      if (req.url === '/stumm') { res.writeHead(200, { 'Content-Length': data.length }); res.write(data.subarray(0, 1000)); return; } // hängt
      const from = m ? Number(m[1]) : 0;
      res.writeHead(m ? 206 : 200, { 'Content-Length': data.length - from, ...(m ? { 'Content-Range': `bytes ${from}-${data.length - 1}/${data.length}` } : {}) });
      if (hits === 1) { res.write(data.subarray(0, 1_000_000)); setTimeout(() => res.destroy(), 50); return; } // erster Versuch bricht ab
      res.end(data.subarray(from));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const dir = mkdtempSync(join(tmpdir(), 'pms-dl-'));
    const seen: number[] = [];
    await downloadFile(`${base}/paket.zip`, join(dir, 'a.zip'), (_r, _t, attempt) => { seen.push(attempt); }, { idleMs: 2000 });
    expect(readFileSync(join(dir, 'a.zip')).equals(data)).toBe(true);
    expect(ranges[0]).toBe('');
    expect(ranges[1]).toMatch(/^bytes=\d+-$/); // fortgesetzt statt neu
    expect(Math.max(...seen)).toBe(2);
    // keine Daten mehr: nach der Wartezeit Abbruch, Meldung auf Deutsch
    const err = await downloadFile(`${base}/stumm`, join(dir, 'b.zip'), () => {}, { idleMs: 300, attempts: 1 }).catch((e) => e);
    expect(updateErrorText(err)).toContain('zu langsam oder ist abgebrochen');
    expect(updateErrorText(new Error('The operation was aborted due to timeout'))).not.toContain('operation');
    server.closeAllConnections(); server.close(); rmSync(dir, { recursive: true, force: true });
  });
});

describe('Geräte im Netz', () => {
  it('liest die Nachbartabelle von Windows (deutsch und englisch) und Linux', () => {
    const win = `
Schnittstelle: 192.168.178.20 --- 0x5
  Internetadresse       Physische Adresse     Typ
  192.168.178.1         3c-a6-2f-11-22-33     dynamisch
  192.168.178.45        DA-12-34-56-78-9A     dynamic
  192.168.178.255       ff-ff-ff-ff-ff-ff     statisch
  224.0.0.22            01-00-5e-00-00-16     statisch
`;
    expect(parseNeighbors(win)).toEqual([{ ip: '192.168.178.1', mac: '3c:a6:2f:11:22:33' }, { ip: '192.168.178.45', mac: 'da:12:34:56:78:9a' }]);
    const linux = `IP address       HW type     Flags       HW address            Mask     Device
10.0.0.1         0x1         0x2         02:fc:00:00:00:05     *        eth0
10.0.0.9         0x1         0x0         00:00:00:00:00:00     *        eth0
`;
    expect(parseNeighbors(linux)).toEqual([{ ip: '10.0.0.1', mac: '02:fc:00:00:00:05' }]);
    expect(parseNeighbors('? (192.168.1.7) at 0:1b:2:aa:bb:c on en0 ifscope [ethernet]')).toEqual([{ ip: '192.168.1.7', mac: '00:1b:02:aa:bb:0c' }]);
  });
});

describe('Internet: Router-Adresse und WLAN-QR-Code', () => {
  it('liest das Standardgateway aus Windows- und Linux-Routentabellen', () => {
    const win = `
Aktive Routen:
     Netzwerkziel    Netzwerkmaske          Gateway    Schnittstelle Metrik
          0.0.0.0          0.0.0.0    192.168.178.1   192.168.178.20     25
`;
    expect(parseGateway(win, false)).toBe('192.168.178.1');
    expect(parseGateway('Iface\tDestination\tGateway\neth0\t00000000\t010200C0\t0003\neth0\t000200C0\t00000000\t0001', true)).toBe('192.0.2.1');
    expect(parseGateway('nichts', false)).toBeNull();
  });
  it('erzeugt den WLAN-Text mit maskierten Sonderzeichen', () => {
    expect(wifiQrText({ ssid: 'Schuetzenhaus-Gast', password: 'geheim1234', open: false, note: '' })).toBe('WIFI:T:WPA;S:Schuetzenhaus-Gast;P:geheim1234;;');
    expect(wifiQrText({ ssid: 'Gast;WLAN', password: 'a:b,c"d\\e', open: false, note: '' })).toBe('WIFI:T:WPA;S:Gast\\;WLAN;P:a\\:b\\,c\\"d\\\\e;;');
    expect(wifiQrText({ ssid: 'Offen', password: '', open: true, note: '' })).toBe('WIFI:T:nopass;S:Offen;;');
  });
});

describe('Was ist neu', () => {
  it('liest die Abschnitte je Version, neueste zuerst', () => {
    const md = '# Versionen\n\nEinleitung\n\n## 2.1.0\n\n- Neu A\n- Neu B\n\n## 2.0.0\n\nText\n\n## Sonstiges\n\nkein Versionsabschnitt';
    expect(parseChangelog(md)).toEqual([{ version: '2.1.0', text: '- Neu A\n- Neu B' }, { version: '2.0.0', text: 'Text' }]);
    const real = getChangelog();
    expect(real.length).toBeGreaterThan(5);
    expect(real.at(-1)!.version).toBe('1.0.0');
  });
});
