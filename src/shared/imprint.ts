/**
 * Firmendaten aus dem Text einer Impressum-Seite herausziehen: Name, Anschrift, Telefon, E-Mail, USt-IdNr.
 * Zuerst strukturierte Angaben der Seite (schema.org), sonst feste Muster. Das Ergebnis ist ein Vorschlag.
 */
export interface CompanyFound { name: string; street: string; zip: string; city: string; country: string; phone: string; email: string; vatId: string; source: string }

const ENT: Record<string, string> = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', ndash: '–', mdash: '—', middot: '·', copy: '©', reg: '®' };
export const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&(\w+);/g, (m, n) => ENT[n] ?? m);
/** HTML → Textzeilen (Skripte, Stile und Navigation entfernt; Block-Elemente und <br> ergeben Zeilenumbrüche). */
export function htmlToLines(html: string): string[] {
  const body = html.replace(/<(script|style|noscript|svg|head|nav)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|address|section|td|dd|dt)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  return decode(body).split('\n').map((l) => l.replace(/[ \s]+/g, ' ').trim()).filter(Boolean);
}
/** Link zur Impressum-Seite auf einer beliebigen Seite der Website finden. */
export function findImprintLink(html: string, base: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decode(m[2]!.replace(/<[^>]+>/g, ' ')).trim();
    if (/impressum|imprint|anbieterkennzeichnung/i.test(text) || /impressum|imprint/i.test(m[1]!)) { try { return new URL(decode(m[1]!), base).toString(); } catch { /* weiter */ } }
  }
  return null;
}

const LEGAL = /\b(GmbH(?:\s*&\s*Co\.?\s*KG)?|gGmbH|mbH|AG|SE|KGaA|KG|OHG|UG(?:\s*\(haftungsbeschränkt\))?|GbR|e\.\s?K\.|e\.\s?Kfm\.|e\.\s?V\.|eG|PartG(?:\s*mbB)?|Ltd\.?|Inc\.?|S\.à r\.l\.|B\.V\.)(?=$|[\s,.;)])/;
const STREET = /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .'-]{2,40}?\s\d{1,4}\s?[a-zA-Z]?(?:\s?[-–/]\s?\d{1,4}\s?[a-zA-Z]?)?$/;

function fromJsonLd(html: string): Partial<CompanyFound> | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]!.trim()); } catch { continue; }
    const items: Record<string, unknown>[] = [];
    const walk = (x: unknown) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') { items.push(x as Record<string, unknown>); walk((x as Record<string, unknown>)['@graph']); } };
    walk(data);
    for (const it of items) {
      const a = it.address as Record<string, unknown> | undefined;
      if (!a || typeof a !== 'object' || typeof it.name !== 'string') continue;
      const str = (v: unknown) => (typeof v === 'string' ? decode(v).trim() : '');
      if (!str(a.postalCode) || !str(a.streetAddress)) continue;
      const c = a.addressCountry as unknown;
      return { name: str(it.name), street: str(a.streetAddress), zip: str(a.postalCode), city: str(a.addressLocality), country: typeof c === 'string' ? c : str((c as Record<string, unknown> | undefined)?.name),
        phone: str(it.telephone), email: str(it.email).replace(/^mailto:/i, ''), vatId: str(it.vatID) };
    }
  }
  return null;
}

export function extractCompany(html: string): CompanyFound | null {
  const lines = htmlToLines(html);
  const flat = lines.join('\n');
  const ld = fromJsonLd(html);
  const out: CompanyFound = { name: '', street: '', zip: '', city: '', country: 'Deutschland', phone: '', email: '', vatId: '', source: ld ? 'strukturierte Angaben der Seite' : 'Text der Seite', ...(ld ?? {}) } as CompanyFound;
  if (!out.country || /^(DE|DEU|Germany)$/i.test(out.country)) out.country = 'Deutschland';
  if (/^(AT|Austria)$/i.test(out.country)) out.country = 'Österreich';
  if (/^(CH|Switzerland)$/i.test(out.country)) out.country = 'Schweiz';

  if (!out.zip) {
    // erste Zeile „PLZ Ort“ nach dem Wort Impressum (oder überhaupt), davor Straße, davor der Name
    const start = Math.max(0, lines.findIndex((l) => /impressum|imprint|angaben gemäß|anbieter/i.test(l)));
    for (let i = start; i < lines.length; i++) {
      const z = /^(?:D-|DE-|A-|CH-)?(\d{4,5})\s+([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß .()/-]{1,40})$/.exec(lines[i]!);
      if (!z) continue;
      const street = lines[i - 1] ?? '';
      if (!STREET.test(street)) continue;
      out.zip = z[1]!; out.city = z[2]!.trim(); out.street = street;
      if (z[1]!.length === 4 && out.country === 'Deutschland') out.country = /\.ch\b|schweiz/i.test(flat) ? 'Schweiz' : 'Österreich';
      // Name: nächste Zeile darüber mit Rechtsform, sonst die Zeile direkt über der Straße
      const above = lines.slice(Math.max(0, i - 6), i - 1).reverse();
      out.name ||= above.find((l) => LEGAL.test(l) && l.length <= 100) ?? (above[0] && above[0].length <= 80 && !/impressum|angaben|§|tmg|ddg|verantwortlich|anschrift|adresse/i.test(above[0]) ? above[0] : '');
      break;
    }
  }
  if (!out.name) out.name = lines.find((l) => LEGAL.test(l) && l.length <= 100 && !/impressum|©|copyright/i.test(l)) ?? '';
  out.name = out.name.replace(/^(Firma|Anbieter|Betreiber|Herausgeber|Inhaber)\s*:?\s*/i, '').trim();
  if (!out.vatId) out.vatId = (/\b(DE\s?\d{9}|ATU\s?\d{8}|CHE[-\s]?\d{3}\.?\d{3}\.?\d{3})\b/.exec(flat)?.[1] ?? '').replace(/\s/g, '');
  if (!out.phone) out.phone = (/(?:Tel(?:efon)?\.?|Fon|Phone|T)\s*[.:]?\s*((?:\+|00)?[\d][\d\s/().-]{6,22}\d)/i.exec(flat)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  if (!out.email) {
    const mail = /mailto:([^"'?>\s]+)/i.exec(html)?.[1] ?? /[\w.+-]+\s?(?:@|\(at\)|\[at\])\s?[\w-]+(?:\s?(?:\.|\(dot\)|\[dot\])\s?[\w-]+)+/i.exec(flat)?.[0] ?? '';
    out.email = decode(mail).replace(/\s?(\(at\)|\[at\])\s?/i, '@').replace(/\s?(\(dot\)|\[dot\])\s?/gi, '.').replace(/\s/g, '');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out.email)) out.email = '';
  }
  return out.name || out.zip ? out : null;
}
