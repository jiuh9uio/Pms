import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  COUNTRIES, PAYMENT_MEANS, computeEInvoice, einvoiceSendInput, einvoiceUploadInput, type EInvoiceExtract, type EInvoiceRow,
} from '../../../src/shared/einvoice.js';
import { addDays, formatMoney, parseMoney, todayBerlin } from '../../../src/shared/hotel.js';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import { ApiFailure, api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

interface Defaults { seller: { name: string; street: string; zip: string; city: string; country: string; vatId: string; taxNumber: string; email: string; phone: string; contactName: string }; iban: string; bic: string; paymentTermDays: number }

/** E-Rechnung: PDF-Rechnungen in ZUGFeRD/Factur-X umwandeln, herunterladen und per E-Mail versenden. */
export function EInvoice() {
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, error } = useLoad(() => api<EInvoiceRow[]>('GET', '/einvoices'), [rev]);
  const mail = useLoad(() => api<{ ready: boolean; from: string }>('GET', '/mail/status'), [rev]);
  const [upload, setUpload] = useState(false);
  const [send, setSend] = useState<EInvoiceRow | null>(null);
  const remove = async (r: EInvoiceRow) => {
    if (!window.confirm(`E-Rechnung ${r.number} löschen?`)) return;
    try { await api('POST', `/einvoices/${r.id}/remove`); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <>
      <PageHeader title="E-Rechnung" sub="PDF-Rechnungen in das Format ZUGFeRD umwandeln und per E-Mail versenden"
        actions={<Button variant="primary" onClick={() => setUpload(true)}>PDF umwandeln</Button>} />
      {mail.data && !mail.data.ready && (
        <p className="notice warn">Der E-Mail-Versand ist noch nicht eingerichtet. {user.role === 'admin' ? <Link to="/einstellungen?ansicht=email">Jetzt in den Einstellungen eintragen</Link> : 'Bitte den Administrator ansprechen.'} Herunterladen geht auch ohne.</p>
      )}
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? (
        <section className="card">
          <h2>So funktioniert es</h2>
          <ol className="steps">
            <li><b>PDF umwandeln:</b> eine fertige PDF-Rechnung auswählen (z. B. aus dem Kassensystem) und die Rechnungsdaten eintragen.</li>
            <li>Das Programm erzeugt daraus eine <b>ZUGFeRD-Datei</b>: dieselbe PDF, in die die Rechnungsdaten zusätzlich als maschinenlesbare XML-Datei eingebettet sind.</li>
            <li><b>Versenden</b> per E-Mail oder herunterladen.</li>
          </ol>
          <p className="muted">Rechnungen, die im Bereich Hotel ausgestellt wurden, lassen sich dort direkt mit „E-Rechnung“ umwandeln – ohne Eintippen.</p>
        </section>
      ) : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th className="num">Betrag</th><th className="hide-sm">Herkunft</th><th>Versand</th><th /></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td className="strong nowrap">{r.number}</td><td className="nowrap">{deDate(r.issueDate)}</td><td>{r.buyerName}</td><td className="num">{formatMoney(r.grossCents)}</td>
              <td className="hide-sm">{r.source === 'invoice' ? <Badge tone="accent">aus dem PMS</Badge> : <><Badge>hochgeladen</Badge><br /><small>{r.originalName}</small></>}</td>
              <td>{r.sentAt ? <><Badge tone="ok">versendet</Badge><br /><small>{fmtDateTime(r.sentAt)} an {r.sentTo}</small></> : <span className="muted">noch nicht</span>}</td>
              <td className="num nowrap rowactions">
                <a className="btn" href={`/api/v1/einvoices/${r.id}/pdf`}>PDF</a><a className="btn" href={`/api/v1/einvoices/${r.id}/xml`}>XML</a>
                <Button variant="primary" onClick={() => setSend(r)}>Senden</Button>
                {!r.sentAt && <button type="button" className="iconbtn" aria-label={`${r.number} löschen`} onClick={() => void remove(r)}>✕</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      <section className="card">
        <h2>Wichtig zu wissen</h2>
        <ul className="bullets">
          <li>Maßgeblich bei einer E-Rechnung ist der <b>XML-Teil</b>. Er entsteht aus den Angaben, die Sie eintragen – bitte mit der PDF abgleichen. Beim Hochladen liest das Programm die PDF und schlägt die Angaben vor; das ist eine Hilfe, keine Garantie – Lesefehler sind möglich.</li>
          <li>Die Dateien sind nach den Vorgaben für ZUGFeRD 2 / Factur-X (Profil EN 16931) aufgebaut, aber <b>nicht mit einem offiziellen Prüfprogramm validiert</b>. Vor dem ersten echten Versand bitte eine Beispieldatei mit einem ZUGFeRD-Validator prüfen.</li>
          <li>Bei hochgeladenen PDFs hängt es von der Ausgangsdatei ab, ob das Ergebnis den Archivstandard PDF/A-3 erfüllt. Aus dem PMS erzeugte Rechnungen bringen Schrift und Farbprofil selbst mit.</li>
          <li>Stornobelege und Rechnungen mit Nachlass-Positionen werden noch nicht unterstützt.</li>
        </ul>
      </section>
      {upload && <UploadDialog onClose={() => setUpload(false)} />}
      {send && <SendDialog row={send} ready={!!mail.data?.ready} from={mail.data?.from ?? ''} onClose={() => setSend(null)} />}
    </>
  );
}

interface Line { name: string; quantity: string; price: string; rate: string }

function UploadDialog({ onClose }: { onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const today = todayBerlin();
  const base = useLoad(async () => {
    const [def, rates] = await Promise.all([api<Defaults>('GET', '/einvoices/defaults'), api<TaxRateDto[]>('GET', '/tax-rates')]);
    return { def, rates: rates.filter((r) => r.active) };
  });
  const [file, setFile] = useState<{ name: string; base64: string; size: number } | null>(null);
  const [v, setV] = useState({ number: '', issueDate: today, serviceFrom: today, serviceTo: today, dueDate: '', paid: '', paymentMeans: '58', iban: '', bic: '', paymentTerms: '', note: '' });
  const [buyer, setBuyer] = useState({ name: '', street: '', zip: '', city: '', country: 'DE', vatId: '', email: '', reference: '' });
  const [seller, setSeller] = useState<Defaults['seller'] | null>(null);
  const [lines, setLines] = useState<Line[]>([{ name: 'Leistungen laut Rechnung', quantity: '1', price: '', rate: '19' }]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSeller, setShowSeller] = useState(false);
  useEffect(() => {
    if (!base.data) return;
    const d = base.data.def;
    setSeller(d.seller);
    setV((x) => ({ ...x, iban: d.iban, bic: d.bic, dueDate: addDays(today, d.paymentTermDays), paymentTerms: `Zahlbar innerhalb von ${d.paymentTermDays} Tagen ohne Abzug.` }));
    if (!d.seller.taxNumber && !d.seller.vatId) setShowSeller(true);
  }, [base.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return toast('Bitte eine PDF-Datei wählen', 'error');
    if (f.size > 10 * 1024 * 1024) return toast('Die Datei ist zu groß (höchstens 10 MB)', 'error');
    const reader = new FileReader();
    reader.onload = () => { const base64 = String(reader.result).split(',')[1] ?? ''; setFile({ name: f.name, size: f.size, base64 }); void readPdf(base64); };
    reader.readAsDataURL(f);
  };
  // PDF auslesen: gefundene Angaben in die Felder übernehmen (als Vorschlag – alles bleibt änderbar)
  const [read, setRead] = useState<{ state: 'busy' | 'done' | 'none' | 'failed'; found: string[]; notes: string[]; text?: string } | null>(null);
  const readPdf = async (base64: string) => {
    setRead({ state: 'busy', found: [], notes: [] });
    try {
      const r = await api<EInvoiceExtract>('POST', '/einvoices/extract', { pdfBase64: base64 });
      const g = r.suggestion;
      if (!r.hasText || !g) { setRead({ state: 'none', found: [], notes: [] }); return; }
      setV((x) => ({ ...x, number: g.number ?? x.number, issueDate: g.issueDate ?? x.issueDate, serviceFrom: g.serviceFrom ?? g.issueDate ?? x.serviceFrom, serviceTo: g.serviceTo ?? g.serviceFrom ?? g.issueDate ?? x.serviceTo,
        dueDate: g.dueDate ?? x.dueDate, paid: g.paidCents ? (g.paidCents / 100).toFixed(2).replace('.', ',') : x.paid }));
      if (g.buyer) setBuyer((x) => ({ ...x, name: g.buyer!.name, street: g.buyer!.street, zip: g.buyer!.zip, city: g.buyer!.city, vatId: g.buyer!.vatId || x.vatId }));
      if (g.lines?.length) setLines(g.lines.map((l) => ({ name: l.name, quantity: String(l.quantity).replace('.', ','), price: (l.unitGrossCents / 100).toFixed(2).replace('.', ','), rate: String(l.taxRate) })));
      setRead({ state: 'done', found: g.found, notes: g.notes });
    } catch (e) { setRead({ state: 'failed', found: [], notes: [], text: e instanceof Error ? e.message : 'Die PDF ließ sich nicht lesen.' }); }
  };
  const parsed = lines.map((l) => ({ name: l.name, quantity: Number(l.quantity.replace(',', '.')), unitGrossCents: parseMoney(l.price), taxRate: Number(l.rate) }));
  const complete = parsed.every((l) => l.quantity > 0 && !Number.isNaN(l.unitGrossCents));
  const paidCents = v.paid.trim() === '' ? 0 : parseMoney(v.paid);
  const totals = complete ? computeEInvoice({ lines: parsed, paidCents: Number.isNaN(paidCents) ? 0 : paidCents }) : null;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const payload = {
      fileName: file?.name ?? '', pdfBase64: file?.base64 ?? '',
      data: { ...v, dueDate: v.dueDate || null, paidCents, seller, buyer, lines: parsed },
    };
    const p = einvoiceUploadInput.safeParse(payload);
    if (!p.success) { setErrors([...new Set(p.error.issues.map((i) => i.message))]); return; }
    setBusy(true);
    try {
      await api('POST', '/einvoices/upload', p.data);
      toast(`E-Rechnung ${v.number} erstellt`);
      bump();
      onClose();
    } catch (err) {
      setErrors(err instanceof ApiFailure && Object.keys(err.fields).length ? [...new Set(Object.values(err.fields))] : [err instanceof Error ? err.message : 'Fehler']);
    }
    setBusy(false);
  };
  const f = (label: string, value: string, set: (s: string) => void, o: { type?: string; wide?: boolean; hint?: string } = {}) => (
    <Field label={label} wide={o.wide} hint={o.hint}><input type={o.type ?? 'text'} value={value} onChange={(e) => set(e.target.value)} /></Field>
  );
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  return (
    <Dialog title="PDF in E-Rechnung umwandeln" onClose={onClose} size="xl"
      footer={<><span className="left total">{totals && <>Gesamt <b>{formatMoney(totals.grossCents)}</b> · zu zahlen <b>{formatMoney(totals.dueCents)}</b></>}</span>
        <Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void submit()}>E-Rechnung erstellen</Button></>}>
      {!base.data || !seller ? <LoadState error={base.error} loading /> : (
        <form onSubmit={(e) => void submit(e)} noValidate className="split">
          <div>
            <label className={`dropzone${file ? ' has' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
              <input type="file" accept="application/pdf,.pdf" onChange={(e) => pick(e.target.files?.[0])} />
              {file ? <span><b>{file.name}</b><br /><small>{Math.round(file.size / 1024)} kB · zum Ersetzen klicken</small></span>
                : <span><b>PDF-Rechnung hier ablegen</b> oder klicken zum Auswählen<br /><small>höchstens 10 MB, nicht kennwortgeschützt</small></span>}
            </label>
            {read?.state === 'busy' && <p className="muted">Die PDF wird gelesen …</p>}
            {read?.state === 'done' && (
              <div className="notice">
                <b>Aus der PDF übernommen</b> – bitte mit der Rechnung vergleichen:
                <ul className="bullets">{read.found.map((x) => <li key={x}>{x}</li>)}</ul>
                {read.notes.map((x) => <p key={x} className="small"><b>Achtung:</b> {x}</p>)}
              </div>
            )}
            {read?.state === 'none' && <p className="notice warn">In dieser PDF steht kein lesbarer Text – vermutlich ist sie eingescannt oder ein Foto. Eine Texterkennung für Scans enthält das Programm nicht; die Angaben bitte von Hand eintragen.</p>}
            {read?.state === 'failed' && <p className="notice warn">{read.text}</p>}
            <h3>Rechnung</h3>
            <div className="formgrid cols3">
              {f('Rechnungsnummer', v.number, (s) => setV({ ...v, number: s }))}{f('Rechnungsdatum', v.issueDate, (s) => setV({ ...v, issueDate: s }), { type: 'date' })}
              {f('Fällig am', v.dueDate, (s) => setV({ ...v, dueDate: s }), { type: 'date' })}
              {f('Leistung von', v.serviceFrom, (s) => setV({ ...v, serviceFrom: s, serviceTo: s > v.serviceTo ? s : v.serviceTo }), { type: 'date' })}{f('Leistung bis', v.serviceTo, (s) => setV({ ...v, serviceTo: s }), { type: 'date' })}
            </div>
            <h3>Positionen <small className="inl">Bruttopreise wie auf der PDF</small></h3>
            <div className="elines">
              {lines.map((l, i) => (
                <div key={i} className="eline">
                  <input value={l.name} placeholder="Bezeichnung" aria-label="Bezeichnung" onChange={(e) => setLine(i, { name: e.target.value })} />
                  <input value={l.quantity} inputMode="decimal" className="short" aria-label="Menge" placeholder="Menge" onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  <input value={l.price} inputMode="decimal" className="short" aria-label="Einzelpreis brutto" placeholder="Preis brutto" onChange={(e) => setLine(i, { price: e.target.value })} />
                  <select value={l.rate} className="short" aria-label="Steuersatz" onChange={(e) => setLine(i, { rate: e.target.value })}>
                    {[...new Set([...base.data!.rates.map((r) => r.ratePercent), 0])].sort((a, b) => b - a).map((r) => <option key={r} value={r}>{r.toLocaleString('de-DE')} %</option>)}
                  </select>
                  {lines.length > 1 && <button type="button" className="iconbtn" aria-label="Position entfernen" onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button>}
                </div>
              ))}
            </div>
            <p><Button onClick={() => setLines([...lines, { name: '', quantity: '1', price: '', rate: lines.at(-1)?.rate ?? '19' }])}>+ Position</Button></p>
            <p className="muted small">Tipp: Je Steuersatz genügt eine Position mit dem Bruttobetrag (z. B. „Speisen 7 %“ und „Getränke 19 %“). Die Summe muss dem Betrag auf der PDF entsprechen.</p>
            {totals && (
              <table className="sums"><tbody>
                {totals.taxes.map((t) => <tr key={t.rate} className="vat"><td>Netto {t.rate.toLocaleString('de-DE')} % {formatMoney(t.basisCents)}</td><td className="num">USt {formatMoney(t.taxCents)}</td></tr>)}
                <tr className="sum"><td>Gesamt (brutto)</td><td className="num">{formatMoney(totals.grossCents)}</td></tr>
              </tbody></table>
            )}
          </div>
          <aside>
            <h3 className="first">Empfänger</h3>
            <div className="formgrid">
              {f('Firma / Name', buyer.name, (s) => setBuyer({ ...buyer, name: s }), { wide: true })}{f('Straße und Hausnummer', buyer.street, (s) => setBuyer({ ...buyer, street: s }), { wide: true })}
              {f('PLZ', buyer.zip, (s) => setBuyer({ ...buyer, zip: s }))}{f('Ort', buyer.city, (s) => setBuyer({ ...buyer, city: s }))}
              <Field label="Land"><select value={buyer.country} onChange={(e) => setBuyer({ ...buyer, country: e.target.value })}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              {f('USt-IdNr.', buyer.vatId, (s) => setBuyer({ ...buyer, vatId: s }))}
              {f('E-Mail', buyer.email, (s) => setBuyer({ ...buyer, email: s }), { type: 'email', hint: 'für den Versand' })}{f('Referenz des Kunden', buyer.reference, (s) => setBuyer({ ...buyer, reference: s }), { hint: 'z. B. Bestellnummer, Leitweg-ID' })}
            </div>
            <h3>Zahlung</h3>
            <div className="formgrid">
              <Field label="Zahlungsart"><select value={v.paymentMeans} onChange={(e) => setV({ ...v, paymentMeans: e.target.value })}>{PAYMENT_MEANS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              {f('Bereits bezahlt', v.paid, (s) => setV({ ...v, paid: s }), { hint: 'leer = nichts' })}
              {v.paymentMeans === '58' && f('IBAN', v.iban, (s) => setV({ ...v, iban: s }), { wide: true })}
              {f('Zahlungsbedingungen', v.paymentTerms, (s) => setV({ ...v, paymentTerms: s }), { wide: true })}
            </div>
            <h3>Rechnungssteller <button type="button" className="linkbtn" onClick={() => setShowSeller(!showSeller)}>{showSeller ? 'ausblenden' : 'ändern'}</button></h3>
            {!showSeller ? <p className="muted small">{seller.name}, {seller.zip} {seller.city} · {seller.taxNumber ? `St.-Nr. ${seller.taxNumber}` : seller.vatId ? `USt-IdNr. ${seller.vatId}` : 'Steuernummer fehlt'}</p> : (
              <div className="formgrid">
                {f('Name', seller.name, (s) => setSeller({ ...seller, name: s }), { wide: true })}{f('Straße', seller.street, (s) => setSeller({ ...seller, street: s }), { wide: true })}
                {f('PLZ', seller.zip, (s) => setSeller({ ...seller, zip: s }))}{f('Ort', seller.city, (s) => setSeller({ ...seller, city: s }))}
                {f('Steuernummer', seller.taxNumber, (s) => setSeller({ ...seller, taxNumber: s }))}{f('USt-IdNr.', seller.vatId, (s) => setSeller({ ...seller, vatId: s }))}
              </div>
            )}
            {errors.length > 0 && <p className="notice danger" role="alert">{errors.join(' · ')}</p>}
          </aside>
          <button type="submit" hidden />
        </form>
      )}
    </Dialog>
  );
}

function SendDialog({ row, ready, from, onClose }: { row: EInvoiceRow; ready: boolean; from: string; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({
    to: row.buyerEmail, subject: `Rechnung ${row.number}`, attach: 'pdf' as 'pdf' | 'xml' | 'both',
    body: `Guten Tag,\n\nanbei erhalten Sie unsere Rechnung ${row.number} vom ${deDate(row.issueDate)} über ${formatMoney(row.grossCents)} als E-Rechnung im Format ZUGFeRD (PDF mit eingebetteten Rechnungsdaten).\n\nMit freundlichen Grüßen`,
  });
  const f = useSubmit(einvoiceSendInput, async (d) => {
    await api('POST', `/einvoices/${row.id}/send`, d);
    toast(`E-Rechnung ${row.number} an ${d.to} gesendet`);
    bump();
    onClose();
  });
  return (
    <Dialog title={`E-Rechnung ${row.number} versenden`} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} disabled={!ready} onClick={() => void f.submit(v)}>Senden</Button></>}>
      {!ready && <p className="notice warn">Der E-Mail-Versand ist noch nicht eingerichtet (Verwaltung → Einstellungen → E-Mail-Versand).</p>}
      <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <Field label="An" error={f.errors.to}><input type="email" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} autoFocus /></Field>
        <Field label="Anhang">
          <select value={v.attach} onChange={(e) => setV({ ...v, attach: e.target.value as typeof v.attach })}>
            <option value="pdf">ZUGFeRD-PDF (XML eingebettet)</option><option value="both">ZUGFeRD-PDF und XML-Datei</option><option value="xml">nur XML-Datei</option>
          </select>
        </Field>
        <Field label="Betreff" wide error={f.errors.subject}><input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field label="Nachricht" wide error={f.errors.body}><textarea rows={8} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <button type="submit" hidden />
      </form>
      {from && <p className="muted small">Absender: {from}{row.sentAt && ` · bereits gesendet am ${fmtDateTime(row.sentAt)} an ${row.sentTo}`}</p>}
    </Dialog>
  );
}
