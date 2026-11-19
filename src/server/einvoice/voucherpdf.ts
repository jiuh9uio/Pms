import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import type { HotelSettings } from '../../shared/schemas.js';
import { PAGE_H, PAGE_W, fillText, type TextPos, type VoucherLayout } from '../../shared/vouchers.js';
import type { Logo } from './invoicepdf.js';
import { code128 } from '../lib/code128.js';
import { asset } from './pdf.js';

/**
 * Gutschein als PDF im Querformat DIN A5: hochgeladenes Motiv als Hintergrund (füllt die Seite),
 * darauf ein helles Textfeld (rechts, links oder unten) mit Wert, Empfänger, Gruß, Nummer, PIN und Gültigkeit.
 * Ohne Motiv: schlichter Rahmen in der Akzentfarbe mit Logo.
 */
export interface VoucherPrint {
  number: string; pin: string | null; posCardNo: string; valueCents: number; issuedOn: string; validUntil: string | null;
  recipientName: string; message: string;
  /** Strichcode (Code 128) der Kassennummer aufdrucken */
  barcode?: boolean;
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
    box = pos === 'bottom' ? { x: 28, y: 22, w: W - 56, h: v.barcode && v.posCardNo ? 240 : 168 } : { x: pos === 'right' ? W / 2 + 6 : 22, y: 22, w: W / 2 - 28, h: H - 44 };
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
  // Kassennummer = Gutscheinnummer für den Gast (mit Strichcode), interne Nummer klein darunter
  const facts = [
    ...(v.posCardNo ? [`Gutschein-Nr. ${v.posCardNo}`, `interne Nr. ${v.number}`] : [`Gutschein-Nr. ${v.number}`]),
    ...(v.pin ? [`PIN ${v.pin}`] : []),
    `ausgestellt am ${de(v.issuedOn)}${v.validUntil ? ` · gültig bis ${de(v.validUntil)}` : ''}`,
  ];
  let fy = box.y + pad + (facts.length - 1) * 12 + 14;
  const addr = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const contact = [addr, h.phone && `Tel. ${h.phone}`].filter(Boolean).join(' · ');
  if (contact) { put(contact, box.y + pad - 2, sans, 7.5, soft); fy += 4; }
  const top = fy + 12;
  for (const f of facts) { put(f, fy, sans, 9, ink); fy -= 12; }
  if (v.barcode && v.posCardNo) {
    let bars: number[] = [];
    try { bars = code128(v.posCardNo); } catch { bars = []; }
    if (bars.length) {
      const modules = bars.reduce((s, b) => s + b, 0) + 20; // 10 Module Ruhezone je Seite
      const mw = Math.min(1.4, (center ? Wd : Wd * 0.9) / modules);
      const bh = compact ? 26 : 38;
      const total = modules * mw;
      let x = (center ? L + (Wd - total) / 2 : L) + 10 * mw;
      const by = top + 2;
      page.drawRectangle({ x: x - 10 * mw, y: by - 2, width: total, height: bh + 4, color: rgb(1, 1, 1) });
      bars.forEach((w, i) => { if (i % 2 === 0) page.drawRectangle({ x, y: by, width: w * mw, height: bh, color: rgb(0, 0, 0) }); x += w * mw; });
    }
  }
  return doc.save();
}

// ---------- Gestaltung aus dem Design-Editor ----------
const MM = 72 / 25.4;
const hexRgb = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

/** Werte für die Platzhalter eines Gutscheins */
export function placeholderValues(v: VoucherPrint, h: HotelSettings): Record<string, string> {
  return {
    wert: money(v.valueCents), empfaenger: v.recipientName, gruss: v.message, kassennr: v.posCardNo, intern: v.number,
    ausgestellt: de(v.issuedOn), gueltig: v.validUntil ? de(v.validUntil) : '', hotel: h.name,
    adresse: [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), telefon: h.phone, website: h.website,
  };
}

/** Gutschein nach einer frei gestalteten Vorlage (Elemente mit Lage in mm, Reihenfolge = Ebenen von hinten nach vorn). */
export async function renderVoucherLayout(v: VoucherPrint, h: HotelSettings, layout: VoucherLayout, image: { mime: string; data: Buffer } | null, logo: Logo | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fonts = {
    serif: { regular: await doc.embedFont(asset('LiberationSerif-Regular.ttf'), { subset: true }), bold: await doc.embedFont(asset('LiberationSerif-Bold.ttf'), { subset: true }) },
    sans: { regular: await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true }), bold: await doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true }) },
  };
  doc.setTitle(`Gutschein ${v.number}`); doc.setAuthor(h.name);
  const W = PAGE_W * MM, H = PAGE_H * MM;
  const page = doc.addPage([W, H]);
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hexRgb(layout.background) });
  if (image && layout.useImage) {
    try {
      const img = image.mime === 'image/png' ? await doc.embedPng(image.data) : await doc.embedJpg(image.data);
      const s = layout.imageFit === 'contain' ? Math.min(W / img.width, H / img.height) : Math.max(W / img.width, H / img.height);
      page.drawImage(img, { x: (W - img.width * s) / 2, y: (H - img.height * s) / 2, width: img.width * s, height: img.height * s });
    } catch { /* Bild nicht lesbar – ohne */ }
  }
  let logoImg: PDFImage | null = null;
  if (logo) { try { logoImg = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { logoImg = null; } }
  const values = placeholderValues(v, h);
  // Ursprung oben links in mm → PDF-Punkte von unten links
  const X = (mmX: number) => mmX * MM;
  const Y = (mmY: number, mmH = 0) => H - (mmY + mmH) * MM;
  for (const e of layout.elements) {
    if (e.hidden) continue;
    if (e.type === 'box') {
      const w = e.w * MM, hh = e.h * MM, r = Math.min(e.radius * MM, w / 2, hh / 2);
      // Rechteck mit runden Ecken als Pfad (Koordinaten von oben links, y nach unten)
      const path = r > 0
        // Ecken als Viertelkreise (Bézier-Näherung, k = 0,5523) – bei Radius = halbe Breite ergibt das einen Kreis
        ? (() => { const k = 0.5523 * r; return `M ${r} 0 L ${w - r} 0 C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} L ${w} ${hh - r} C ${w} ${hh - r + k} ${w - r + k} ${hh} ${w - r} ${hh} L ${r} ${hh} C ${r - k} ${hh} 0 ${hh - r + k} 0 ${hh - r} L 0 ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`; })()
        : `M 0 0 L ${w} 0 L ${w} ${hh} L 0 ${hh} Z`;
      page.drawSvgPath(path, {
        x: X(e.x), y: Y(e.y),
        ...(e.opacity > 0 ? { color: hexRgb(e.fill), opacity: e.opacity } : {}),
        ...(e.border ? { borderColor: hexRgb(e.border), borderWidth: 1, borderOpacity: 1 } : {}),
      });
    } else if (e.type === 'logo') {
      if (!logoImg) continue;
      const s = Math.min((e.w * MM) / logoImg.width, (e.h * MM) / logoImg.height);
      const w = logoImg.width * s, hh = logoImg.height * s;
      const x = e.align === 'right' ? X(e.x) + e.w * MM - w : e.align === 'left' ? X(e.x) : X(e.x) + (e.w * MM - w) / 2;
      page.drawImage(logoImg, { x, y: Y(e.y) - hh, width: w, height: hh });
    } else if (e.type === 'barcode') {
      if (!v.posCardNo) continue;
      let bars: number[] = [];
      try { bars = code128(v.posCardNo); } catch { continue; }
      const modules = bars.reduce((s, b) => s + b, 0) + 20;
      const mw = (e.w * MM) / modules;
      page.drawRectangle({ x: X(e.x), y: Y(e.y, e.h), width: e.w * MM, height: e.h * MM, color: rgb(1, 1, 1) });
      let x = X(e.x) + 10 * mw;
      bars.forEach((b, i) => { if (i % 2 === 0) page.drawRectangle({ x, y: Y(e.y, e.h) + 1, width: b * mw, height: e.h * MM - 2, color: rgb(0, 0, 0) }); x += b * mw; });
    } else {
      const font = fonts[e.font][e.bold ? 'bold' : 'regular'];
      const text = fillText(e.text, values);
      if (!text.trim()) continue;
      const lh = e.size * 1.22;
      let y = Y(e.y) - e.size * 0.92;
      for (const line of wrap(text, font, e.size, e.w * MM)) {
        const tw = font.widthOfTextAtSize(line, e.size);
        const x = e.align === 'center' ? X(e.x) + (e.w * MM - tw) / 2 : e.align === 'right' ? X(e.x) + e.w * MM - tw : X(e.x);
        page.drawText(line, { x, y, size: e.size, font, color: hexRgb(e.color), ...(e.italic ? { ySkew: degrees(12) } : {}) });
        y -= lh;
      }
    }
  }
  return doc.save();
}
