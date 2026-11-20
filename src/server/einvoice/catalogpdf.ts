import fontkit from '@pdf-lib/fontkit';
import { PDFCheckBox, PDFDocument, PDFTextField, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { UNIT_LABEL, groupItems, type CatalogReturn, type OfferItemDto } from '../../shared/offers.js';
import type { HotelSettings } from '../../shared/schemas.js';
import { asset } from './pdf.js';

/**
 * Leistungskatalog zum Ankreuzen (A4, ausfüllbares PDF-Formular): der Kunde kreuzt am Rechner an, speichert und schickt das PDF zurück;
 * das Programm liest die Kreuze wieder ein (readCatalogPdf). Feldnamen: pos_<Leistungs-ID>, name, termin, personen, bemerkungen, angebot.
 * Druckt der Kunde aus und kreuzt von Hand an, lässt sich das nicht einlesen – dann wird im Programm von Hand angekreuzt.
 */

export interface CatalogData {
  offerNumber: string; catalogName: string; customer: string; date: string; persons: number;
  items: OfferItemDto[]; checked: string[]; showPrices: boolean;
}

const money = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
/** Formularfelder nutzen die Standardschrift Helvetica (WinAnsi) – andere Zeichen ersetzen, sonst bricht das Ausfüllen ab */
const ansi = (s: string) => s.replace(/[^\x20-\x7E -ÿ€–—‘’‚“”„•…]/g, '?');
const MARK = 'pms-leistungskatalog';

export async function renderCatalog(d: CatalogData, h: HotelSettings): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Leistungskatalog ${d.catalogName} – ${d.offerNumber}`); doc.setAuthor(h.name); doc.setKeywords([MARK, d.offerNumber]);
  const form = doc.getForm();

  const W = 595.28, H = 841.89, L = 56, R = W - 56, bottom = 70;
  const black = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), hair = rgb(0.8, 0.8, 0.8), fieldBg = rgb(0.96, 0.97, 1);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 60;
  const put = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean } = {}) => {
    const size = o.size ?? 10, font = o.font ?? regular;
    page.drawText(s, { x: o.right ? x - font.widthOfTextAtSize(s, size) : x, y: yy, size, font, color: o.color ?? black });
  };
  const wrap = (s: string, width: number, size: number, font = regular) => {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; } else cur = next;
      }
      if (cur) out.push(cur);
    }
    return out;
  };
  const newPage = () => { page = doc.addPage([W, H]); y = H - 60; put(`${h.name} · Leistungskatalog ${d.catalogName} (Fortsetzung)`, L, y, { size: 9, color: grey }); y -= 26; };
  const text = (name: string, value: string, x: number, yy: number, w: number, hgt: number, multi = false, readOnly = false) => {
    const f = form.createTextField(name);
    if (multi) f.enableMultiline();
    f.setText(ansi(value));
    f.addToPage(page, { x, y: yy, width: w, height: hgt, font: helv, backgroundColor: fieldBg, borderColor: hair, borderWidth: 0.8 });
    f.setFontSize(multi ? 10 : 11);
    if (readOnly) f.enableReadOnly();
  };

  // Kopf
  put(h.name, L, y, { size: 16, font: bold }); y -= 16;
  const addr = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
  if (addr) { put(addr, L, y, { size: 9, color: grey }); y -= 12; }
  const contact = [h.phone && `Tel. ${h.phone}`, h.email].filter(Boolean).join(' · ');
  if (contact) { put(contact, L, y, { size: 9, color: grey }); y -= 12; }
  y -= 18;
  put(`Leistungskatalog: ${d.catalogName}`, L, y, { size: 14, font: bold });
  put(`zu Ihrer Anfrage ${d.offerNumber}`, R, y, { size: 9, color: grey, right: true });
  y -= 22;
  for (const l of wrap('Bitte kreuzen Sie die gewünschten Leistungen an, ergänzen Sie Ihre Angaben, speichern Sie das PDF und schicken Sie es uns per E-Mail zurück. '
    + 'Sie erhalten danach ein verbindliches Angebot. Das Ankreuzen ist noch keine Buchung.', R - L, 10)) { put(l, L, y); y -= 14; }
  y -= 10;

  // Angaben
  const half = (R - L - 16) / 2;
  put('Name / Firma', L, y, { size: 8.5, color: grey }); put('Wunschtermin', L + half + 16, y, { size: 8.5, color: grey }); y -= 22;
  text('name', d.customer, L, y, half, 18); text('termin', d.date, L + half + 16, y, half * 0.6, 18);
  y -= 16;
  put('Personen (ca.)', L, y, { size: 8.5, color: grey }); y -= 22;
  text('personen', d.persons ? String(d.persons) : '', L, y, 70, 18);
  // Angebotsnummer zum Wiedererkennen beim Einlesen (nicht änderbar)
  text('angebot', d.offerNumber, R - 120, y, 120, 18, false, true);
  put('Nr.', R - 136, y + 5, { size: 8.5, color: grey });
  y -= 30;

  // Leistungen
  put('Leistung', L + 24, y, { size: 9, font: bold });
  if (d.showPrices) put('Preis', R, y, { size: 9, font: bold, right: true });
  y -= 6; page.drawLine({ start: { x: L, y }, end: { x: R, y }, thickness: 0.8, color: black }); y -= 18;
  const groups = groupItems(d.items);
  for (const grp of groups) {
  if (groups.length > 1) { if (y - 60 < bottom) newPage(); y -= 4; put(grp.name, L, y, { size: 11, font: bold, color: grey }); y -= 20; }
  for (const it of grp.items) {
    const priceText = d.showPrices ? `${money(it.priceCents)} ${UNIT_LABEL[it.unit]}` : '';
    const nameW = R - (L + 24) - (priceText ? regular.widthOfTextAtSize(priceText, 9.5) + 14 : 0);
    const nameLines = wrap(it.name, nameW, 10.5, bold), descLines = it.description ? wrap(it.description, R - (L + 24), 9) : [];
    const hgt = nameLines.length * 14 + descLines.length * 12 + 10;
    if (y - hgt < bottom) newPage();
    const cb = form.createCheckBox(`pos_${it.id}`);
    cb.addToPage(page, { x: L, y: y - 3, width: 14, height: 14, borderColor: black, borderWidth: 1, backgroundColor: fieldBg });
    if (d.checked.includes(it.id)) cb.check();
    let yy = y;
    nameLines.forEach((l) => { put(l, L + 24, yy, { size: 10.5, font: bold }); yy -= 14; });
    if (priceText) put(priceText, R, y, { size: 9.5, right: true });
    descLines.forEach((l) => { put(l, L + 24, yy + 1, { size: 9, color: grey }); yy -= 12; });
    y = yy - 6;
    page.drawLine({ start: { x: L + 24, y: y + 6 }, end: { x: R, y: y + 6 }, thickness: 0.4, color: hair });
    y -= 6;
  }
  }
  if (d.showPrices) { put('Preise inkl. Umsatzsteuer. Die endgültigen Preise stehen im Angebot.', L, y, { size: 8.5, color: grey }); y -= 14; }

  // Bemerkungen
  if (y - 120 < bottom) newPage();
  y -= 12;
  put('Weitere Wünsche, Fragen, Uhrzeiten, Allergien …', L, y, { size: 8.5, color: grey }); y -= 96;
  text('bemerkungen', '', L, y, R - L, 90, true);

  // Fußzeile
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const s = `${h.name}${h.phone ? ` · Tel. ${h.phone}` : ''}${h.email ? ` · ${h.email}` : ''}   Seite ${i + 1} von ${pages.length}`;
    p.drawText(s, { x: L, y: 36, size: 8, font: regular, color: grey });
  });
  // Darstellung der Felder mit Helvetica (Standardschrift jedes PDF-Programms)
  form.updateFieldAppearances(helv);
  return doc.save();
}

/** Ausgefülltes Katalog-PDF einlesen: angekreuzte Leistungen und Angaben des Kunden */
export async function readCatalogPdf(data: Uint8Array, knownItemIds: string[]): Promise<Omit<CatalogReturn, 'warnings'> & { found: boolean; unknown: number }> {
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(data, { updateMetadata: false }); }
  catch { throw new Error('bad_pdf'); }
  const form = doc.getForm();
  const fields = form.getFields();
  const get = (n: string) => { const f = fields.find((x) => x.getName() === n); return f instanceof PDFTextField ? (f.getText() ?? '').trim() : ''; };
  const boxes = fields.filter((f): f is PDFCheckBox => f instanceof PDFCheckBox && f.getName().startsWith('pos_'));
  const ticked = boxes.filter((b) => b.isChecked()).map((b) => b.getName().slice(4));
  const itemIds = ticked.filter((id) => knownItemIds.includes(id));
  const p = Number.parseInt(get('personen').replace(/\D/g, ''), 10);
  return {
    found: boxes.length > 0, unknown: ticked.length - itemIds.length, itemIds,
    persons: Number.isFinite(p) && p > 0 && p <= 5000 ? p : null,
    date: get('termin').slice(0, 100), name: get('name').slice(0, 160), remarks: get('bemerkungen').slice(0, 2000), offerNumber: get('angebot').slice(0, 40),
  };
}
