/**
 * Angaben aus dem Text einer Rechnungs-PDF herausziehen: Nummer, Daten, Empfänger, Beträge, Positionen.
 * Feste Muster für übliche deutsche Rechnungen – das Ergebnis ist ein Vorschlag für die Eingabefelder der E-Rechnung
 * und muss vor dem Erzeugen mit der PDF verglichen werden.
 */
export interface ExtractedLine { name: string; quantity: number; unitGrossCents: number; taxRate: number }
export interface InvoiceSuggestion {
  number?: string; issueDate?: string; serviceFrom?: string; serviceTo?: string; dueDate?: string;
  buyer?: { name: string; street: string; zip: string; city: string; vatId: string };
  lines?: ExtractedLine[]; grossCents?: number; paidCents?: number;
  /** was gefunden wurde, in Worten */
  found: string[];
  /** worauf der Benutzer achten soll */
  notes: string[];
}
export interface SellerHint { name: string; zip: string; vatId: string }

const MONEY = String.raw`-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}`;
const DATE = String.raw`\d{1,2}\.\d{1,2}\.\d{2,4}`;
const cents = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
const iso = (s: string): string | undefined => {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(s.trim());
  if (!m) return undefined;
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
const euro = (c: number) => `${(c / 100).toFixed(2).replace('.', ',')} €`;

export function extractInvoice(text: string, seller: SellerHint): InvoiceSuggestion {
  const out: InvoiceSuggestion = { found: [], notes: [] };
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const flat = lines.join('\n');
  let m: RegExpExecArray | null;

  // Rechnungsnummer
  m = /(?:Rechnungs?-?\s?(?:nummer|nr\.?|no\.?)|Rechnung\s+Nr\.?|Beleg-?\s?(?:nummer|nr\.?)|Invoice\s+(?:no\.?|number))\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/_.]{1,30})/i.exec(flat);
  if (m && /\d/.test(m[1]!)) { out.number = m[1]!.replace(/[.,]$/, ''); out.found.push(`Rechnungsnummer ${out.number}`); }

  // Daten
  m = new RegExp(String.raw`(?:Rechnungsdatum|Belegdatum|Rechnung vom|Invoice date|Datum)\s*:?\s*(${DATE})`, 'i').exec(flat);
  if (m && iso(m[1]!)) { out.issueDate = iso(m[1]!); out.found.push(`Rechnungsdatum ${m[1]}`); }
  m = new RegExp(String.raw`(?:Leistungszeitraum|Lieferzeitraum|Leistungsdatum|Lieferdatum|Zeitraum|Aufenthalt)\s*:?\s*(?:vom\s*)?(${DATE})(?:\s*(?:–|-|bis)\s*(?:zum\s*)?(${DATE}))?`, 'i').exec(flat);
  if (m && iso(m[1]!)) {
    out.serviceFrom = iso(m[1]!); out.serviceTo = (m[2] && iso(m[2])) || out.serviceFrom;
    out.found.push(`Leistungszeitraum ${m[1]}${m[2] ? ` – ${m[2]}` : ''}`);
  }
  m = new RegExp(String.raw`(?:fällig(?:\s+(?:am|bis|zum))?|zahlbar\s+bis(?:\s+zum)?|Zahlungsziel|zu zahlen bis(?:\s+zum)?)\s*:?\s*(${DATE})`, 'i').exec(flat);
  if (m && iso(m[1]!)) { out.dueDate = iso(m[1]!); out.found.push(`Fälligkeit ${m[1]}`); }

  // Empfänger: Zeile „PLZ Ort“, die nicht zur eigenen Anschrift gehört, mit den Zeilen davor (Name, Straße)
  const own = (l: string) => l.includes('·') || l.includes('|') || (seller.name && l.toLowerCase().includes(seller.name.toLowerCase().slice(0, 12))) || /Tel\.?|Telefon|Fax|E-Mail|@|www\.|IBAN|Steuernummer/i.test(l);
  for (let i = 1; i < lines.length; i++) {
    const z = /^(?:D-|DE-)?(\d{5})\s+([A-Za-zÄÖÜäöüß][^\d]{1,50})$/.exec(lines[i]!);
    if (!z || own(lines[i]!)) continue;
    const before: string[] = [];
    for (let j = i - 1; j >= 0 && before.length < 3; j--) { if (own(lines[j]!) || lines[j]!.length > 70 || /^\d{5}\s/.test(lines[j]!)) break; before.unshift(lines[j]!); }
    if (before.length < 2) continue;
    const street = before.at(-1)!, names = before.slice(0, -1).filter((n) => !/^(Herr|Herrn|Frau|Firma|An)$/i.test(n));
    if (!/\d/.test(street) && names.length === 0) continue;
    out.buyer = { name: names.join(', ').replace(/^(Herr|Frau|Firma|Herrn)\s+/i, ''), street, zip: z[1]!, city: z[2]!.trim(), vatId: '' };
    out.found.push(`Empfänger ${out.buyer.name}, ${z[1]} ${out.buyer.city}`);
    break;
  }
  const ids = [...flat.matchAll(/USt-?\s?Id(?:ent)?-?\s?(?:Nr|Nummer)?\.?\s*:?\s*([A-Z]{2}\s?[A-Z0-9]{8,12})/gi)].map((x) => x[1]!.replace(/\s/g, '')).filter((x) => x !== seller.vatId.replace(/\s/g, ''));
  if (out.buyer && ids[0]) { out.buyer.vatId = ids[0]; out.found.push(`USt-IdNr. des Empfängers ${ids[0]}`); }

  // Beträge
  for (const label of ['Gesamtbetrag', 'Rechnungsbetrag', 'Endbetrag', 'Gesamtsumme', 'Bruttobetrag', 'Summe brutto', 'Gesamt brutto', 'Gesamt']) {
    m = new RegExp(String.raw`${label}[^\n\d-]{0,30}(${MONEY})`, 'i').exec(flat);
    if (m) { out.grossCents = cents(m[1]!); out.found.push(`Gesamtbetrag ${euro(out.grossCents)}`); break; }
  }
  const paid = [...flat.matchAll(new RegExp(String.raw`(?:Bezahlt|Anzahlung|bereits gezahlt|bereits erhalten|Zahlung erhalten)[^\n\d-]{0,30}(${MONEY})`, 'gi'))].reduce((s, x) => s + Math.abs(cents(x[1]!)), 0);
  if (paid > 0) { out.paidCents = paid; out.found.push(`bereits bezahlt ${euro(paid)}`); }

  // Positionen: „Pos Menge Einzelpreis USt Betrag Text“ (so setzt das PMS) oder „Text Menge Einzelpreis [USt] Betrag“
  const pos: ExtractedLine[] = [];
  const a = new RegExp(String.raw`^\d{1,3}\s+(\d+(?:,\d+)?)\s+(${MONEY})\s*€?\s+(\d{1,2}(?:,\d)?)\s*%\s+(${MONEY})\s*€?\s*(.+)$`);
  const b = new RegExp(String.raw`^(?:\d{1,3}\s+)?(.{3,80}?)\s+(\d+(?:,\d+)?)\s*(?:x|Stk\.?|Stück|Nächte|Nacht)?\s+(${MONEY})\s*€?\s+(\d{1,2}(?:,\d)?)\s*%\s+(${MONEY})\s*€?$`);
  for (const l of lines) {
    let x = a.exec(l);
    if (x) { pos.push({ name: x[5]!.slice(0, 200), quantity: Number(x[1]!.replace(',', '.')), unitGrossCents: cents(x[2]!), taxRate: Number(x[3]!.replace(',', '.')) }); continue; }
    x = b.exec(l);
    if (x && !/Netto|Umsatzsteuer|MwSt|Gesamt|Summe/i.test(x[1]!)) pos.push({ name: x[1]!.trim().slice(0, 200), quantity: Number(x[2]!.replace(',', '.')), unitGrossCents: cents(x[3]!), taxRate: Number(x[4]!.replace(',', '.')) });
  }
  const sum = (ls: ExtractedLine[]) => ls.reduce((s, l) => s + Math.round(l.quantity * l.unitGrossCents), 0);
  if (pos.length && out.grossCents != null && Math.abs(sum(pos) - out.grossCents) <= 1) {
    out.lines = pos; out.found.push(`${pos.length} ${pos.length === 1 ? 'Position' : 'Positionen'}`);
  } else {
    // Zusammenfassung je Steuersatz aus der Steuerzeile: „Nettobetrag 7 %: 277,57 € … Umsatzsteuer 7 % 19,43 €“
    const tax = new Map<number, number>(), net = new Map<number, number>();
    for (const x of flat.matchAll(new RegExp(String.raw`(?:Umsatzsteuer|Mehrwertsteuer|MwSt\.?|USt\.?)\s*(\d{1,2}(?:,\d)?)\s*%[^\n\d-]{0,12}(${MONEY})`, 'gi'))) tax.set(Number(x[1]!.replace(',', '.')), cents(x[2]!));
    for (const x of flat.matchAll(new RegExp(String.raw`(\d{1,2}(?:,\d)?)\s*%\s*(?:Umsatzsteuer|Mehrwertsteuer|MwSt\.?|USt\.?)[^\n\d-]{0,12}(${MONEY})`, 'gi'))) if (!tax.has(Number(x[1]!.replace(',', '.')))) tax.set(Number(x[1]!.replace(',', '.')), cents(x[2]!));
    for (const x of flat.matchAll(new RegExp(String.raw`Netto(?:betrag)?\s*(\d{1,2}(?:,\d)?)\s*%[^\n\d-]{0,6}(${MONEY})`, 'gi'))) net.set(Number(x[1]!.replace(',', '.')), cents(x[2]!));
    const rates = [...tax.keys()].filter((r) => r > 0).sort((p, q) => p - q);
    const byRate = rates.map((r): ExtractedLine => ({ name: `Leistungen laut Rechnung (${String(r).replace('.', ',')} %)`, quantity: 1, taxRate: r, unitGrossCents: net.has(r) ? net.get(r)! + tax.get(r)! : Math.round(tax.get(r)! * (100 + r) / r) }));
    if (byRate.length && out.grossCents != null && Math.abs(sum(byRate) - out.grossCents) <= rates.length) {
      out.lines = byRate; out.found.push(`Beträge je Steuersatz (${rates.map((r) => `${r} %`).join(', ')})`);
      out.notes.push('Die einzelnen Positionen ließen sich nicht sicher lesen – vorgeschlagen ist je Steuersatz eine zusammengefasste Position. Bitte bei Bedarf die echten Positionen eintragen.');
    } else if (out.grossCents != null) {
      out.notes.push('Positionen und Steuersätze ließen sich nicht sicher lesen – bitte von Hand eintragen. Der Gesamtbetrag steht zum Vergleich oben.');
    }
  }
  if (!out.number) out.notes.push('Die Rechnungsnummer wurde nicht gefunden.');
  if (!out.buyer) out.notes.push('Der Empfänger wurde nicht gefunden.');
  if (out.issueDate && !out.serviceFrom) out.notes.push('Ein Leistungszeitraum wurde nicht gefunden – bitte eintragen.');
  return out;
}
