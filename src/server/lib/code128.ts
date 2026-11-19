/**
 * Code-128-Strichcode (eigene Umsetzung nach dem offenen Standard ISO/IEC 15417): liefert die Balkenbreiten in Modulen,
 * abwechselnd Balken und Lücke, beginnend mit einem Balken. Reine Ziffernfolgen gerader Länge (ab 4 Stellen) in Zeichensatz C,
 * sonst Zeichensatz B (druckbare ASCII-Zeichen 32–126).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
];
const STOP = '2331112';

export function code128(text: string): number[] {
  if (!text || /[^\x20-\x7e]/.test(text)) throw new Error('Für den Strichcode sind nur einfache Zeichen (A–Z, 0–9, Satzzeichen) möglich');
  const codes: number[] = [];
  if (/^\d+$/.test(text) && text.length >= 4 && text.length % 2 === 0) {
    codes.push(105); // Start C
    for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  } else {
    codes.push(104); // Start B
    for (const ch of text) codes.push(ch.charCodeAt(0) - 32);
  }
  const check = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  const widths = [...codes, check].flatMap((c) => [...PATTERNS[c]!].map(Number));
  return [...widths, ...[...STOP].map(Number)];
}
