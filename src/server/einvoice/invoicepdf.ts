import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { InvoiceDto, IssuerDto } from '../../shared/billing.js';
import { asset } from './pdf.js';

/**
 * Das Rechnungs-PDF des Hotels (A4, eingebettete Schrift). Dieselbe Datei dient für Druck, Download, E-Mail,
 * Archiv und als Träger der E-Rechnung. Ausgestellte Rechnungen werden einmal erzeugt und dann unverändert aufbewahrt.
 */
export interface Logo { mime: 'image/png' | 'image/jpeg'; data: Buffer }

const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const de = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–');
const num = (n: number) => n.toLocaleString('de-DE');

export async function renderInvoice(inv: InvoiceDto, issuer: IssuerDto, logo: Logo | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true });
  let image: PDFImage | null = null;
  if (logo) { try { image = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { image = null; } }
  const cancel = inv.kind === 'cancellation';
  const draft = inv.status === 'draft';
  const title = cancel ? 'Stornobeleg' : 'Rechnung';
  doc.setTitle(inv.number ? `${title} ${inv.number}` : 'Rechnungsentwurf');
  doc.setAuthor(issuer.name);

  const W = 595.28, H = 841.89, L = 56, R = W - 56;
  const black = rgb(0, 0, 0), grey = rgb(0.35, 0.35, 0.35);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - 60;
  const put = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean } = {}) => {
    const size = o.size ?? 10, font = o.font ?? regular;
    page.drawText(s, { x: o.right ? x - font.widthOfTextAtSize(s, size) : x, y: yy, size, font, color: o.color ?? black });
  };
  const line = (yy: number, w = 0.7) => page.drawLine({ start: { x: L, y: yy }, end: { x: R, y: yy }, thickness: w, color: black });
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
  const footerLines = [issuer.footer, [issuer.taxNumber && `Steuernummer: ${issuer.taxNumber}`, issuer.vatId && `USt-IdNr.: ${issuer.vatId}`].filter(Boolean).join(' · '),
    [issuer.bankName, issuer.iban && `IBAN ${issuer.iban}`, issuer.bic && `BIC ${issuer.bic}`].filter(Boolean).join(' · ')].filter(Boolean).flatMap((f) => wrap(f, R - L, 8));
  const decorate = () => {
    let fy = 40 + footerLines.length * 10;
    page.drawLine({ start: { x: L, y: fy + 6 }, end: { x: R, y: fy + 6 }, thickness: 0.4, color: grey });
    for (const f of footerLines) { fy -= 10; put(f, L, fy, { size: 8, color: grey }); }
    if (draft) page.drawText('ENTWURF', { x: 120, y: 300, size: 90, font: bold, color: rgb(0.88, 0.88, 0.88), rotate: degrees(35) });
  };
  const bottom = 70 + footerLines.length * 10;
  const need = (h: number) => { if (y - h < bottom) { decorate(); page = doc.addPage([W, H]); y = H - 60; return true; } return false; };

  // Kopf: Logo rechts oben, Name und Anschrift links
  if (image) {
    const s = Math.min(150 / image.width, 56 / image.height, 1);
    page.drawImage(image, { x: R - image.width * s, y: H - 40 - image.height * s, width: image.width * s, height: image.height * s });
  }
  put(issuer.name, L, y, { size: 16, font: bold });
  y -= 15;
  put([issuer.street, `${issuer.zip} ${issuer.city}`.trim()].filter(Boolean).join(' · '), L, y, { size: 9, color: grey });
  y -= 11;
  put([issuer.phone && `Tel. ${issuer.phone}`, issuer.email, issuer.website].filter(Boolean).join(' · '), L, y, { size: 9, color: grey });
  y -= 8;
  line(y, 1.2);

  // Empfänger und Rechnungsdaten
  y -= 40;
  const top = y;
  put([issuer.name, issuer.street, `${issuer.zip} ${issuer.city}`.trim()].filter(Boolean).join(' · '), L, y + 14, { size: 6.5, color: grey });
  for (const s of [inv.recipientCompany, inv.recipientName, inv.recipientStreet, `${inv.recipientZip} ${inv.recipientCity}`.trim(),
    inv.recipientCountry && inv.recipientCountry !== 'Deutschland' ? inv.recipientCountry : '', inv.recipientVatId && `USt-IdNr.: ${inv.recipientVatId}`].filter(Boolean) as string[]) {
    put(s, L, y, { size: 10.5 });
    y -= 14;
  }
  let my = top;
  const meta: [string, string][] = [[cancel ? 'Stornobeleg-Nr.' : 'Rechnungsnummer', inv.number ?? '–'], ['Rechnungsdatum', de(inv.issueDate)],
    ['Leistungszeitraum', !inv.serviceFrom ? '–' : inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? `${de(inv.serviceFrom)} – ${de(inv.serviceTo)}` : de(inv.serviceFrom)]];
  if (inv.bookingNumber) meta.push(['Buchungsnummer', inv.bookingNumber]);
  if (cancel && inv.cancelsNumber) meta.push(['Storno zu', inv.cancelsNumber]);
  for (const [k, v] of meta) { put(k, 350, my, { size: 9.5, color: grey }); put(v, R, my, { size: 9.5, right: true }); my -= 14; }
  y = Math.min(y, my) - 26;
  put(title, L, y, { size: 14, font: bold });
  y -= 22;

  // Positionen
  const cols = { pos: L, name: L + 26, qty: 350, unit: 425, rate: 468, total: R };
  const headRow = () => {
    put('Pos.', cols.pos, y, { size: 8.5, color: grey }); put('Leistung', cols.name, y, { size: 8.5, color: grey });
    put('Menge', cols.qty, y, { size: 8.5, color: grey, right: true }); put('Einzelpreis', cols.unit, y, { size: 8.5, color: grey, right: true });
    put('USt', cols.rate, y, { size: 8.5, color: grey, right: true }); put('Betrag', cols.total, y, { size: 8.5, color: grey, right: true });
    y -= 6; line(y, 0.5); y -= 14;
  };
  headRow();
  for (const l of inv.lines) {
    const text = wrap(l.description, cols.qty - 50 - cols.name, 10);
    const detail = l.detail ? wrap(l.detail, cols.qty - 50 - cols.name, 8.5) : [];
    if (need(text.length * 12 + detail.length * 10.5 + 8)) headRow();
    put(String(l.pos), cols.pos, y); put(num(l.quantity), cols.qty, y, { right: true });
    put(money(l.unitPriceCents), cols.unit, y, { right: true }); put(`${num(l.taxRatePercent)} %`, cols.rate, y, { right: true });
    put(money(l.totalCents), cols.total, y, { right: true });
    text.forEach((t, k) => put(t, cols.name, y - k * 12));
    y -= text.length * 12;
    detail.forEach((t, k) => put(t, cols.name, y - k * 10.5, { size: 8.5, color: grey }));
    y -= detail.length * 10.5 + 6;
  }
  line(y + 6, 0.5);

  // Summen
  need(60 + inv.taxes.length * 13 + 60);
  y -= 8;
  for (const t of inv.taxes) {
    put(`Nettobetrag ${num(t.rate)} %: ${money(t.netCents)} · enthaltene Umsatzsteuer ${num(t.rate)} %`, L, y, { size: 9, color: grey });
    put(money(t.taxCents), R, y, { size: 9, color: grey, right: true });
    y -= 13;
  }
  y -= 2; line(y + 8, 1.2); y -= 8;
  put('Gesamtbetrag (brutto)', L, y, { font: bold }); put(money(inv.grossCents), R, y, { font: bold, right: true });
  y -= 16;
  if (!cancel && inv.paidCents !== 0) {
    // Zahlungen je Zahlungsart, wie sie beim Erzeugen des PDFs gebucht waren
    const byMethod = new Map<string, number>();
    for (const p of inv.payments) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);
    for (const [m, c] of byMethod) if (c !== 0) { put(`Bezahlt (${m})`, L, y, { color: grey }); put(money(-c), R, y, { color: grey, right: true }); y -= 14; }
    y -= 2;
    put(inv.openCents > 0 ? 'Zu zahlen' : inv.openCents < 0 ? 'Guthaben' : 'Offener Betrag', L, y, { font: bold }); put(money(Math.abs(inv.openCents)), R, y, { font: bold, right: true });
    y -= 16;
  }
  y -= 10;
  const closing = [inv.notes,
    !cancel && !draft && inv.openCents > 0 && inv.dueDate ? `Bitte überweisen Sie den Betrag bis zum ${de(inv.dueDate)} unter Angabe der Rechnungsnummer ${inv.number}.` : '',
    !cancel && inv.openCents === 0 && inv.paidCents !== 0 ? 'Der Rechnungsbetrag wurde vollständig bezahlt. Vielen Dank!' : ''].filter(Boolean).join('\n');
  for (const t of closing ? wrap(closing, R - L, 10) : []) { need(14); put(t, L, y); y -= 13; }
  decorate();
  return doc.save();
}
