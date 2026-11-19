import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import type { HotelSettings } from '../../shared/schemas.js';
import type { TextPos } from '../../shared/vouchers.js';
import type { Logo } from './invoicepdf.js';
import { asset } from './pdf.js';

/**
 * Gutschein als PDF im Querformat DIN A5: hochgeladenes Motiv als Hintergrund (füllt die Seite),
 * darauf ein helles Textfeld (rechts, links oder unten) mit Wert, Empfänger, Gruß, Nummer, PIN und Gültigkeit.
 * Ohne Motiv: schlichter Rahmen in der Akzentfarbe mit Logo.
 */
export interface VoucherPrint {
  number: string; pin: string | null; posCardNo: string; valueCents: number; issuedOn: string; validUntil: string | null;
  recipientName: string; message: string;
}
const money = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100).replace(/ /g, ' ');
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export async function renderVoucher(v: VoucherPrint, h: HotelSettings, design: { mime: string; data: Buffer; textPos: TextPos } | null, logo: Logo | null, accent: [number, number, number]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset('LiberationSerif-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(asset('LiberationSerif-Bold.ttf'), { subset: true });
  const sans = await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true });
  doc.setTitle(`Gutschein ${v.number}`); doc.setAuthor(h.name);
  const W = 595.28, H = 419.53; // A5 quer
  const page = doc.addPage([W, H]);
  const ink = rgb(0.12, 0.12, 0.14), soft = rgb(0.35, 0.35, 0.38);
  const acc = rgb(accent[0], accent[1], accent[2]);

  let bg: PDFImage | null = null;
  if (design) { try { bg = design.mime === 'image/png' ? await doc.embedPng(design.data) : await doc.embedJpg(design.data); } catch { bg = null; } }
  let box = { x: 36, y: 36, w: W - 72, h: H - 72 };
  if (bg) {
    // Motiv füllt die Seite (zugeschnitten, nicht verzerrt)
    const s = Math.max(W / bg.width, H / bg.height);
    page.drawImage(bg, { x: (W - bg.width * s) / 2, y: (H - bg.height * s) / 2, width: bg.width * s, height: bg.height * s });
    const pos = design!.textPos;
    box = pos === 'bottom' ? { x: 28, y: 22, w: W - 56, h: 168 } : { x: pos === 'right' ? W / 2 + 6 : 22, y: 22, w: W / 2 - 28, h: H - 44 };
    page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, color: rgb(1, 1, 1), opacity: 0.9, borderColor: acc, borderWidth: 0.8, borderOpacity: 0.6 });
  } else {
    page.drawRectangle({ x: 14, y: 14, width: W - 28, height: H - 28, borderColor: acc, borderWidth: 2 });
    page.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: acc, borderWidth: 0.6 });
    if (logo) {
      try {
        const img = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data);
        const s = Math.min(150 / img.width, 54 / img.height);
        page.drawImage(img, { x: (W - img.width * s) / 2, y: H - 36 - img.height * s, width: img.width * s, height: img.height * s });
        box = { ...box, h: box.h - 60 };
      } catch { /* Logo nicht lesbar – ohne */ }
    }
  }

  const pad = 16;
  const L = box.x + pad, R = box.x + box.w - pad, Wd = R - L;
  const center = !bg || design?.textPos === 'bottom';
  const put = (t: string, y: number, font: PDFFont, size: number, color = ink) => {
    const x = center ? L + (Wd - font.widthOfTextAtSize(t, size)) / 2 : L;
    page.drawText(t, { x, y, size, font, color });
  };
  const compact = bg && design?.textPos === 'bottom';
  let y = box.y + box.h - pad - (compact ? 16 : 22);
  if (!compact) { put(h.name.toUpperCase(), y, sans, 8.5, soft); y -= 30; }
  put('Gutschein', y, bold, compact ? 24 : 32, acc); y -= compact ? 24 : 34;
  put(`im Wert von ${money(v.valueCents)}`, y, bold, compact ? 15 : 18); y -= compact ? 20 : 28;
  if (v.recipientName) { put(`für ${v.recipientName}`, y, regular, 13); y -= 20; }
  if (v.message) {
    for (const l of wrap(v.message, regular, 11, Wd).slice(0, compact ? 2 : 6)) { put(l, y, regular, 11, soft); y -= 14; }
    y -= 4;
  }
  // Angaben unten im Textfeld
  const facts = [
    `Gutschein-Nr. ${v.number}`,
    ...(v.pin ? [`PIN ${v.pin}`] : []),
    ...(v.posCardNo ? [`Karte ${v.posCardNo}`] : []),
    `ausgestellt am ${de(v.issuedOn)}${v.validUntil ? ` · gültig bis ${de(v.validUntil)}` : ''}`,
  ];
  let fy = box.y + pad + (facts.length - 1) * 12 + 14;
  const addr = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const contact = [addr, h.phone && `Tel. ${h.phone}`].filter(Boolean).join(' · ');
  if (contact) { put(contact, box.y + pad - 2, sans, 7.5, soft); fy += 4; }
  for (const f of facts) { put(f, fy, sans, 9, ink); fy -= 12; }
  return doc.save();
}
