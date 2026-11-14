import { describe, expect, it } from 'vitest';
import { classify, extract, findDates, findPersons, findPhone, findTime, ownText } from '../src/shared/mailextract.js';

const REF = '2026-11-14';
describe('E-Mail-Erkennung', () => {
  it('findet Tage in den üblichen Schreibweisen', () => {
    expect(findDates('am 12.05.2027 bis 14.05.2027', REF)).toEqual(['2027-05-12', '2027-05-14']);
    expect(findDates('vom 12.-14.05.27', REF)).toEqual(['2027-05-12', '2027-05-14']);
    expect(findDates('vom 3. bis 5. Dezember', REF)).toEqual(['2026-12-03', '2026-12-05']);
    expect(findDates('am 20. Januar', REF)).toEqual(['2027-01-20']); // ohne Jahr: der nächste solche Tag
    expect(findDates('am 24.12. um 18.30 Uhr', REF)).toEqual(['2026-12-24']); // Uhrzeit ist kein Datum
    expect(findDates('für morgen Abend', REF)).toEqual(['2026-11-15']);
    expect(findDates('am 31.02.2027 oder 2027-03-01', REF)).toEqual(['2027-03-01']);
    expect(findDates('Bestellnummer 12.345.678', REF)).toEqual([]);
  });
  it('findet Uhrzeit, Personen und Telefon', () => {
    expect(findTime('gegen 18.30 Uhr')).toBe('18:30');
    expect(findTime('um 19 Uhr')).toBe('19:00');
    expect(findTime('Tisch 12:15 bitte')).toBe('12:15');
    expect(findTime('am 12.05.2027')).toBeNull();
    expect(findPersons('einen Tisch für 6 Personen')).toEqual({ persons: 6, children: null });
    expect(findPersons('wir kommen zu viert')).toEqual({ persons: 4, children: null });
    expect(findPersons('2 Erwachsene und ein Kind')).toEqual({ persons: 2, children: 1 });
    expect(findPersons('ein Einzelzimmer')).toEqual({ persons: 1, children: null });
    expect(findPhone('Tel.: 0171 / 123 45 67, danke')).toBe('0171 / 123 45 67');
    expect(findPhone('erreichbar unter +49 30 1234567')).toBe('+49 30 1234567');
    expect(findPhone('am 12.05.2027')).toBe('');
  });
  it('ordnet Anfragen ein', () => {
    expect(classify('Haben Sie vom 3. bis 5. Dezember ein Doppelzimmer frei?')).toBe('hotel');
    expect(classify('Ich möchte einen Tisch für 4 Personen reservieren')).toBe('table');
    expect(classify('Ihre Rechnung Nr. 4711 vom Lieferanten')).toBe('other');
    expect(classify('Newsletter: Hotel-Software im Angebot')).toBe('other');
  });
  it('liest eine Hotelanfrage und eine Tischanfrage', () => {
    expect(extract('Zimmeranfrage', 'Guten Tag,\nwir suchen ein Doppelzimmer vom 3. bis 5. Dezember für 2 Erwachsene.\nTel. 0171 1234567\nViele Grüße\nErika Beispiel', REF))
      .toMatchObject({ kind: 'hotel', from: '2026-12-03', to: '2026-12-05', persons: 2, time: null, phone: '0171 1234567' });
    expect(extract('Anfrage', 'Hallo, haben Sie ab 10.01.2027 für 3 Nächte ein Einzelzimmer frei?', REF)).toMatchObject({ kind: 'hotel', from: '2027-01-10', to: '2027-01-13', persons: 1 });
    expect(extract('Tischreservierung', 'Hallo,\nbitte einen Tisch am 24.12. um 18.30 Uhr für 6 Personen.\nDanke!', REF))
      .toMatchObject({ kind: 'table', dates: ['2026-12-24'], time: '18:30', persons: 6, from: null });
  });
  it('liest zitierte ältere Nachrichten nicht mit', () => {
    const body = 'Dann bitte am 20.12. um 19 Uhr.\n\nAm 01.11.2026 um 10:00 schrieb Hotel:\n> Wir haben am 05.11. geschlossen.';
    expect(ownText(body)).not.toContain('05.11.');
    expect(extract('Re: Tisch reservieren', body, REF)).toMatchObject({ kind: 'table', dates: ['2026-12-20'], time: '19:00' });
  });
});
