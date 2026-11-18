import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { InvoiceDto, IssuerDto } from '../../shared/billing.js';
import QRCode from 'qrcode';
import { asset } from './pdf.js';

/**
 * Das Rechnungs-PDF des Hotels (A4, eingebettete Schrift). Dieselbe Datei dient für Druck, Download, E-Mail,
 * Archiv und als Träger der E-Rechnung. Ausgestellte Rechnungen werden einmal erzeugt und dann unverändert aufbewahrt.
 */
export interface Logo { mime: 'image/png' | 'image/jpeg'; data: Buffer }
/** Gestaltung der Rechnung (Einstellungen → Haus → Rechnungslayout) */
export interface InvoiceLayout {
  spacing: 'compact' | 'normal' | 'wide'; fontSize: 'small' | 'normal' | 'large'; intro: string; closing: string;
  /** Gesamtbild: klassisch (grau hinterlegt), modern (Farbbalken, farbige Kopfzeile), elegant (feine Linien, Versalien) */
  style: 'classic' | 'modern' | 'elegant';
  accent: 'black' | 'blue' | 'green' | 'red' | 'gold' | 'petrol' | 'custom';
  font: 'sans' | 'serif';
  logoPos: 'right' | 'left' | 'center';
  table: 'lines' | 'stripes' | 'plain';
  accentHex: string; logoSize: 'small' | 'normal' | 'large';
  foldMarks: boolean; qrCode: boolean; letterhead: boolean; senderLine: boolean;
}
export const DEFAULT_LAYOUT: InvoiceLayout = { spacing: 'normal', fontSize: 'normal', intro: '', closing: '', style: 'classic', accent: 'black', font: 'sans', logoPos: 'right', table: 'lines',
  accentHex: '#1c457a', logoSize: 'normal', foldMarks: false, qrCode: false, letterhead: false, senderLine: true };
const ACCENTS: Record<Exclude<InvoiceLayout['accent'], 'custom'>, [number, number, number]> = {
  black: [0.1, 0.1, 0.1], blue: [0.11, 0.27, 0.48], green: [0.13, 0.36, 0.25], red: [0.5, 0.12, 0.16], gold: [0.55, 0.42, 0.16], petrol: [0.07, 0.38, 0.42],
};
/** Akzentfarbe als RGB (0–1); eigene Farbe wird zu hell gewählt etwas abgedunkelt, damit Text darauf lesbar bleibt */
export function accentRgb(l: Pick<InvoiceLayout, 'accent' | 'accentHex'>): [number, number, number] {
  if (l.accent !== 'custom') return ACCENTS[l.accent] ?? ACCENTS.black;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(l.accentHex ?? '');
  if (!m) return ACCENTS.black;
  let [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h!, 16) / 255) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 0.55) { const k = 0.55 / lum; r *= k; g *= k; b *= k; }
  return [r, g, b];
}
/** Inhalt des Zahlungs-QR-Codes (GiroCode / EPC-QR, Version 002) – nur bei gültiger IBAN und Betrag > 0 */
export function epcPayload(o: { name: string; iban: string; bic: string; cents: number; text: string }): string | null {
  const iban = o.iban.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) || o.cents <= 0 || o.cents > 99_999_999_999 || !o.name.trim()) return null;
  return ['BCD', '002', '1', 'SCT', o.bic.replace(/\s+/g, '').toUpperCase(), o.name.trim().slice(0, 70), iban, `EUR${(o.cents / 100).toFixed(2)}`, '', '', o.text.slice(0, 140)].join('\n');
}

const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const de = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const num = (n: number) => n.toLocaleString('de-DE');

export async function renderInvoice(inv: InvoiceDto, issuer: IssuerDto, logo: Logo | null, layoutIn: Partial<InvoiceLayout> = DEFAULT_LAYOUT): Promise<Uint8Array> {
  const layout: InvoiceLayout = { ...DEFAULT_LAYOUT, ...layoutIn };
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const family = layout.font === 'serif' ? 'LiberationSerif' : 'LiberationSans';
  const regular = await doc.embedFont(asset(`${family}-Regular.ttf`), { subset: true });
  const bold = await doc.embedFont(asset(`${family}-Bold.ttf`), { subset: true });
  let image: PDFImage | null = null;
  if (logo) { try { image = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { image = null; } }
  const cancel = inv.kind === 'cancellation';
  const draft = inv.status === 'draft';
  const title = cancel ? 'Stornobeleg' : 'Rechnung';
  doc.setTitle(inv.number ? `${title} ${inv.number}` : 'Rechnungsentwurf');
  doc.setAuthor(issuer.name);

  // f = Schriftgröße, g = Abstände
  const f = layout.fontSize === 'small' ? 0.92 : layout.fontSize === 'large' ? 1.1 : 1;
  const g = (layout.spacing === 'compact' ? 0.8 : layout.spacing === 'wide' ? 1.25 : 1) * f;
  const W = 595.28, H = 841.89, L = 62, R = W - 54;
  const black = rgb(0.1, 0.1, 0.1), grey = rgb(0.38, 0.38, 0.38), hair = rgb(0.82, 0.82, 0.82), band = rgb(0.95, 0.95, 0.95);
  const acc = rgb(...accentRgb(layout)), white = rgb(1, 1, 1);
  const lh = layout.letterhead;
  const modern = layout.style === 'modern', elegant = layout.style === 'elegant';
  const pages: PDFPage[] = [];
  let page: PDFPage = doc.addPage([W, H]);
  pages.push(page);
  let y = H - 62;
  const put = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean } = {}) => {
    const size = (o.size ?? 10) * f, font = o.font ?? regular;
    page.drawText(s, { x: o.right ? x - font.widthOfTextAtSize(s, size) : x, y: yy, size, font, color: o.color ?? black });
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

  // Fuß: freie Fußzeile, darunter drei Spalten (Anschrift · Steuer · Bank)
  const colW = (R - L) / 3;
  const footCols = [
    [issuer.name, issuer.street, `${issuer.zip} ${issuer.city}`.trim()],
    [issuer.phone && `Tel. ${issuer.phone}`, issuer.email, issuer.website, issuer.taxNumber && `Steuernummer ${issuer.taxNumber}`, issuer.vatId && `USt-IdNr. ${issuer.vatId}`],
    [issuer.bankName, issuer.iban && `IBAN ${issuer.iban}`, issuer.bic && `BIC ${issuer.bic}`],
  ].map((c) => (c.filter(Boolean) as string[]).flatMap((t) => wrap(t, colW - 10, 7.5)));
  const footFree = issuer.footer ? wrap(issuer.footer, R - L, 8) : [];
  const footLead = 9.5 * f;
  const footH = Math.max(...footCols.map((c) => c.length)) * footLead + footFree.length * (10 * f) + (footFree.length ? 6 : 0);
  const bottom = 46 + footH + 22;
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - 62; };
  const need = (h: number) => { if (y - h < bottom) { newPage(); return true; } return false; };

  // Kopf: Logo rechts, links oder mittig; der Text weicht dem Logo aus
  // Briefpapier: Kopf und Fuß sind vorgedruckt – der Platz bleibt frei, gezeichnet wird dort nichts
  if (modern && !lh) page.drawRectangle({ x: 0, y: H - 12, width: W, height: 12, color: acc });
  const pos = layout.logoPos;
  let logoBottom = H;
  if (image) {
    const k = layout.logoSize === 'small' ? 0.72 : layout.logoSize === 'large' ? 1.4 : 1;
    const s = Math.min((170 * k) / image.width, (64 * k) / image.height, 1.5), w = image.width * s, h = image.height * s;
    if (!lh) page.drawImage(image, { x: pos === 'left' ? L : pos === 'center' ? (L + R) / 2 - w / 2 : R - w, y: H - 38 - h, width: w, height: h });
    logoBottom = H - 38 - h;
    if (pos === 'center') y = logoBottom - 24 * f;
  }
  const hput = (s: string, yy: number, o: { size: number; font?: PDFFont; color?: typeof black }) => {
    if (lh) return;
    const w = (o.font ?? regular).widthOfTextAtSize(s, o.size * f);
    put(s, pos === 'center' ? (L + R) / 2 - w / 2 : pos === 'left' && image ? R - w : L, yy, o);
  };
  hput(issuer.name, y, { size: 17, font: bold, color: layout.style === 'classic' ? black : acc });
  y -= 16 * f;
  hput([issuer.street, `${issuer.zip} ${issuer.city}`.trim()].filter(Boolean).join(' · '), y, { size: 9, color: grey });
  y -= 12 * f;
  hput([issuer.phone && `Tel. ${issuer.phone}`, issuer.email, issuer.website].filter(Boolean).join(' · '), y, { size: 9, color: grey });
  y = Math.min(y, pos === 'center' ? y : logoBottom - 2) - 12;
  if (lh) { /* Briefpapier: keine Linie */ } else if (elegant) { rule(y, 0.6, acc); rule(y - 2.6, 0.6, acc); } else rule(y, modern ? 0.5 : 1, modern ? hair : acc);

  // Anschriftfeld (für Fensterumschläge) und Rechnungsdaten rechts daneben
  y -= 52 * g;
  const top = y;
  if (layout.senderLine) put([issuer.name, issuer.street, `${issuer.zip} ${issuer.city}`.trim()].filter(Boolean).join(' · '), L, y + 16 * f, { size: 6.5, color: grey });
  for (const s of [inv.recipientCompany, inv.recipientName, inv.recipientStreet, `${inv.recipientZip} ${inv.recipientCity}`.trim(),
    inv.recipientCountry && inv.recipientCountry !== 'Deutschland' ? inv.recipientCountry : '', inv.recipientVatId && `USt-IdNr.: ${inv.recipientVatId}`].filter(Boolean) as string[]) {
    put(s, L, y, { size: 11 });
    y -= 15.5 * f;
  }
  let my = top;
  const meta: [string, string][] = [[cancel ? 'Stornobeleg-Nr.' : 'Rechnungsnummer', inv.number ?? '–'], ['Rechnungsdatum', de(inv.issueDate)],
    ['Leistungszeitraum', !inv.serviceFrom ? '–' : inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? `${de(inv.serviceFrom)} – ${de(inv.serviceTo)}` : de(inv.serviceFrom)]];
  if (inv.bookingNumber) meta.push(['Buchungsnummer', inv.bookingNumber]);
  if (cancel && inv.cancelsNumber) meta.push(['Storno zu', inv.cancelsNumber]);
  for (const [k, v] of meta) { put(k, 345, my, { size: 9.5, color: grey }); put(v, R, my, { size: 9.5, right: true }); my -= 16 * f; }
  y = Math.min(y, my, top - 5 * 15.5 * f) - 34 * g;
  const heading = inv.number && !draft ? `${title} ${inv.number}` : title;
  put(elegant ? heading.toUpperCase() : heading, L, y, { size: elegant ? 14 : 16, font: bold, color: layout.style === 'classic' ? black : acc });
  y -= 24 * g;
  if (layout.intro && !cancel) { for (const t of wrap(layout.intro, R - L, 10)) { put(t, L, y); y -= 14 * f; } y -= 10 * g; }

  // Positionen
  const cols = { pos: L + 6, name: L + 34, qty: 352, unit: 428, rate: 470, total: R - 6 };
  const lead = 13 * f, dlead = 11.5 * f, pad = 8 * g, headGrey = grey;
  const headRow = () => {
    const hh = 12 * f + pad * 1.4;
    if (elegant) { rule(y + 12 * f, 0.8, acc); rule(y - hh + 12 * f, 0.8, acc); }
    else page.drawRectangle({ x: L, y: y - hh + 12 * f, width: R - L, height: hh, color: modern ? acc : band });
    const grey = modern ? white : elegant ? acc : headGrey;
    const ty = y - hh / 2 + 12 * f - 3 * f;
    put('Pos.', cols.pos, ty, { size: 8.5, font: bold, color: grey }); put('Leistung', cols.name, ty, { size: 8.5, font: bold, color: grey });
    put('Menge', cols.qty, ty, { size: 8.5, font: bold, color: grey, right: true }); put('Einzelpreis', cols.unit, ty, { size: 8.5, font: bold, color: grey, right: true });
    put('USt', cols.rate, ty, { size: 8.5, font: bold, color: grey, right: true }); put('Betrag', cols.total, ty, { size: 8.5, font: bold, color: grey, right: true });
    y -= hh + pad;
  };
  headRow();
  inv.lines.forEach((l, idx) => {
    const text = wrap(l.description, cols.qty - 46 - cols.name, 10);
    const detail = l.detail ? wrap(l.detail, cols.qty - 46 - cols.name, 8.5) : [];
    const h = text.length * lead + detail.length * dlead + pad * 2;
    if (need(h)) headRow();
    else if (idx > 0 && layout.table === 'lines') rule(y + lead - 2 * f + pad - 1);
    if (layout.table === 'stripes' && idx % 2 === 1) page.drawRectangle({ x: L, y: y + lead - 2 * f + pad - 1 - h, width: R - L, height: h, color: rgb(0.965, 0.965, 0.965) });
    put(String(l.pos), cols.pos, y, { color: grey }); put(num(l.quantity), cols.qty, y, { right: true });
    put(money(l.unitPriceCents), cols.unit, y, { right: true }); put(`${num(l.taxRatePercent)} %`, cols.rate, y, { right: true });
    put(money(l.totalCents), cols.total, y, { right: true });
    text.forEach((t, k) => put(t, cols.name, y - k * lead));
    y -= text.length * lead;
    detail.forEach((t, k) => put(t, cols.name, y - k * dlead, { size: 8.5, color: grey }));
    y -= detail.length * dlead + pad * 2 - lead + lead;
  });
  rule(y + lead - 2 * f + pad - 1, 0.8, elegant ? acc : grey);

  // Summen: rechtsbündiger Block
  const sx = 330, row = 15 * f;
  const payRows = !cancel && inv.paidCents !== 0 ? new Set(inv.payments.map((p) => p.method)).size + 1 : 0;
  need(inv.taxes.length * 2 * row + 34 * f + payRows * row + 30 * g);
  y -= 4 * g;
  for (const t of inv.taxes) {
    put(`Nettobetrag ${num(t.rate)} %`, sx, y, { size: 9.5, color: grey }); put(money(t.netCents), cols.total, y, { size: 9.5, color: grey, right: true });
    y -= row;
    put(`Umsatzsteuer ${num(t.rate)} %`, sx, y, { size: 9.5, color: grey }); put(money(t.taxCents), cols.total, y, { size: 9.5, color: grey, right: true });
    y -= row;
  }
  y -= 4 * f;
  if (elegant) { rule(y + 16 * f, 0.8, acc, sx - 8, R); rule(y - 8 * f, 0.8, acc, sx - 8, R); rule(y - 8 * f - 2.6, 0.8, acc, sx - 8, R); }
  else page.drawRectangle({ x: sx - 8, y: y - 8 * f, width: R - sx + 8, height: 24 * f, color: modern ? acc : band });
  const tc = modern ? white : elegant ? acc : black;
  put('Gesamtbetrag', sx, y, { size: 11.5, font: bold, color: tc }); put(money(inv.grossCents), cols.total, y, { size: 11.5, font: bold, right: true, color: tc });
  y -= 26 * f;
  if (!cancel && inv.paidCents !== 0) {
    // Zahlungen je Zahlungsart, wie sie beim Erzeugen des PDFs gebucht waren
    const byMethod = new Map<string, number>();
    for (const p of inv.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    for (const [m, c] of byMethod) if (c !== 0) { put(`Bezahlt (${m})`, sx, y, { size: 9.5, color: grey }); put(money(-c), cols.total, y, { size: 9.5, color: grey, right: true }); y -= row; }
    // Verrechnung mit einer anderen Rechnung derselben Reservierung (z. B. Anzahlung auf der ersten Teilrechnung)
    const cr = inv.creditCents ?? 0;
    if (cr !== 0) { put(cr > 0 ? 'Verrechnet aus Anzahlung (andere Rechnung)' : 'Übertrag auf andere Rechnung', sx, y, { size: 9.5, color: grey }); put(money(-cr), cols.total, y, { size: 9.5, color: grey, right: true }); y -= row; }
    y -= 2;
    put(inv.openCents > 0 ? 'Zu zahlen' : inv.openCents < 0 ? 'Guthaben' : 'Offener Betrag', sx, y, { font: bold }); put(money(Math.abs(inv.openCents)), cols.total, y, { font: bold, right: true });
    y -= row;
  }
  y -= 22 * g;
  // Offener Betrag mit hinterlegter IBAN: eigener Abschnitt „Zahlung per Überweisung“ (statt nur eines Satzes im Schlusstext)
  const payBlock = !cancel && !draft && inv.openCents > 0 && !!(issuer.iban ?? '').trim();
  const closing = [inv.notes,
    !cancel && !draft && inv.openCents > 0 && inv.dueDate && !payBlock ? `Bitte überweisen Sie den Betrag bis zum ${de(inv.dueDate)} unter Angabe der Rechnungsnummer ${inv.number}.` : '',
    !cancel && inv.openCents === 0 && inv.paidCents !== 0 ? 'Der Rechnungsbetrag wurde vollständig bezahlt. Vielen Dank!' : '',
    !cancel ? layout.closing : ''].filter(Boolean).join('\n\n');

  if (payBlock) {
    // GiroCode (wenn eingeschaltet) daneben
    const epc = layout.qrCode ? epcPayload({ name: issuer.name, iban: issuer.iban ?? '', bic: issuer.bic ?? '', cents: inv.openCents, text: `Rechnung ${inv.number ?? ''}`.trim() }) : null;
    const size = 82;
    const iban = (issuer.iban ?? '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
    const rows: [string, string][] = [['Empfänger', issuer.name], ['IBAN', iban], ...(issuer.bic ? [['BIC', issuer.bic] as [string, string]] : []),
      ...(issuer.bankName ? [['Bank', issuer.bankName] as [string, string]] : []), ['Betrag', money(inv.openCents)], ['Verwendungszweck', `Rechnung ${inv.number ?? ''}`.trim()]];
    const lineH = 13.5 * f;
    const boxH = Math.max(epc ? size + 36 : 0, 40 * f + rows.length * lineH);
    need(boxH + 16 * g);
    y -= 4 * g;
    const top = y + 10 * f;
    page.drawRectangle({ x: L, y: top - boxH, width: R - L, height: boxH, borderColor: elegant ? acc : hair, borderWidth: elegant ? 0.8 : 0.6, color: rgb(0.985, 0.985, 0.985) });
    const tx = L + 12;
    let ty = top - 18 * f;
    put('Zahlung per Überweisung', tx, ty, { size: 10.5, font: bold, color: layout.style === 'classic' ? black : acc });
    ty -= 15 * f;
    put(inv.dueDate ? `Bitte überweisen Sie ${money(inv.openCents)} bis zum ${de(inv.dueDate)} auf folgendes Konto:` : `Bitte überweisen Sie ${money(inv.openCents)} auf folgendes Konto:`, tx, ty, { size: 9.5 });
    ty -= lineH + 2;
    for (const [k, v] of rows) { put(k, tx, ty, { size: 9.5, color: grey }); put(v, tx + 105, ty, { size: 9.5, font: k === 'IBAN' || k === 'Betrag' || k === 'Verwendungszweck' ? bold : regular }); ty -= lineH; }
    if (epc) {
      const png = await QRCode.toBuffer(epc, { errorCorrectionLevel: 'M', margin: 0, width: 360 });
      const qr = await doc.embedPng(png);
      const qx = R - 12 - size;
      page.drawImage(qr, { x: qx, y: top - 10 - size, width: size, height: size });
      put('GiroCode', qx + size / 2 - bold.widthOfTextAtSize('GiroCode', 7.5 * f) / 2, top - 10 - size - 9 * f, { size: 7.5, font: bold, color: grey });
      put('mit der Banking-App scannen', qx + size / 2 - regular.widthOfTextAtSize('mit der Banking-App scannen', 6.5 * f) / 2, top - 10 - size - 17 * f, { size: 6.5, color: grey });
    }
    y = top - boxH - 18 * g;
  }
  for (const t of closing ? wrap(closing, R - L, 10) : []) { need(15 * f); if (t) put(t, L, y); y -= (t ? 14 : 8) * f; }

  // Fuß und Seitenzahl auf jeder Seite
  pages.forEach((pg, i) => {
    page = pg;
    let fy = 40 + footH;
    if (!lh) {
      rule(fy + 8, 0.5, layout.style === 'classic' ? grey : acc);
      for (const t of footFree) { fy -= 10 * f; put(t, L, fy, { size: 8, color: grey }); }
      if (footFree.length) fy -= 6;
      footCols.forEach((c, k) => c.forEach((t, n) => put(t, L + k * colW, fy - (n + 1) * footLead, { size: 7.5, color: grey })));
    }
    // Falzmarken (105 mm und 210 mm von oben) und Lochmarke (148,5 mm) am linken Rand
    if (layout.foldMarks) {
      const mm = 72 / 25.4;
      for (const [at, len] of [[105, 14], [148.5, 20], [210, 14]] as const) page.drawLine({ start: { x: 12, y: H - at * mm }, end: { x: 12 + len, y: H - at * mm }, thickness: 0.5, color: grey });
    }
    if (pages.length > 1) put(`Seite ${i + 1} von ${pages.length}`, R, 26, { size: 7.5, color: grey, right: true });
    if (draft) page.drawText('ENTWURF', { x: 120, y: 300, size: 90, font: bold, color: rgb(0.5, 0.5, 0.5), opacity: 0.16, rotate: degrees(35) });
  });
  return doc.save();
}
