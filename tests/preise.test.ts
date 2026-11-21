import { describe, expect, it } from 'vitest';
import { divRound, lineGrossCents, netFromGross, serviceLabel, taxBreakdown } from '../src/shared/billing.js';
import { lineTotal } from '../src/shared/offers.js';

/**
 * Preisrechnung: alle eingegebenen Preise sind brutto. Netto und Umsatzsteuer werden herausgerechnet,
 * die Umsatzsteuer wird nie aufgeschlagen. Gerechnet wird in ganzen Cent.
 */
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('Bruttopreise: Netto und enthaltene Umsatzsteuer', () => {
  it('Beispiel Kostenvoranschlag: 3 × Pils 30 L à 52,00 € + Anfahrt 18,00 € = 174,00 € brutto, darin 27,78 € USt, netto 146,22 €', () => {
    const lines = [{ totalCents: lineGrossCents(3, 5200), taxRatePercent: 19 }, { totalCents: lineGrossCents(1, 1800), taxRatePercent: 19 }];
    expect(lines.map((l) => l.totalCents)).toEqual([15600, 1800]);
    expect(taxBreakdown(lines)).toEqual([{ rate: 19, grossCents: 17400, netCents: 14622, taxCents: 2778 }]);
  });

  it('die Umsatzsteuer wird nie aufgeschlagen: Netto + Steuer = Brutto, für jeden Betrag und Steuersatz', () => {
    for (const rate of [0, 7, 19, 5.5, 10.7, 16, 20]) {
      for (let gross = -5000; gross <= 25_000; gross += 37) {
        const [t] = taxBreakdown([{ totalCents: gross, taxRatePercent: rate }]);
        expect(t!.netCents + t!.taxCents).toBe(gross);
        expect(t!.grossCents).toBe(gross);
        if (gross > 0 && rate > 0) { expect(t!.netCents).toBeLessThan(gross); expect(t!.taxCents).toBeGreaterThanOrEqual(0); }
        if (rate === 0) expect(t).toMatchObject({ netCents: gross, taxCents: 0 });
      }
    }
  });

  it('unterschiedliche Steuersätze werden getrennt ausgewiesen; die Gesamtsumme bleibt die Summe der Bruttopreise', () => {
    // Übernachtung 7 %, Frühstück und Getränke 19 %, Kurtaxe 0 %
    const lines = [{ totalCents: 9900, taxRatePercent: 7 }, { totalCents: 9900, taxRatePercent: 7 }, { totalCents: 2400, taxRatePercent: 19 }, { totalCents: 950, taxRatePercent: 19 }, { totalCents: 400, taxRatePercent: 0 }];
    const t = taxBreakdown(lines);
    expect(t).toEqual([
      { rate: 0, grossCents: 400, netCents: 400, taxCents: 0 },
      { rate: 7, grossCents: 19800, netCents: 18505, taxCents: 1295 },   // 198,00 / 1,07 = 185,0467…
      { rate: 19, grossCents: 3350, netCents: 2815, taxCents: 535 },     // 33,50 / 1,19 = 28,1512…
    ]);
    expect(sum(t.map((x) => x.grossCents))).toBe(sum(lines.map((l) => l.totalCents)));
  });

  it('Rundung einmal je Steuersatz auf der Summe – nicht je Zeile (sonst wandern Cent)', () => {
    // 3 Zeilen zu je 0,99 € (19 %): je Zeile gerundet wäre die Steuer 3 × 0,16 = 0,48 €; richtig aus 2,97 € sind 0,47 €
    const lines = Array.from({ length: 3 }, () => ({ totalCents: 99, taxRatePercent: 19 }));
    expect(taxBreakdown(lines)).toEqual([{ rate: 19, grossCents: 297, netCents: 250, taxCents: 47 }]);
  });

  it('Mengen mit Nachkommastellen: Zeilenbetrag kaufmännisch gerundet, ohne Fehler der Kommazahlen', () => {
    expect(lineGrossCents(1.15, 100)).toBe(115);     // 1.15 * 100 wäre als Kommazahl 114,99999…
    expect(lineGrossCents(0.07, 1000)).toBe(70);
    expect(lineGrossCents(2.5, 333)).toBe(833);      // 832,5 → 833
    expect(lineGrossCents(0.5, 1)).toBe(1);          // 0,5 Cent → 1 Cent
    expect(lineGrossCents(1234.56, 9999)).toBe(12_344_365);
    expect(lineTotal(1.15, 100)).toBe(115);          // Angebote rechnen genauso
  });

  it('Rabatte und Gutschriften (Minusbeträge): spiegelbildlich zur Rechnung – ein Storno hebt sie genau auf', () => {
    expect(lineGrossCents(1, -1000)).toBe(-1000);
    expect(lineGrossCents(2.5, -333)).toBe(-833);
    // 10 % Rabatt als eigene Zeile: 174,00 € − 17,40 € = 156,60 € brutto
    const lines = [{ totalCents: 15600, taxRatePercent: 19 }, { totalCents: 1800, taxRatePercent: 19 }, { totalCents: -1740, taxRatePercent: 19 }];
    expect(taxBreakdown(lines)).toEqual([{ rate: 19, grossCents: 15660, netCents: 13160, taxCents: 2500 }]);
    for (const rate of [7, 19, 10, 5.5]) for (let g = 1; g < 3000; g += 7) {
      const plus = taxBreakdown([{ totalCents: g, taxRatePercent: rate }])[0]!, minus = taxBreakdown([{ totalCents: -g, taxRatePercent: rate }])[0]!;
      expect(minus.netCents + plus.netCents).toBe(0);
      expect(minus.taxCents + plus.taxCents).toBe(0);
    }
    // Rabatt hebt eine Position ganz auf
    expect(taxBreakdown([{ totalCents: 5000, taxRatePercent: 19 }, { totalCents: -5000, taxRatePercent: 19 }])).toEqual([{ rate: 19, grossCents: 0, netCents: 0, taxCents: 0 }]);
  });

  it('Rundungsgrenzen: genau ,5 wird vom Betrag weg gerundet; große Beträge bleiben genau', () => {
    expect(divRound(5, 10)).toBe(1); expect(divRound(-5, 10)).toBe(-1);
    expect(divRound(4, 10)).toBe(0); expect(divRound(-4, 10)).toBe(0);
    expect(divRound(15, 10)).toBe(2); expect(divRound(-15, 10)).toBe(-2);
    expect(() => divRound(1, 0)).toThrow();
    expect(netFromGross(1, 19)).toBe(1);             // 0,84 Cent → 1 Cent netto, 0 Cent Steuer
    expect(netFromGross(119, 19)).toBe(100);
    expect(netFromGross(107, 7)).toBe(100);
    expect(netFromGross(999_999_999, 19)).toBe(840_336_134);
    // Vergleich mit der Rechnung in Zehntausendstel-Cent für viele Beträge
    for (let g = 0; g < 20_000; g++) for (const rate of [7, 19]) {
      const net = netFromGross(g, rate);
      expect(Math.abs(net * (100 + rate) - g * 100)).toBeLessThanOrEqual((100 + rate) / 2);
    }
  });

  it('Beschriftung Leistungsdatum: ein Tag = Datum/Termin, mehrere Tage = Zeitraum; Kostenvoranschlag „voraussichtlich“', () => {
    expect(serviceLabel('2026-12-01', '2026-12-01', false)).toBe('Leistungsdatum');
    expect(serviceLabel('2026-12-01', null, false)).toBe('Leistungsdatum');
    expect(serviceLabel('2026-12-01', '2026-12-03', false)).toBe('Leistungszeitraum');
    expect(serviceLabel('2026-12-01', null, true)).toBe('Voraussichtl. Leistungstermin');
    expect(serviceLabel('2026-12-01', '2026-12-03', true)).toBe('Leistung vorauss.');
  });
});
