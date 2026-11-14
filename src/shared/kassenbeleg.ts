/**
 * Inhalt eines TSE-Vorgangs der Art „Kassenbeleg-V1“ (DSFinV-K): Beleg^Brutto je Steuersatz^Zahlung.
 * Die fünf Beträge stehen in fester Reihenfolge: 19 %, 7 %, 10,7 %, 5,5 %, 0 %. Aus dem Gedächtnis umgesetzt –
 * ob Aufbau und Zuordnung für den Betrieb genügen, muss die Steuerberatung prüfen.
 */
const SLOTS = [19, 7, 10.7, 5.5, 0];
const amt = (cents: number) => (cents < 0 ? '-' : '') + (Math.abs(cents) / 100).toFixed(2);

/** Betrag im Verhältnis der Teile aufteilen; Rundungsreste gehen an die größten Nachkommaanteile, die Summe stimmt genau. */
export function splitByParts(cents: number, parts: { rate: number; cents: number }[]): { rate: number; cents: number }[] {
  const total = parts.reduce((s, p) => s + p.cents, 0);
  if (!parts.length || total <= 0) return [];
  const sign = cents < 0 ? -1 : 1, abs = Math.abs(cents);
  const raw = parts.map((p) => ({ rate: p.rate, exact: (abs * p.cents) / total }));
  const out = raw.map((r) => ({ rate: r.rate, cents: Math.floor(r.exact), frac: r.exact - Math.floor(r.exact) }));
  let rest = abs - out.reduce((s, o) => s + o.cents, 0);
  for (const o of [...out].sort((a, b) => b.frac - a.frac)) { if (rest <= 0) break; o.cents++; rest--; }
  return out.map((o) => ({ rate: o.rate, cents: sign * o.cents }));
}

export function kassenbelegData(parts: { rate: number; cents: number }[], cents: number, cash: boolean): string {
  const sums = SLOTS.map(() => 0);
  for (const p of parts) { const i = SLOTS.indexOf(p.rate); sums[i < 0 ? 0 : i]! += p.cents; }
  return `Beleg^${sums.map(amt).join('_')}^${amt(cents)}:${cash ? 'Bar' : 'Unbar'}`;
}
