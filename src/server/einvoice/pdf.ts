import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fontkit from '@pdf-lib/fontkit';
import { AFRelationship, PDFDocument, PDFHexString, PDFName, PDFString, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { COUNTRIES, computeEInvoice, type EInvoiceData } from '../../shared/einvoice.js';

/** Ordner mit Schrift und Farbprofil; die Windows-Version setzt ihn ausdrücklich. */
let assetsDir: string | null = null;
export const setAssetsDir = (dir: string) => { assetsDir = dir; };
export function asset(name: string) {
  const dir = assetsDir ?? fileURLToPath(new URL('../../../assets/einvoice', import.meta.url));
  const file = join(dir, name);
  if (!existsSync(file)) throw new Error(`Datei für die E-Rechnung fehlt: ${file}`);
  return readFileSync(file);
}

const money = (cents: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const num = (n: number) => n.toLocaleString('de-DE');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Zeichnet die Rechnung als PDF (A4) mit eingebetteter Schrift – Grundlage für eine PDF/A-3-Datei. */
export async function renderInvoicePdf(d: EInvoiceData, footer: string[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true });
  const c = computeEInvoice(d);
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
  const footerLines = footer.filter(Boolean).flatMap((f) => wrap(f, R - L, 8));
  const drawFooter = () => {
    let fy = 40 + footerLines.length * 10;
    page.drawLine({ start: { x: L, y: fy + 6 }, end: { x: R, y: fy + 6 }, thickness: 0.4, color: grey });
    for (const f of footerLines) { fy -= 10; put(f, L, fy, { size: 8, color: grey }); }
  };
  const bottom = 70 + footerLines.length * 10;
  const need = (h: number) => {
    if (y - h < bottom) { drawFooter(); page = doc.addPage([W, H]); y = H - 60; }
  };

  // Kopf
  put(d.seller.name, L, y, { size: 16, font: bold });
  y -= 15;
  put([d.seller.street, `${d.seller.zip} ${d.seller.city}`.trim()].filter(Boolean).join(' · '), L, y, { size: 9, color: grey });
  put([d.seller.phone && `Tel. ${d.seller.phone}`, d.seller.email].filter(Boolean).join(' · '), R, y, { size: 9, color: grey, right: true });
  y -= 8;
  line(y, 1.2);

  // Empfänger und Rechnungsdaten
  y -= 44;
  const top = y;
  const countryName = COUNTRIES.find(([k]) => k === d.buyer.country)?.[1] ?? d.buyer.country;
  for (const s of [d.buyer.name, d.buyer.street, `${d.buyer.zip} ${d.buyer.city}`.trim(), d.buyer.country !== 'DE' ? countryName : '', d.buyer.vatId && `USt-IdNr.: ${d.buyer.vatId}`].filter(Boolean) as string[]) {
    put(s, L, y, { size: 10.5 });
    y -= 14;
  }
  let my = top;
  for (const [k, v] of [['Rechnungsnummer', d.number], ['Rechnungsdatum', de(d.issueDate)],
    ['Leistungszeitraum', d.serviceFrom === d.serviceTo ? de(d.serviceTo) : `${de(d.serviceFrom)} – ${de(d.serviceTo)}`], ...(d.buyer.reference ? [['Ihre Referenz', d.buyer.reference]] : [])] as [string, string][]) {
    put(k, 350, my, { size: 9.5, color: grey });
    put(v, R, my, { size: 9.5, right: true });
    my -= 14;
  }
  y = Math.min(y, my) - 26;
  put('Rechnung', L, y, { size: 14, font: bold });
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
  d.lines.forEach((l, i) => {
    const text = wrap(l.name, cols.qty - 50 - cols.name, 10);
    need(text.length * 12 + 8);
    if (y === H - 60) headRow();
    put(String(i + 1), cols.pos, y); put(num(l.quantity), cols.qty, y, { right: true });
    put(money(l.unitGrossCents), cols.unit, y, { right: true }); put(`${num(l.taxRate)} %`, cols.rate, y, { right: true });
    put(money(c.lines[i]!.grossCents), cols.total, y, { right: true });
    text.forEach((t, k) => put(t, cols.name, y - k * 12));
    y -= text.length * 12 + 6;
  });
  line(y + 6, 0.5);

  // Summen
  need(40 + c.taxes.length * 13 + 60);
  y -= 8;
  for (const t of c.taxes) {
    put(`Nettobetrag ${num(t.rate)} %: ${money(t.basisCents)} · enthaltene Umsatzsteuer ${num(t.rate)} %`, L, y, { size: 9, color: grey });
    put(money(t.taxCents), R, y, { size: 9, color: grey, right: true });
    y -= 13;
  }
  y -= 2; line(y + 8, 1.2); y -= 8;
  put('Gesamtbetrag (brutto)', L, y, { font: bold }); put(money(c.grossCents), R, y, { font: bold, right: true });
  y -= 16;
  if (d.paidCents) {
    put('Bereits bezahlt', L, y, { color: grey }); put(money(-d.paidCents), R, y, { color: grey, right: true });
    y -= 16;
    put(c.dueCents > 0 ? 'Zu zahlen' : 'Offener Betrag', L, y, { font: bold }); put(money(c.dueCents), R, y, { font: bold, right: true });
    y -= 16;
  }
  y -= 10;
  const closing = [d.note, c.dueCents > 0 ? d.paymentTerms : d.paidCents ? 'Der Rechnungsbetrag wurde vollständig bezahlt. Vielen Dank!' : ''].filter(Boolean).join('\n');
  for (const t of closing ? wrap(closing, R - L, 10) : []) { need(14); put(t, L, y); y -= 13; }
  drawFooter();
  return doc;
}

export interface EmbedMeta { title: string; author: string; generated: boolean }

/**
 * Bettet die Rechnungsdaten als „factur-x.xml“ in die PDF-Datei ein und ergänzt die für ZUGFeRD/Factur-X
 * vorgesehenen Angaben (Beziehung „Alternative“, XMP-Metadaten mit PDF/A-3- und Factur-X-Kennzeichnung, Farbprofil).
 * Ob die Datei insgesamt PDF/A-3 erfüllt, hängt bei hochgeladenen PDFs von der Ausgangsdatei ab.
 */
export async function embedXml(doc: PDFDocument, xml: string, meta: EmbedMeta): Promise<Uint8Array> {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const producer = 'Schützenhaus PMS';
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setProducer(producer);
  doc.setCreator(producer);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  // pdf-lib legt Subject/Keywords nicht an – XMP unten führt dieselben Felder wie das Info-Verzeichnis

  await doc.attach(new TextEncoder().encode(xml), 'factur-x.xml', {
    mimeType: 'text/xml', description: 'Rechnungsdaten im Format Factur-X/ZUGFeRD (EN 16931)',
    creationDate: now, modificationDate: now, afRelationship: AFRelationship.Alternative,
  });

  const iso = now.toISOString().replace('.000Z', 'Z');
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(meta.title)}</rdf:li></rdf:Alt></dc:title>
   <dc:creator><rdf:Seq><rdf:li>${esc(meta.author)}</rdf:li></rdf:Seq></dc:creator>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdf:Producer>${producer}</pdf:Producer></rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>${producer}</xmp:CreatorTool><xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/" xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#" xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
   <pdfaExtension:schemas><rdf:Bag><rdf:li rdf:parseType="Resource">
    <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
    <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
    <pdfaSchema:prefix>fx</pdfaSchema:prefix>
    <pdfaSchema:property><rdf:Seq>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentFileName</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Name der eingebetteten XML-Datei</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>DocumentType</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>INVOICE</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>Version</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Version des Factur-X-XML-Schemas</pdfaProperty:description></rdf:li>
     <rdf:li rdf:parseType="Resource"><pdfaProperty:name>ConformanceLevel</pdfaProperty:name><pdfaProperty:valueType>Text</pdfaProperty:valueType><pdfaProperty:category>external</pdfaProperty:category><pdfaProperty:description>Profil der Factur-X-Rechnungsdaten</pdfaProperty:description></rdf:li>
    </rdf:Seq></pdfaSchema:property>
   </rdf:li></rdf:Bag></pdfaExtension:schemas>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
   <fx:DocumentType>INVOICE</fx:DocumentType><fx:DocumentFileName>factur-x.xml</fx:DocumentFileName><fx:Version>1.0</fx:Version><fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
  const xmpBytes = new TextEncoder().encode(xmp);
  const metaRef = doc.context.register(doc.context.stream(xmpBytes, { Type: 'Metadata', Subtype: 'XML', Length: xmpBytes.length }));
  doc.catalog.set(PDFName.of('Metadata'), metaRef);

  if (!doc.catalog.get(PDFName.of('OutputIntents'))) {
    const iccRef = doc.context.register(doc.context.flateStream(asset('sRGB.icc'), { N: 3 }));
    const intent = doc.context.register(doc.context.obj({
      Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: iccRef,
    }));
    doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([intent]));
  }
  const id = createHash('md5').update(xml).update(iso).digest('hex').toUpperCase();
  doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
  return doc.save({ useObjectStreams: false });
}

/** Lädt eine hochgeladene PDF-Datei; verschlüsselte oder beschädigte Dateien werden abgelehnt. */
export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (bytes.length < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('Die Datei ist keine PDF-Datei');
  try {
    return await PDFDocument.load(bytes);
  } catch (e) {
    throw new Error(/encrypt/i.test(String(e)) ? 'Die PDF-Datei ist kennwortgeschützt und kann nicht umgewandelt werden' : 'Die PDF-Datei konnte nicht gelesen werden');
  }
}
