import { describe, expect, it } from 'vitest';
import { extractInvoice } from '../src/shared/invoiceextract.js';

const SELLER = { name: 'Hotel & Restaurant Schützenhaus', zip: '12345', vatId: 'DE999999999' };
describe('Rechnungsdaten aus PDF-Text', () => {
  it('liest eine Rechnung des PMS vollständig mit Positionen', () => {
    const text = `Hotel & Restaurant Schützenhaus\nAm Schützenplatz 1 · 12345 Musterstadt Tel. 01234 5678 · info@example.com\nMuster Bau GmbH\nIndustriestr. 5\n54321 Beispielstadt\nUSt-IdNr.: DE123456789\nRechnungsnummer RE-2026-0001\nRechnungsdatum 13.11.2026\nLeistungszeitraum 10.11.2026 – 13.11.2026\nRechnung\nPos. Leistung Menge Einzelpreis USt Betrag\n1 3 99,00 € 7 % 297,00 €Übernachtung Doppelzimmer, Zimmer 101\n(10.11.–13.11.2026)\n2 3 14,00 € 19 % 42,00 €Frühstück\nNettobetrag 7 %: 277,57 € · enthaltene Umsatzsteuer 7 % 19,43 €\nNettobetrag 19 %: 35,29 € · enthaltene Umsatzsteuer 19 % 6,71 €\nGesamtbetrag (brutto) 339,00 €\nBezahlt (Karte) -50,00 €\nZahlbar bis zum 27.11.2026`;
    const r = extractInvoice(text, SELLER);
    expect(r).toMatchObject({ number: 'RE-2026-0001', issueDate: '2026-11-13', serviceFrom: '2026-11-10', serviceTo: '2026-11-13', dueDate: '2026-11-27', grossCents: 33900, paidCents: 5000,
      buyer: { name: 'Muster Bau GmbH', street: 'Industriestr. 5', zip: '54321', city: 'Beispielstadt', vatId: 'DE123456789' } });
    expect(r.lines).toEqual([
      { name: 'Übernachtung Doppelzimmer, Zimmer 101', quantity: 3, unitGrossCents: 9900, taxRate: 7 },
      { name: 'Frühstück', quantity: 3, unitGrossCents: 1400, taxRate: 19 },
    ]);
    expect(r.notes).toEqual([]);
  });
  it('liest eine fremde Rechnung mit Text-zuerst-Positionen und Anrede', () => {
    const text = `Bäckerei Krume e.K. | Hauptstr. 2 | 12345 Musterstadt\nFrau\nErika Beispiel\nWeg 2\n22222 Beispielstadt\nRechnung Nr. 2026/117\nDatum: 03.02.2026\nLieferdatum: 01.02.2026\nBrötchen 40 0,50 € 7 % 20,00 €\nKaffee 2 10,00 € 19 % 20,00 €\nRechnungsbetrag: 40,00 EUR`;
    const r = extractInvoice(text, SELLER);
    expect(r).toMatchObject({ number: '2026/117', issueDate: '2026-02-03', serviceFrom: '2026-02-01', serviceTo: '2026-02-01', grossCents: 4000, buyer: { name: 'Erika Beispiel', zip: '22222' } });
    expect(r.lines).toHaveLength(2);
    expect(r.lines![0]).toEqual({ name: 'Brötchen', quantity: 40, unitGrossCents: 50, taxRate: 7 });
  });
  it('fasst je Steuersatz zusammen, wenn die Positionen nicht lesbar sind – und sagt es', () => {
    const text = `Kunde AG\nRing 9\n80331 München\nRechnungsnummer: 4711\nRechnungsdatum: 01.03.2026\nDiverse Arbeiten laut Aufmaß\nNetto 19 %: 1.000,00 €\nUSt 19 % 190,00 €\nGesamtbetrag 1.190,00 €`;
    const r = extractInvoice(text, SELLER);
    expect(r.lines).toEqual([{ name: 'Leistungen laut Rechnung (19 %)', quantity: 1, unitGrossCents: 119000, taxRate: 19 }]);
    expect(r.notes.join(' ')).toContain('zusammengefasste Position');
    expect(r.notes.join(' ')).toContain('Leistungszeitraum');
  });
  it('erfindet nichts, wenn nichts zu lesen ist', () => {
    const r = extractInvoice('Guten Tag\nvielen Dank für Ihren Besuch.', SELLER);
    expect(r.number).toBeUndefined();
    expect(r.buyer).toBeUndefined();
    expect(r.lines).toBeUndefined();
    expect(r.found).toEqual([]);
  });
  it('hält die eigene Anschrift nicht für den Empfänger und prüft Daten', () => {
    const r = extractInvoice('Hotel & Restaurant Schützenhaus\nAm Schützenplatz 1\n12345 Musterstadt\nRechnungsdatum 31.02.2026', SELLER);
    expect(r.buyer).toBeUndefined();
    expect(r.issueDate).toBeUndefined();
  });
});
