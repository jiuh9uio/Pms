import type { DesignElement, VoucherLayout } from './vouchers.js';

/**
 * Vorgefertigte Gutschein-Designs (eigene Entwürfe, nur aus Flächen, Texten, Logo und Strichcode – keine fremden Bilder).
 * Beim Übernehmen entsteht eine eigene Kopie, die sich im Editor frei anpassen lässt.
 */
export interface DesignPreset { key: string; name: string; description: string; layout: VoucherLayout }

let n = 0;
type P = Partial<DesignElement> & Pick<DesignElement, 'type' | 'x' | 'y' | 'w' | 'h'>;
const e = (p: P): DesignElement => ({
  id: `p${++n}`, label: p.type === 'text' ? 'Text' : p.type === 'box' ? 'Fläche' : p.type === 'logo' ? 'Logo' : 'Strichcode',
  hidden: false, text: '', font: 'serif', size: 12, bold: false, italic: false, align: 'center', color: '#1f1f24', fill: '#ffffff', opacity: 1, radius: 0, border: '', ...p,
});
const L = (background: string, palette: string[], elements: DesignElement[]): VoucherLayout => ({ background, useImage: true, imageFit: 'cover', palette, elements });

const NUMBERS = 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\nausgestellt am {ausgestellt} · gültig bis {gueltig}';
const SENDER = '{hotel} · {adresse} · Tel. {telefon}';

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    key: 'elegant-gold', name: 'Elegant Gold', description: 'Creme mit doppeltem Goldrahmen – zeitlos, für jeden Anlass',
    layout: L('#fbf7ee', ['#fbf7ee', '#b8860b', '#8a6d1f', '#2b2b2b', '#ffffff'], [
      e({ type: 'box', label: 'Rahmen außen', x: 6, y: 6, w: 198, h: 136, opacity: 0, border: '#b8860b' }),
      e({ type: 'box', label: 'Rahmen innen', x: 9, y: 9, w: 192, h: 130, opacity: 0, border: '#b8860b' }),
      e({ type: 'logo', x: 85, y: 15, w: 40, h: 14 }),
      e({ type: 'text', label: 'Überschrift', x: 20, y: 33, w: 170, h: 16, text: 'GUTSCHEIN', size: 32, color: '#8a6d1f' }),
      e({ type: 'box', label: 'Linie', x: 85, y: 51, w: 40, h: 0.6, fill: '#b8860b' }),
      e({ type: 'text', label: 'Wert', x: 20, y: 56, w: 170, h: 10, text: 'im Wert von {wert}', size: 18, bold: true, color: '#2b2b2b' }),
      e({ type: 'text', label: 'Für', x: 20, y: 69, w: 170, h: 8, text: 'für {empfaenger}', size: 13, color: '#2b2b2b' }),
      e({ type: 'text', label: 'Gruß', x: 30, y: 78, w: 150, h: 12, text: '{gruss}', size: 11, italic: true, color: '#5a5a5a' }),
      e({ type: 'barcode', x: 80, y: 95, w: 50, h: 11 }),
      e({ type: 'text', label: 'Nummern', x: 20, y: 108, w: 170, h: 14, text: NUMBERS, font: 'sans', size: 8, color: '#2b2b2b' }),
      e({ type: 'text', label: 'Absender', x: 20, y: 128, w: 170, h: 5, text: SENDER, font: 'sans', size: 6.5, color: '#8a6d1f' }),
    ]),
  },
  {
    key: 'tannengruen', name: 'Winterzeit', description: 'Tannengrün mit warmem Rot – passend zu Weihnachten',
    layout: L('#0f3d2e', ['#0f3d2e', '#1f6b4e', '#a12a2a', '#f3e9d2', '#d4af37', '#ffffff'], [
      e({ type: 'box', label: 'Kreis groß', x: -30, y: -40, w: 110, h: 110, fill: '#1f6b4e', opacity: 0.55, radius: 55 }),
      e({ type: 'box', label: 'Kreis klein', x: 40, y: 95, w: 45, h: 45, fill: '#a12a2a', opacity: 0.5, radius: 22.5 }),
      e({ type: 'text', label: 'Großer Gruß', x: 12, y: 20, w: 85, h: 40, text: 'Frohe\nFesttage', size: 30, bold: true, align: 'left', color: '#f3e9d2' }),
      e({ type: 'box', label: 'Textfeld', x: 104, y: 10, w: 96, h: 128, fill: '#f3e9d2', radius: 4 }),
      e({ type: 'logo', x: 132, y: 16, w: 40, h: 13 }),
      e({ type: 'text', label: 'Überschrift', x: 108, y: 34, w: 88, h: 14, text: 'Gutschein', size: 28, bold: true, color: '#a12a2a' }),
      e({ type: 'text', label: 'Wert', x: 108, y: 50, w: 88, h: 9, text: 'im Wert von {wert}', size: 15, bold: true, color: '#0f3d2e' }),
      e({ type: 'text', label: 'Für', x: 108, y: 61, w: 88, h: 7, text: 'für {empfaenger}', size: 12, color: '#0f3d2e' }),
      e({ type: 'text', label: 'Gruß', x: 110, y: 70, w: 84, h: 16, text: '{gruss}', size: 10, italic: true, color: '#3c3c3c' }),
      e({ type: 'barcode', x: 132, y: 92, w: 40, h: 10 }),
      e({ type: 'text', label: 'Nummern', x: 108, y: 105, w: 88, h: 16, text: NUMBERS, font: 'sans', size: 7, color: '#0f3d2e' }),
      e({ type: 'text', label: 'Absender', x: 108, y: 128, w: 88, h: 5, text: '{hotel} · Tel. {telefon}', font: 'sans', size: 6, color: '#0f3d2e' }),
    ]),
  },
  {
    key: 'geburtstag', name: 'Fröhlich', description: 'Bunte Kreise auf Weiß – für Geburtstage und Feiern',
    layout: L('#ffffff', ['#ffffff', '#e4572e', '#f3a712', '#29335c', '#669bbc', '#a8c686'], [
      e({ type: 'box', label: 'Kreis 1', x: -12, y: -14, w: 46, h: 46, fill: '#f3a712', opacity: 0.85, radius: 23 }),
      e({ type: 'box', label: 'Kreis 2', x: 178, y: 8, w: 26, h: 26, fill: '#e4572e', opacity: 0.85, radius: 13 }),
      e({ type: 'box', label: 'Kreis 3', x: 186, y: 112, w: 40, h: 40, fill: '#669bbc', opacity: 0.85, radius: 20 }),
      e({ type: 'box', label: 'Kreis 4', x: 8, y: 118, w: 18, h: 18, fill: '#a8c686', opacity: 0.9, radius: 9 }),
      e({ type: 'logo', x: 85, y: 12, w: 40, h: 14 }),
      e({ type: 'text', label: 'Überschrift', x: 20, y: 30, w: 170, h: 16, text: 'Gutschein', size: 36, bold: true, font: 'sans', color: '#29335c' }),
      e({ type: 'text', label: 'Wert', x: 20, y: 50, w: 170, h: 10, text: 'im Wert von {wert}', size: 18, bold: true, font: 'sans', color: '#e4572e' }),
      e({ type: 'text', label: 'Für', x: 20, y: 63, w: 170, h: 8, text: 'für {empfaenger}', size: 13, font: 'sans', color: '#29335c' }),
      e({ type: 'text', label: 'Gruß', x: 30, y: 73, w: 150, h: 12, text: '{gruss}', size: 11, font: 'sans', color: '#4a4a4f' }),
      e({ type: 'barcode', x: 80, y: 93, w: 50, h: 11 }),
      e({ type: 'text', label: 'Nummern', x: 20, y: 106, w: 170, h: 14, text: NUMBERS, font: 'sans', size: 8 }),
      e({ type: 'text', label: 'Absender', x: 20, y: 130, w: 170, h: 5, text: SENDER, font: 'sans', size: 6.5, color: '#4a4a4f' }),
    ]),
  },
  {
    key: 'modern-dunkel', name: 'Modern Dunkel', description: 'Anthrazit mit Akzentstreifen – klar und edel',
    layout: L('#22252b', ['#22252b', '#c9a227', '#ffffff', '#9aa0a6', '#3a3f47'], [
      e({ type: 'box', label: 'Streifen', x: 0, y: 0, w: 8, h: 148, fill: '#c9a227' }),
      e({ type: 'logo', x: 20, y: 14, w: 42, h: 14, align: 'left' }),
      e({ type: 'text', label: 'Überschrift', x: 20, y: 40, w: 120, h: 16, text: 'GUTSCHEIN', size: 34, bold: true, font: 'sans', align: 'left', color: '#ffffff' }),
      e({ type: 'text', label: 'Wert', x: 20, y: 60, w: 120, h: 12, text: '{wert}', size: 26, bold: true, font: 'sans', align: 'left', color: '#c9a227' }),
      e({ type: 'text', label: 'Für', x: 20, y: 76, w: 120, h: 8, text: 'für {empfaenger}', size: 13, font: 'sans', align: 'left', color: '#ffffff' }),
      e({ type: 'text', label: 'Gruß', x: 20, y: 86, w: 115, h: 16, text: '{gruss}', size: 10.5, italic: true, font: 'sans', align: 'left', color: '#9aa0a6' }),
      e({ type: 'box', label: 'Feld Nummern', x: 140, y: 88, w: 62, h: 46, fill: '#ffffff', radius: 3 }),
      e({ type: 'barcode', x: 145, y: 92, w: 52, h: 12 }),
      e({ type: 'text', label: 'Nummern', x: 143, y: 106, w: 56, h: 20, text: 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\ngültig bis {gueltig}', font: 'sans', size: 7.5 }),
      e({ type: 'text', label: 'Absender', x: 20, y: 132, w: 115, h: 5, text: '{hotel} · Tel. {telefon}', font: 'sans', size: 6.5, align: 'left', color: '#9aa0a6' }),
    ]),
  },
  {
    key: 'genuss', name: 'Genuss', description: 'Warmes Bordeaux mit Creme – für Restaurant und Menüs',
    layout: L('#6e1e2b', ['#6e1e2b', '#f4ead8', '#c9a227', '#3b0f17', '#ffffff'], [
      e({ type: 'box', label: 'Karte', x: 14, y: 12, w: 182, h: 124, fill: '#f4ead8', radius: 2, border: '#c9a227' }),
      e({ type: 'logo', x: 85, y: 18, w: 40, h: 13 }),
      e({ type: 'text', label: 'Vorzeile', x: 20, y: 34, w: 170, h: 6, text: 'Ein Genuss zum Verschenken', size: 11, italic: true, color: '#6e1e2b' }),
      e({ type: 'text', label: 'Überschrift', x: 20, y: 41, w: 170, h: 15, text: 'Gutschein', size: 32, bold: true, color: '#3b0f17' }),
      e({ type: 'text', label: 'Wert', x: 20, y: 59, w: 170, h: 10, text: 'im Wert von {wert}', size: 17, bold: true, color: '#6e1e2b' }),
      e({ type: 'text', label: 'Für', x: 20, y: 71, w: 170, h: 7, text: 'für {empfaenger}', size: 12.5, color: '#3b0f17' }),
      e({ type: 'text', label: 'Gruß', x: 34, y: 80, w: 142, h: 12, text: '{gruss}', size: 10.5, italic: true, color: '#4a3a3a' }),
      e({ type: 'barcode', x: 82, y: 95, w: 46, h: 10 }),
      e({ type: 'text', label: 'Nummern', x: 20, y: 107, w: 170, h: 14, text: NUMBERS, font: 'sans', size: 7.5, color: '#3b0f17' }),
      e({ type: 'text', label: 'Absender', x: 20, y: 127, w: 170, h: 5, text: SENDER, font: 'sans', size: 6.5, color: '#6e1e2b' }),
    ]),
  },
  {
    key: 'natur', name: 'Natur & Ruhe', description: 'Sanftes Salbeigrün – für Übernachtung und Erholung',
    layout: L('#e8efe6', ['#e8efe6', '#5c7c5c', '#2f4a3a', '#ffffff', '#c8d5c3'], [
      e({ type: 'box', label: 'Band oben', x: 0, y: 0, w: 210, h: 30, fill: '#5c7c5c' }),
      e({ type: 'box', label: 'Kreis', x: 160, y: -20, w: 70, h: 70, fill: '#c8d5c3', opacity: 0.35, radius: 35 }),
      e({ type: 'text', label: 'Kopf', x: 14, y: 10, w: 150, h: 10, text: '{hotel}', size: 15, bold: true, align: 'left', color: '#ffffff' }),
      e({ type: 'logo', x: 150, y: 36, w: 46, h: 16, align: 'right' }),
      e({ type: 'text', label: 'Überschrift', x: 14, y: 38, w: 130, h: 15, text: 'Gutschein', size: 32, bold: true, align: 'left', color: '#2f4a3a' }),
      e({ type: 'text', label: 'Wert', x: 14, y: 57, w: 130, h: 10, text: 'im Wert von {wert}', size: 17, bold: true, align: 'left', color: '#5c7c5c' }),
      e({ type: 'text', label: 'Für', x: 14, y: 69, w: 130, h: 7, text: 'für {empfaenger}', size: 12.5, align: 'left', color: '#2f4a3a' }),
      e({ type: 'text', label: 'Gruß', x: 14, y: 78, w: 120, h: 16, text: '{gruss}', size: 10.5, italic: true, align: 'left', color: '#4a4a4f' }),
      e({ type: 'box', label: 'Feld Nummern', x: 138, y: 86, w: 60, h: 48, fill: '#ffffff', radius: 3 }),
      e({ type: 'barcode', x: 142, y: 90, w: 52, h: 12 }),
      e({ type: 'text', label: 'Nummern', x: 141, y: 104, w: 54, h: 22, text: 'Gutschein-Nr. {kassennr}\ninterne Nr. {intern}\ngültig bis {gueltig}', font: 'sans', size: 7.5, color: '#2f4a3a' }),
      e({ type: 'text', label: 'Absender', x: 14, y: 130, w: 120, h: 5, text: '{adresse} · Tel. {telefon}', font: 'sans', size: 6.5, align: 'left', color: '#2f4a3a' }),
    ]),
  },
];
