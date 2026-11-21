import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { UNIT_LABEL, type OfferDto, type OfferLayout } from '../../shared/offers.js';
import type { HotelSettings } from '../../shared/schemas.js';
import { accentRgb, type Logo } from './invoicepdf.js';
import { asset } from './pdf.js';

/**
 * Angebot als PDF (A4). Gestaltung über das Angebotslayout (Angebote → Gestaltung): Stil, Farbe, Schrift, Logo-Lage und -Größe,
 * Tabelle, Abstände, Schriftgröße, Preise je Position oder nur Gesamtbetrag, Unterschriftsfeld, Fragen als Ausfüllfelder,
 * Absenderzeile, Falzmarken und vorgedrucktes Briefpapier.
 */

const money = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
const de = (s: string | null) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });

export async function renderOffer(o: OfferDto, h: HotelSettings, logo: Logo | null, layout: OfferLayout, today: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const family = layout.font === 'serif' ? 'LiberationSerif' : 'LiberationSans';
  const regular = await doc.embedFont(asset(`${family}-Regular.ttf`), { subset: true });
  const bold = await doc.embedFont(asset(`${family}-Bold.ttf`), { subset: true });
  let image: PDFImage | null = null;
  if (logo) { try { image = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { image = null; } }
  doc.setTitle(`Angebot ${o.number}`); doc.setAuthor(h.name);

  // f = Schriftgröße, g = Abstände
  const f = layout.fontSize === 'small' ? 0.92 : layout.fontSize === 'large' ? 1.1 : 1;
  const g = (layout.spacing === 'compact' ? 0.8 : layout.spacing === 'wide' ? 1.25 : 1) * f;
  const W = 595.28, H = 841.89, L = 62, R = W - 54, bottom = 74;
  const black = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), hair = rgb(0.82, 0.82, 0.82), band = rgb(0.95, 0.95, 0.95), white = rgb(1, 1, 1);
  const acc = rgb(...accentRgb(layout));
  const modern = layout.style === 'modern', elegant = layout.style === 'elegant', lh = layout.letterhead;
  const titleColor = layout.style === 'classic' ? black : acc;
  const pages: PDFPage[] = [];
  let page: PDFPage = doc.addPage([W, H]);
  pages.push(page);
  let y = H - 62;
  const put = (s: string, x: number, yy: number, o2: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean } = {}) => {
    const size = (o2.size ?? 10) * f, font = o2.font ?? regular;
    page.drawText(s, { x: o2.right ? x - font.widthOfTextAtSize(s, size) : x, y: yy, size, font, color: o2.color ?? black });
  };
  const rule = (yy: number, w = 0.5, color = hair, x1 = L, x2 = R) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });
  const wrap = (s: string, width: number, size: number, font = regular) => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(next, size * f) > width && cur) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - 62; };
  const need = (hgt: number) => { if (y - hgt < bottom) { newPage(); return true; } return false; };
  const para = (s: string, size = 10) => { for (const l of wrap(s, R - L, size)) { need(size * f + 4); put(l, L, y, { size }); y -= (size + 4) * f; } };

  // Kopf: Logo rechts, links oder mittig; bei Briefpapier bleibt der Platz frei
  if (modern && !lh) page.drawRectangle({ x: 0, y: H - 12, width: W, height: 12, color: acc });
  const pos = layout.logoPos;
  let logoBottom = H;
  if (image) {
    const k = layout.logoSize === 'small' ? 0.72 : layout.logoSize === 'large' ? 1.4 : 1;
    const s = Math.min((170 * k) / image.width, (64 * k) / image.height, 1.5), w = image.width * s, hh = image.height * s;
    if (!lh) page.drawImage(image, { x: pos === 'left' ? L : pos === 'center' ? (L + R) / 2 - w / 2 : R - w, y: H - 38 - hh, width: w, height: hh });
    logoBottom = H - 38 - hh;
    if (pos === 'center') y = logoBottom - 24 * f;
  }
  const hput = (s: string, yy: number, o2: { size: number; font?: PDFFont; color?: typeof black }) => {
    if (lh || !s) return;
    const w = (o2.font ?? regular).widthOfTextAtSize(s, o2.size * f);
    put(s, pos === 'center' ? (L + R) / 2 - w / 2 : pos === 'left' && image ? R - w : L, yy, o2);
  };
  hput(h.name, y, { size: 16, font: bold, color: titleColor });
  y -= 15 * f;
  hput([h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '), y, { size: 9, color: grey });
  y -= 12 * f;
  hput([h.phone && `Tel. ${h.phone}`, h.email, h.website].filter(Boolean).join(' · '), y, { size: 9, color: grey });
  y = Math.min(y, pos === 'center' ? y : logoBottom - 2) - 12;
  if (!lh) { if (elegant) { rule(y, 0.6, acc); rule(y - 2.6, 0.6, acc); } else rule(y, modern ? 0.5 : 1, modern ? hair : acc); }

  // Empfänger und Angebotsdaten rechts daneben
  y -= 48 * g;
  const top = y;
  if (layout.senderLine) put([h.name, h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · '), L, y + 16 * f, { size: 6.5, color: grey });
  for (const l of [o.customerCompany, o.customerName, o.street, [o.zip, o.city].filter(Boolean).join(' ')].filter(Boolean)) { put(l, L, y, { size: 11 }); y -= 15.5 * f; }
  const when = o.eventDate ? (o.eventEnd && o.eventEnd !== o.eventDate ? `${de(o.eventDate)} – ${de(o.eventEnd)}` : de(o.eventDate)) : '';
  const meta: [string, string][] = [['Angebotsnummer', o.number], ['Datum', de(today)]];
  if (o.validUntil) meta.push(['gültig bis', de(o.validUntil)]);
  if (when) meta.push(['Geplanter Termin', when]);
  meta.push(['Personen', String(o.persons)]);
  let my = top;
  for (const [k, v] of meta) { put(k, 345, my, { size: 9.5, color: grey }); put(v, R, my, { size: 9.5, right: true }); my -= 16 * f; }
  y = Math.min(y, my, top - 4 * 15.5 * f) - 30 * g;
  const heading = `Angebot${o.title ? ` – ${o.title}` : ''}`;
  for (const [k, t] of wrap(elegant ? heading.toUpperCase() : heading, R - L, elegant ? 14 : 16, bold).entries()) { put(t, L, y, { size: elegant ? 14 : 16, font: bold, color: titleColor }); y -= (k === 0 ? 22 : 20) * f; }
  y -= 4 * g;
  if (o.intro) { para(o.intro); y -= 8 * g; }

  // Positionen
  const showPrices = layout.prices === 'all';
  const cols = { pos: L + 6, desc: L + 34, qty: showPrices ? R - 175 : R - 6, price: R - 85, total: R - 6 };
  const lead = 12.5 * f, dlead = 10.5 * f, pad = 7 * g;
  const headRow = () => {
    const hh = 12 * f + pad * 1.4;
    if (elegant) { rule(y + 12 * f, 0.8, acc); rule(y - hh + 12 * f, 0.8, acc); }
    else page.drawRectangle({ x: L, y: y - hh + 12 * f, width: R - L, height: hh, color: modern ? acc : band });
    const c = modern ? white : elegant ? acc : grey;
    const ty = y - hh / 2 + 12 * f - 3 * f;
    put('Pos.', cols.pos, ty, { size: 8.5, font: bold, color: c }); put('Leistung', cols.desc, ty, { size: 8.5, font: bold, color: c });
    put('Menge', cols.qty, ty, { size: 8.5, font: bold, color: c, right: true });
    if (showPrices) { put('Einzelpreis brutto', cols.price, ty, { size: 8.5, font: bold, color: c, right: true }); put('Gesamt brutto', cols.total, ty, { size: 8.5, font: bold, color: c, right: true }); }
    y -= hh + pad;
  };
  need(40);
  headRow();
  const textW = cols.qty - cols.desc - 60;
  o.lines.forEach((l, i) => {
    const descLines = wrap(l.description, textW, 9.5, bold);
    const detail = [l.detail, UNIT_LABEL[l.unit]].filter(Boolean).join(' · ');
    const detLines = wrap(detail, textW, 8);
    const hgt = descLines.length * lead + detLines.length * dlead + pad * 2;
    if (need(hgt)) headRow();
    else if (i > 0 && layout.table === 'lines') rule(y + lead - 2 * f + pad - 1);
    if (layout.table === 'stripes' && i % 2 === 1) page.drawRectangle({ x: L, y: y + lead - 2 * f + pad - 1 - hgt, width: R - L, height: hgt, color: rgb(0.965, 0.965, 0.965) });
    put(String(i + 1), cols.pos, y, { size: 9.5, color: grey });
    put(num(l.quantity), cols.qty, y, { size: 9.5, right: true });
    if (showPrices) { put(money(l.unitPriceCents), cols.price, y, { size: 9.5, right: true }); put(money(l.totalCents), cols.total, y, { size: 9.5, right: true }); }
    descLines.forEach((d, k) => put(d, cols.desc, y - k * lead, { size: 9.5, font: bold }));
    y -= descLines.length * lead;
    detLines.forEach((d, k) => put(d, cols.desc, y - k * dlead, { size: 8, color: grey }));
    y -= detLines.length * dlead + pad * 2 - lead + lead;
  });
  rule(y + lead - 2 * f + pad - 1, 0.8, elegant ? acc : grey);

  // Summen
  const sx = 330, row = 14 * f;
  need(o.taxes.length * 2 * row + 40 * f);
  y -= 4 * g;
  for (const t of o.taxes) {
    // alle Preise sind brutto – Netto und enthaltene Umsatzsteuer je Steuersatz, wie auf Rechnung und Kostenvoranschlag
    put(o.taxes.length === 1 ? 'Nettobetrag' : `Nettobetrag zu ${num(t.rate)} %`, sx, y, { size: 9, color: grey }); put(money(t.netCents), cols.total, y, { size: 9, color: grey, right: true });
    y -= row;
    put(`Enthaltene Umsatzsteuer ${num(t.rate)} %`, sx, y, { size: 9, color: grey }); put(money(t.taxCents), cols.total, y, { size: 9, color: grey, right: true });
    y -= row;
  }
  y -= 4 * f;
  if (elegant) { rule(y + 16 * f, 0.8, acc, sx - 8, R); rule(y - 8 * f, 0.8, acc, sx - 8, R); rule(y - 8 * f - 2.6, 0.8, acc, sx - 8, R); }
  else page.drawRectangle({ x: sx - 8, y: y - 8 * f, width: R - sx + 8, height: 24 * f, color: modern ? acc : band });
  const tc = modern ? white : elegant ? acc : black;
  put('Gesamtbetrag brutto', sx, y, { size: 11.5, font: bold, color: tc }); put(money(o.totalCents), cols.total, y, { size: 11.5, font: bold, right: true, color: tc });
  y -= 30 * g;
  if (o.depositPercent > 0) { para(`Nach Annahme des Angebots bitten wir um eine Anzahlung von ${o.depositPercent} % (${money(Math.round((o.totalCents * o.depositPercent) / 100))}).`, 9.5); y -= 6 * g; }

  // Fragenkatalog: Aufzählung oder Felder zum Ausfüllen
  if (o.questions.length) {
    need(34 * f);
    y -= 4 * g;
    put('Damit wir alles vorbereiten können, teilen Sie uns bitte noch mit:', L, y, { font: bold, size: 10, color: elegant || modern ? acc : black }); y -= 16 * f;
    for (const q of o.questions) {
      const lines = wrap(q, layout.questionBoxes ? 200 : R - L - 14, 9.5);
      if (layout.questionBoxes) {
        const hh = Math.max(lines.length * 12.5 * f, 18 * f) + 6;
        need(hh + 4);
        lines.forEach((t, k) => put(t, L, y - k * 12.5 * f, { size: 9.5 }));
        page.drawRectangle({ x: L + 210, y: y - hh + 12 * f, width: R - L - 210, height: hh, borderColor: hair, borderWidth: 0.6 });
        y -= hh + 6 * g;
      } else {
        for (const [k, t] of lines.entries()) { need(13 * f); put(k === 0 ? '–' : '', L, y, { size: 9.5 }); put(t, L + 12, y, { size: 9.5 }); y -= 13 * f; }
      }
    }
    y -= 8 * g;
  }
  if (o.closing) { para(o.closing); y -= 6 * g; }
  if (o.documentIds.length) { para('Es gelten unsere beigefügten Allgemeinen Geschäftsbedingungen.', 8.5); y -= 6 * g; }

  // Annahme auf Papier: Ort, Datum, Unterschrift
  if (layout.signature) {
    need(58 * f + 8 * g);
    y -= 8 * g;
    put('Angebot angenommen:', L, y, { size: 10, font: bold }); y -= 30 * f;
    rule(y, 0.6, grey, L, L + 200); rule(y, 0.6, grey, L + 240, R);
    put('Ort, Datum', L, y - 11 * f, { size: 8, color: grey }); put('Unterschrift, Name in Druckbuchstaben', L + 240, y - 11 * f, { size: 8, color: grey });
    y -= 24 * f;
  }

  // Fuß, Seitenzahl, Falzmarken auf jeder Seite
  const foot = [h.name, h.phone && `Tel. ${h.phone}`, h.email, h.website].filter(Boolean).join(' · ');
  pages.forEach((p, i) => {
    page = p;
    if (!lh) {
      rule(50, 0.4, layout.style === 'classic' ? hair : acc);
      put(foot, L, 38, { size: 7.5, color: grey });
    }
    if (pages.length > 1) put(`Seite ${i + 1} von ${pages.length}`, R, 26, { size: 7.5, color: grey, right: true });
    if (layout.foldMarks) {
      const mm = 72 / 25.4;
      for (const [at, len] of [[105, 14], [148.5, 20], [210, 14]] as const) page.drawLine({ start: { x: 12, y: H - at * mm }, end: { x: 12 + len, y: H - at * mm }, thickness: 0.5, color: grey });
    }
  });
  return doc.save();
}
