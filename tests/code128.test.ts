import { describe, expect, it } from 'vitest';
import { code128 } from '../src/server/lib/code128.js';

describe('Code 128', () => {
  it('nutzt Zeichensatz C für gerade Ziffernfolgen und rechnet die Prüfziffer', () => {
    const w = code128('123456');
    // Start C (211232), 12, 34, 56, Prüfziffer 44 (= (105 + 12·1 + 34·2 + 56·3) mod 103), Stop
    expect(w.slice(0, 6).join('')).toBe('211232');
    expect(w.slice(24, 30).join('')).toBe('132131'); // Muster für den Wert 44
  });
  it('jedes Zeichen hat 11 Module, Stop 13', () => {
    for (const t of ['100234', 'GK-2026/77', '1234567', 'A']) {
      const w = code128(t);
      expect(w.reduce((s, x) => s + x, 0)).toBe((w.length - 7) / 6 * 11 + 13);
    }
  });
  it('lehnt Umlaute ab', () => { expect(() => code128('Müller')).toThrow(); });
});
