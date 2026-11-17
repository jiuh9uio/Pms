import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { UNIT_LABEL, type OfferDto } from '../../shared/offers.js';
import type { HotelSettings } from '../../shared/schemas.js';
import { accentRgb, type InvoiceLayout, type Logo } from './invoicepdf.js';
import { asset } from './pdf.js';

/** Angebot als PDF (A4) im Stil der Rechnungen: Logo, Farben und Schrift aus dem Rechnungslayout. */

const money = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
const de = (s: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });

export async function renderOffer(o: OfferDto, h: HotelSettings, logo: Logo | null, layout: InvoiceLayout, today: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const family = layout.font === 'serif' ? 'LiberationSerif' : 'LiberationSans';
  const regular = await doc.embedFont(asset(`${family}-Regular.ttf`), { subset: true });
  const bold = await doc.embedFont(asset(`${family}-Bold.ttf`), { subset: true });
  let image: PDFImage | null = null;
  if (logo) { try { image = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { image = null; } }
  doc.setTitle(`Angebot ${o.number}`); doc.setAuthor(h.name);
  const W = 595.28, H = 841.89, L = 62, R = W - 54, bottom = 70;
  const black = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), hair = rgb(0.82, 0.82, 0.82), band = rgb(0.95, 0.95, 0.95), acc = rgb(...accentRgb(layout));
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 62;
  const put = (s: string, x: number, yy: number, o2: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean } = {}) => {
    const size = o2.size ?? 10, font = o2.font ?? regular;
    page.drawText(s, { x: o2.right ? x - font.widthOfTextAtSize(s, size) : x, y: yy, size, font, color: o2.color ?? black });
  };
  const wrap = (s: string, width: number, size: number, font = regular) => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };
  const need = (hgt: number) => { if (y - hgt < bottom) { page = doc.addPage([W, H]); y = H - 62; } };
  const para = (s: string, size = 10) => { for (const l of wrap(s, R - L, size)) { need(size + 4); put(l, L, y, { size }); y -= size + 4; } };

  // Kopf
  if (image) {
    const s = Math.min(150 / image.width, 60 / image.height);
    page.drawImage(image, { x: R - image.width * s, y: H - 40 - image.height * s, width: image.width * s, height: image.height * s });
  }
  put(h.name, L, y, { size: 13, font: bold, color: acc }); y -= 14;
  put([h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '), L, y, { size: 8.5, color: grey }); y -= 40;
  // Empfänger
  for (const l of [o.customerCompany, o.customerName, o.street, [o.zip, o.city].filter(Boolean).join(' ')].filter(Boolean)) { put(l, L, y); y -= 13; }
  y -= 20;
  put(`Angebot ${o.number}`, L, y, { size: 16, font: bold, color: acc });
  put(`Datum: ${de(today)}`, R, y, { right: true, size: 9.5 }); y -= 14;
  if (o.validUntil) { put(`gültig bis ${de(o.validUntil)}`, R, y, { right: true, size: 9.5, color: grey }); }
  if (o.title) { put(o.title, L, y, { size: 11, font: bold }); }
  y -= 16;
  const when = o.eventDate ? (o.eventEnd && o.eventEnd !== o.eventDate ? `${de(o.eventDate)} – ${de(o.eventEnd)}` : de(o.eventDate)) : '';
  put([when && `Termin: ${when}`, `Personen: ${o.persons}`].filter(Boolean).join('   ·   '), L, y, { size: 9.5, color: grey }); y -= 22;
  if (o.intro) { para(o.intro); y -= 8; }

  // Positionen
  const cols = { pos: L, desc: L + 22, qty: R - 175, price: R - 85, total: R };
  need(30);
  page.drawRectangle({ x: L - 6, y: y - 5, width: R - L + 12, height: 18, color: band });
  put('Pos.', cols.pos, y, { size: 8.5, font: bold }); put('Leistung', cols.desc, y, { size: 8.5, font: bold });
  put('Menge', cols.qty, y, { size: 8.5, font: bold, right: true }); put('Einzelpreis', cols.price, y, { size: 8.5, font: bold, right: true }); put('Gesamt', cols.total, y, { size: 8.5, font: bold, right: true });
  y -= 20;
  o.lines.forEach((l, i) => {
    const descLines = wrap(l.description, cols.qty - cols.desc - 60, 9.5, bold);
    const detail = [l.detail, UNIT_LABEL[l.unit]].filter(Boolean).join(' · ');
    const detLines = wrap(detail, cols.qty - cols.desc - 60, 8);
    need(descLines.length * 12 + detLines.length * 10 + 8);
    put(String(i + 1), cols.pos, y, { size: 9.5 });
    put(num(l.quantity), cols.qty, y, { size: 9.5, right: true }); put(money(l.unitPriceCents), cols.price, y, { size: 9.5, right: true }); put(money(l.totalCents), cols.total, y, { size: 9.5, right: true });
    for (const d of descLines) { put(d, cols.desc, y, { size: 9.5, font: bold }); y -= 12; }
    for (const d of detLines) { put(d, cols.desc, y, { size: 8, color: grey }); y -= 10; }
    // Trennlinie mit Abstand zur nächsten Zeile (Grundlinie liegt unter der Linie)
    page.drawLine({ start: { x: L, y: y + 6 }, end: { x: R, y: y + 6 }, thickness: 0.4, color: hair });
    y -= 10;
  });
  // Summen
  need(40 + o.taxes.length * 12);
  y -= 4;
  for (const t of o.taxes) { put(`darin enthalten ${num(t.rate)} % USt auf ${money(t.netCents)}`, cols.price, y, { size: 8.5, color: grey, right: true }); put(money(t.taxCents), cols.total, y, { size: 8.5, color: grey, right: true }); y -= 12; }
  y -= 4;
  page.drawRectangle({ x: cols.qty - 40, y: y - 6, width: R - cols.qty + 46, height: 20, color: band });
  put('Gesamtbetrag', cols.qty - 34, y, { font: bold, size: 11 }); put(money(o.totalCents), cols.total, y, { font: bold, size: 11, right: true });
  y -= 28;
  if (o.depositPercent > 0) { para(`Nach Annahme des Angebots bitten wir um eine Anzahlung von ${o.depositPercent} % (${money(Math.round((o.totalCents * o.depositPercent) / 100))}).`, 9.5); y -= 6; }
  if (o.questions.length) {
    need(30); put('Damit wir alles vorbereiten können, teilen Sie uns bitte noch mit:', L, y, { font: bold, size: 10 }); y -= 15;
    for (const q of o.questions) { for (const [k, l] of wrap(q, R - L - 14, 9.5).entries()) { need(13); put(k === 0 ? '–' : '', L, y, { size: 9.5 }); put(l, L + 12, y, { size: 9.5 }); y -= 13; } }
    y -= 8;
  }
  if (o.closing) { para(o.closing); y -= 6; }
  if (o.documentIds.length) para('Es gelten unsere beigefügten Allgemeinen Geschäftsbedingungen.', 8.5);
  // Fuß auf jeder Seite
  for (const p of doc.getPages()) {
    const foot = [h.name, h.phone && `Tel. ${h.phone}`, h.email, h.website].filter(Boolean).join(' · ');
    p.drawLine({ start: { x: L, y: 50 }, end: { x: R, y: 50 }, thickness: 0.4, color: hair });
    p.drawText(foot, { x: L, y: 38, size: 7.5, font: regular, color: grey });
  }
  return doc.save();
}
