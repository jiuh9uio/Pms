import { describe, expect, it } from 'vitest';
import { parseGateway, parseNeighbors, wifiQrText } from '../src/server/modules/network.js';
import { getUpdateStatus, installUpdate, isNewer } from '../src/server/update.js';

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
