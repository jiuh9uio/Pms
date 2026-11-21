import { Fragment, useEffect, useState } from 'react';
import {
  INVOICE_STATUS_LABEL, PAYMENT_METHODS_BILLING, cancelInput, invoiceLineInput, invoiceUpdateInput, paymentInput, reverseInput, serviceLabel,
  type InvoiceDto, type InvoiceTimeline, type PaymentDto,
} from '../../../src/shared/billing.js';
import { formatMoney, moneyInput, parseMoney, todayBerlin, type ServiceDto } from '../../../src/shared/hotel.js';
import type { OfferItemDto } from '../../../src/shared/offers.js';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import { useNavigate } from 'react-router-dom';
import { hasModule } from '../../../src/shared/schemas.js';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { api } from '../api.ts';
import { CustomerPicker } from '../CustomerPicker.tsx';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Dialog, Field, LoadState, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

export const InvoiceStatus = ({ inv }: { inv: Pick<InvoiceDto, 'status' | 'kind' | 'openCents' | 'dueDate'> }) => {
  if (inv.kind === 'cancellation') return <Badge tone="neutral">Stornobeleg</Badge>;
  if (inv.status === 'draft') return <Badge tone="warn">Entwurf</Badge>;
  if (inv.status === 'cancelled') return <Badge tone="danger">Storniert</Badge>;
  if (inv.openCents === 0) return <Badge tone="ok">Bezahlt</Badge>;
  if (inv.openCents < 0) return <Badge tone="accent">Überzahlt</Badge>;
  return inv.dueDate && inv.dueDate < todayBerlin() ? <Badge tone="danger">Überfällig</Badge> : <Badge tone="accent">Offen</Badge>;
};

/** Rechnung: im Entwurf bearbeiten, dann ausstellen; danach nur noch Zahlungen, Druck und Storno. */
export function InvoiceDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { rev, bump, openInvoice, openBooking, closeAll } = useData();
  const toast = useToast();
  const { user } = useAuth();
  const go = useNavigate();
  const navigate = (to: string) => { closeAll(); go(to); };
  const { data: inv, error } = useLoad(() => api<InvoiceDto>('GET', `/invoices/${id}`), [id, rev]);
  const [busy, setBusy] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [mail, setMail] = useState<false | 'invoice' | 'reminder'>(false);
  const [kvMail, setKvMail] = useState(false);
  const makeEstimate = async () => {
    try { const r = await api<{ estimateNumber: string }>('POST', `/invoices/${id}/estimate`); toast(`Wird jetzt als Kostenvoranschlag ${r.estimateNumber} geführt`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };

  const issue = async () => {
    if (!inv || !window.confirm('Rechnung jetzt ausstellen? Danach vergibt das Programm die Rechnungsnummer und die Rechnung kann nicht mehr geändert, nur noch storniert werden.')) return;
    setBusy(true);
    try {
      const r = await api<InvoiceDto>('POST', `/invoices/${id}/issue`, { version: inv.version });
      toast(`Rechnung ${r.number} ausgestellt`);
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const einvoice = async () => {
    setBusy(true);
    try {
      await api('POST', `/einvoices/from-invoice/${id}`);
      toast('E-Rechnung erstellt – zum Versenden im Bereich „E-Rechnung“');
      bump();
      navigate('/erechnung');
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const remove = async () => {
    if (!window.confirm('Entwurf verwerfen?')) return;
    try { await api('POST', `/invoices/${id}/remove`); toast('Entwurf verworfen'); bump(); onClose(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const title = inv ? (inv.number ? `${inv.kind === 'cancellation' ? 'Stornobeleg' : 'Rechnung'} ${inv.number}` : inv.estimateNumber ? `Kostenvoranschlag ${inv.estimateNumber}` : 'Rechnungsentwurf') : 'Rechnung';

  return (
    <Dialog title={<>{title} {inv && <InvoiceStatus inv={inv} />}</>} onClose={onClose} size="xl"
      footer={inv && <>
        {inv.status === 'draft' && <Button variant="danger" className="left" onClick={() => void remove()}>Entwurf verwerfen</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && user.role === 'admin' && <Button variant="danger" className="left" onClick={() => setCancel(true)}>Stornieren</Button>}
        {inv.bookingId && <Button onClick={() => openBooking(inv.bookingId!)}>Reservierung {inv.bookingNumber}</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && hasModule(user, 'erechnung') && <Button busy={busy} onClick={() => void einvoice()}>E-Rechnung</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && <Button onClick={() => setMail('invoice')}>Per E-Mail senden</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && inv.openCents > 0 && inv.dueDate && inv.dueDate < todayBerlin() && <Button onClick={() => setMail('reminder')}>Zahlungserinnerung</Button>}
        {inv.status === 'draft' && inv.kind === 'invoice' && !inv.estimateNumber && <Button onClick={() => void makeEstimate()} title="Vergibt eine eigene Nummer (KV-Jahr-Nr.) – das PDF heißt dann „Kostenvoranschlag“ und trägt keine Rechnungsnummer">Als Kostenvoranschlag führen</Button>}
        {inv.status === 'draft' && inv.estimateNumber && <Button onClick={() => setKvMail(true)}>Kostenvoranschlag senden</Button>}
        {inv.status === 'draft' && inv.estimateNumber && <a className="btn" href={`/api/v1/invoices/${id}/estimate/pdf`} target="_blank" rel="noopener">Kostenvoranschlag (PDF)</a>}
        {!(inv.status === 'draft' && inv.estimateNumber) && <a className="btn" href={`/api/v1/invoices/${id}/pdf`} target="_blank" rel="noopener">{inv.status === 'draft' ? 'Vorschau (PDF)' : 'Drucken / PDF'}</a>}
        {inv.status !== 'draft' && <a className="btn" href={`/api/v1/invoices/${id}/pdf?download=1`}>Herunterladen</a>}
        {inv.status === 'draft' ? <Button variant="primary" busy={busy} onClick={() => void issue()}>{inv.estimateNumber ? 'Rechnung daraus ausstellen' : 'Ausstellen'}</Button> : <Button onClick={onClose}>Schließen</Button>}
      </>}>
      {!inv ? <LoadState error={error} loading /> : (
        <>
        {inv.status === 'draft' && inv.kind === 'invoice' && <DraftSteps inv={inv} />}
        <div className="split">
          <div>
            {inv.estimateNumber && <InvoiceThread inv={inv} />}
            {inv.status === 'cancelled' && <p className="notice danger">Storniert durch {inv.cancelledByNumber ? <button type="button" className="linkbtn" onClick={() => openInvoice(inv.cancelledById!)}>{inv.cancelledByNumber}</button> : 'Stornobeleg'}. Grund: {inv.cancelReason}</p>}
            {inv.kind === 'cancellation' && inv.cancelsId && <p className="notice">Storniert die Rechnung <button type="button" className="linkbtn" onClick={() => openInvoice(inv.cancelsId!)}>{inv.cancelsNumber}</button>.</p>}
            {inv.status === 'draft' ? <Recipient inv={inv} /> : (
              <div className="chosen"><span>
                {inv.recipientCompany && <><b>{inv.recipientCompany}</b><br /></>}{inv.recipientName}{inv.recipientCompany ? '' : ''}<br />
                <small>{[inv.recipientStreet, [inv.recipientZip, inv.recipientCity].filter(Boolean).join(' '), inv.recipientCountry].filter(Boolean).join(', ')}{inv.recipientVatId && ` · USt-IdNr. ${inv.recipientVatId}`}</small>
              </span><span className="right muted small">Datum {deDate(inv.issueDate)}<br />{serviceLabel(inv.serviceFrom, inv.serviceTo, false)} {deDate(inv.serviceFrom)}{inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? ` – ${deDate(inv.serviceTo)}` : ''}{inv.dueDate && inv.kind === 'invoice' && <><br />fällig {deDate(inv.dueDate)}</>}</span></div>
            )}
            <Lines inv={inv} />
          </div>
          <aside>
            <h3 className="first">Beträge</h3>
            <table className="sums"><tbody>
              {inv.taxes.map((t) => (
                <Fragment key={t.rate}>
                  <tr className="vat"><td>Nettobetrag{inv.taxes.length > 1 ? ` zu ${t.rate.toLocaleString('de-DE')} %` : ''}</td><td className="num">{formatMoney(t.netCents)}</td></tr>
                  <tr className="vat"><td>Enthaltene USt {t.rate.toLocaleString('de-DE')} %</td><td className="num">{formatMoney(t.taxCents)}</td></tr>
                </Fragment>
              ))}
              <tr className="sum"><td>Gesamtbetrag brutto</td><td className="num">{formatMoney(inv.grossCents)}</td></tr>
              {inv.status !== 'draft' && inv.kind === 'invoice' && <>
                <tr><td>Bezahlt</td><td className="num">{formatMoney(inv.paidCents)}</td></tr>
                {!!inv.creditCents && <tr><td className="muted small" colSpan={2}>{inv.creditCents > 0 ? `davon ${formatMoney(inv.creditCents)} verrechnet aus der Anzahlung auf einer anderen Rechnung dieser Reservierung` : `${formatMoney(-inv.creditCents)} Überzahlung auf andere Rechnungen dieser Reservierung übertragen`}</td></tr>}
                <tr className="sum"><td>Offen</td><td className="num">{formatMoney(inv.openCents)}</td></tr>
              </>}
            </tbody></table>
            {inv.status === 'draft' && inv.estimateNumber && <>
              <p className="notice small"><b>Noch keine Rechnung.</b> Zählt nicht zum Umsatz, lässt sich weiter ändern.{inv.estimateValidUntil && <> Gültig bis {deDate(inv.estimateValidUntil)}.</>}</p>
              <details className="iv-more"><summary>Wie geht es weiter?</summary><p className="muted small">Kostenvoranschlag senden oder als PDF ausdrucken. Ist der Kunde einverstanden, wird mit „Rechnung daraus ausstellen“ die Rechnung daraus – erst dann gibt es eine Rechnungsnummer. Den Kostenvoranschlag selbst gibt es danach nicht mehr als eigenes PDF.</p></details>
            </>}
            {inv.status !== 'draft' && inv.estimateNumber && <p className="muted small">Entstanden aus Kostenvoranschlag {inv.estimateNumber}.</p>}
            {inv.status === 'draft' && !inv.estimateNumber && <p className="muted small">Entwurf – noch ohne Rechnungsnummer.{inv.bookingId && ' Beim Ausstellen werden noch nicht zugeordnete Anzahlungen der Reservierung verrechnet.'}</p>}
            {(inv.status === 'issued' || inv.payments.length > 0) && inv.kind === 'invoice' && <Payments inv={inv} />}
            {inv.issuedAt && <p className="muted small">Ausgestellt {fmtDateTime(inv.issuedAt)} von {inv.issuedBy}</p>}
          </aside>
        </div>
        </>
      )}
      {inv && kvMail && <MailDialog path={`/invoices/${id}/estimate/mail`} title={`Kostenvoranschlag ${inv.estimateNumber} per E-Mail`} onClose={() => setKvMail(false)} onSent={bump} attachmentNote="(der Kostenvoranschlag als PDF – keine Rechnung)" />}
      {inv && mail && <MailDialog path={`/invoices/${id}/mail?kind=${mail}`} title={mail === 'reminder' ? `Zahlungserinnerung zur Rechnung ${inv.number}` : `Rechnung ${inv.number} per E-Mail`} onClose={() => setMail(false)} onSent={bump} />}
      {inv && cancel && <CancelDialog inv={inv} onClose={() => setCancel(false)} onDone={(newId) => { setCancel(false); openInvoice(newId); }} />}
    </Dialog>
  );
}

function Recipient({ inv }: { inv: InvoiceDto }) {
  const { bump } = useData();
  const toast = useToast();
  const init = {
    recipientCompany: inv.recipientCompany, recipientName: inv.recipientName, recipientStreet: inv.recipientStreet, recipientZip: inv.recipientZip,
    recipientCity: inv.recipientCity, recipientCountry: inv.recipientCountry, recipientVatId: inv.recipientVatId,
    serviceFrom: inv.serviceFrom ?? '', serviceTo: inv.serviceTo ?? '', notes: inv.notes, estimateValidUntil: inv.estimateValidUntil ?? '',
  };
  const kv = !!inv.estimateNumber && inv.status === 'draft';
  const [v, setV] = useState(init);
  useEffect(() => setV(init), [inv.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  // steht der Empfänger schon fest, genügt eine Zeile – das Formular klappt erst über „Ändern“ auf
  const known = !!(inv.recipientCompany || inv.recipientName);
  const [edit, setEdit] = useState(!known);
  const f = useSubmit(invoiceUpdateInput, async (d) => { await api('PUT', `/invoices/${inv.id}`, d); toast('Gespeichert'); bump(); setEdit(false); });
  const input = (k: keyof typeof v, label: string, o: { wide?: boolean; type?: string; hint?: string } = {}) => (
    <Field label={label} error={f.errors[k]} wide={o.wide} hint={o.hint}><input type={o.type ?? 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  if (!edit && known) return (
    <div className="iv-rcp">
      <div>
        <small className="muted">Empfänger</small>
        <b>{inv.recipientCompany || inv.recipientName}</b>
        <span>{[inv.recipientCompany ? inv.recipientName : '', inv.recipientStreet, [inv.recipientZip, inv.recipientCity].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || <i className="muted">ohne Anschrift</i>}</span>
      </div>
      <div>
        <small className="muted">{serviceLabel(inv.serviceFrom, inv.serviceTo, kv)}</small>
        <b>{inv.serviceFrom ? `${deDate(inv.serviceFrom)}${inv.serviceTo && inv.serviceTo !== inv.serviceFrom ? ` – ${deDate(inv.serviceTo)}` : ''}` : '–'}</b>
        {kv && <span>{inv.estimateValidUntil ? `gültig bis ${deDate(inv.estimateValidUntil)}` : 'ohne Gültigkeitsangabe'}</span>}
      </div>
      <Button onClick={() => setEdit(true)}>Ändern</Button>
    </div>
  );
  return (
    <form className="iv-rcpform" onSubmit={(e) => void f.submit({ ...v, serviceFrom: v.serviceFrom || null, serviceTo: v.serviceTo || null, estimateValidUntil: v.estimateValidUntil || null, version: inv.version }, e)} noValidate>
      <h3 className="first">{kv ? 'Empfänger und Termin' : 'Rechnungsempfänger'}</h3>
      <CustomerPicker onPick={(c) => setV({ ...v, recipientCompany: c.company, recipientName: c.name, recipientStreet: c.street, recipientZip: c.zip, recipientCity: c.city, recipientCountry: c.country, recipientVatId: c.vatId || v.recipientVatId })} />
      <div className="formgrid">
        {input('recipientCompany', 'Firma', { hint: 'leer bei Privatrechnung' })}{input('recipientName', 'Name / z. Hd.')}
        {input('recipientStreet', 'Straße und Hausnummer', { wide: true })}{input('recipientZip', 'PLZ')}{input('recipientCity', 'Ort')}
        {input('recipientCountry', 'Land')}{input('recipientVatId', 'USt-IdNr. des Empfängers', { hint: 'bei Firmen, falls vorhanden' })}
        {input('serviceFrom', kv ? 'Voraussichtl. Leistungstermin' : 'Leistungsdatum (von)', { type: 'date', hint: kv ? 'wann die Leistung voraussichtlich erbracht wird' : 'ein Tag: nur dieses Feld oder beide gleich' })}{input('serviceTo', kv ? 'bis (bei mehreren Tagen)' : 'Leistung bis', { type: 'date', hint: 'leer oder gleich = ein einzelner Tag' })}
        {kv && input('estimateValidUntil', 'Kostenvoranschlag gültig bis', { type: 'date', hint: 'steht auf dem Kostenvoranschlag; leer = ohne Angabe' })}
        <Field label="Hinweis auf der Rechnung" wide error={f.errors.notes}><textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      <div className="formactions">{known && <Button onClick={() => { setV(init); setEdit(false); }}>Abbrechen</Button>}<Button type="submit" variant="primary" busy={f.busy} disabled={!dirty}>Speichern</Button></div>
    </form>
  );
}

/** Weg eines Entwurfs als Schritte (wie bei „Neue Reservierung“ und den Vorgängen): was ist geschafft, was steht an */
function DraftSteps({ inv }: { inv: InvoiceDto }) {
  const { rev } = useData();
  const kv = !!inv.estimateNumber;
  const { data } = useLoad(() => (kv ? api<InvoiceTimeline>('GET', `/invoices/${inv.id}/timeline`) : Promise.resolve(null)), [inv.id, rev, kv]);
  const sent = !!data?.entries.some((e) => e.dir === 'out');
  const marks: [string, boolean][] = kv
    ? [['Empfänger', !!(inv.recipientCompany || inv.recipientName)], ['Positionen', inv.lines.length > 0], ['Gesendet', sent], [data?.answer === 'no' ? 'Kunde: Nein' : data?.answer === 'unclear' ? 'Antwort lesen' : 'Kunde: Ja', data?.answer === 'yes'], ['Rechnung', false]]
    : [['Empfänger', !!(inv.recipientCompany || inv.recipientName)], ['Positionen', inv.lines.length > 0], ['Ausstellen', false]];
  const first = marks.findIndex(([, ok]) => !ok);
  return (
    <ol className="cs-steps iv-steps" aria-label="Stand">{marks.map(([label, ok], i) => (
      <li key={i} className={ok ? 'done' : i === first ? 'now' : 'todo'} aria-current={!ok && i === first ? 'step' : undefined}><span className="cs-num">{ok ? '✓' : i + 1}</span><span className="cs-label">{label}</span></li>
    ))}</ol>
  );
}

/** Verlauf zum Kostenvoranschlag: gesendet → Antwort des Kunden (Ja/Nein) → Rechnung; oben die Kurzinfo */
function InvoiceThread({ inv }: { inv: InvoiceDto }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<InvoiceTimeline>('GET', `/invoices/${inv.id}/timeline`), [inv.id, rev]);
  const [open, setOpen] = useState(false);
  if (!data || (data.entries.length === 0 && data.candidates.length === 0)) return null;
  const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const draft = inv.status === 'draft';
  const ANSWER = { yes: 'Ja', no: 'Nein', unclear: 'unklar – bitte lesen' } as const;
  const act = async (path: string, body: unknown, msg: string) => { try { await api('POST', `/invoices/${inv.id}/timeline/${path}`, body); toast(msg); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  return (
    <section className="card ot-card">
      <div className="ot-info">
        {data.answer === 'yes' && <Badge tone="ok">Kunde hat mit Ja geantwortet</Badge>}
        {data.answer === 'no' && <Badge tone="danger">Kunde hat mit Nein geantwortet</Badge>}
        {data.answer === 'unclear' && <Badge tone="warn">Antwort da – bitte lesen</Badge>}
        {!data.answer && data.waiting && <Badge tone="accent">wartet auf Antwort</Badge>}
        {!draft && <span>Rechnung {inv.number} ausgestellt</span>}
        {data.code && <span className="ot-code" title="Diese Nummer steht im Betreff der E-Mail. Antwortet der Kunde darauf, wird die Antwort hier automatisch zugeordnet.">Kennzeichen {data.code}</span>}
        <button type="button" className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Verlauf ausblenden' : `Verlauf zeigen (${data.entries.length})`}</button>
      </div>
      {draft && data.answer === 'yes' && <p className="notice small">Der Kunde ist einverstanden – bitte die Antwort kurz lesen. Dann unten <b>„Rechnung daraus ausstellen“</b> und danach „Per E-Mail senden“ (die Adresse ist vorbelegt).</p>}
      {draft && data.answer === 'no' && <p className="notice warn small">Der Kunde hat abgelehnt. Sie können den Kostenvoranschlag ändern und neu senden oder ihn verwerfen.</p>}
      {draft && data.answer === 'unclear' && <p className="notice warn small">Die Antwort ist kein klares Ja oder Nein – bitte im Verlauf lesen.</p>}
      {data.candidates.length > 0 && <div className="ot-cand">
        <span className="muted small">Im Posteingang von dieser Adresse, noch nicht zugeordnet:</span>
        {data.candidates.map((c) => <div key={c.inboxMailId}><span>{when(c.at)} · {c.subject || '(ohne Betreff)'}</span><Button onClick={() => void act('assign', { inboxMailId: c.inboxMailId }, 'E-Mail zugeordnet')}>Zuordnen</Button></div>)}
      </div>}
      {open && <ol className="ot-list">{data.entries.map((e) => (
        <li key={e.id} className={`ot-${e.dir}`}>
          <div className="ot-bubble">
            <div className="ot-head"><b>{e.title}</b><small>{when(e.at)}{e.by ? ` · ${e.by}` : ''}</small></div>
            {e.subject && <div className="ot-subject">{e.subject}</div>}
            {e.answer && <div className="ot-hint">Antwort: {ANSWER[e.answer]}</div>}
            {e.text && (e.text.length > 280 ? <details><summary>{e.text.slice(0, 200).trim()} … <u>ganz lesen</u></summary><div className="ot-text">{e.text}</div></details> : <div className="ot-text">{e.text}</div>)}
            {e.removable && <button type="button" className="linkbtn small" onClick={() => { if (window.confirm('Diese E-Mail gehört nicht hierher? Die Zuordnung wird gelöst; die E-Mail bleibt im Posteingang.')) void act('remove', { eventId: e.id }, 'Zuordnung gelöst'); }}>gehört nicht hierher</button>}
          </div>
        </li>
      ))}</ol>}
    </section>
  );
}

function Lines({ inv }: { inv: InvoiceDto }) {
  const { bump } = useData();
  const toast = useToast();
  const draft = inv.status === 'draft';
  const base = useLoad(async () => {
    if (!draft) return null;
    // eigene Artikel: die Leistungen aus dem Bereich Angebote (falls freigegeben) stehen hier ebenfalls zur Auswahl
    const [services, rates, items] = await Promise.all([api<ServiceDto[]>('GET', '/services'), api<TaxRateDto[]>('GET', '/tax-rates'), api<OfferItemDto[]>('GET', '/offer-items').catch(() => [] as OfferItemDto[])]);
    return { services: services.filter((s) => s.active), rates: rates.filter((r) => r.active), items: items.filter((i) => i.active) };
  }, [draft]);
  const [v, setV] = useState({ description: '', detail: '', quantity: '1', price: '', rate: '' });
  const f = useSubmit(invoiceLineInput, async (d) => { await api('POST', `/invoices/${inv.id}/lines`, d); setV({ description: '', detail: '', quantity: '1', price: '', rate: v.rate }); bump(); });
  const remove = async (lineId: string) => { try { await api('POST', `/invoice-lines/${lineId}/remove`); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const pickService = (sid: string) => {
    const s = base.data?.services.find((x) => x.id === sid);
    if (s) { setV({ ...v, description: s.name, price: moneyInput(s.priceCents), rate: String(s.taxRatePercent) }); return; }
    const it = base.data?.items.find((x) => x.id === sid);
    if (it) setV({ ...v, description: it.name, detail: it.description, price: moneyInput(it.priceCents), rate: String(it.taxRatePercent) });
  };
  const defaultRate = v.rate || String(base.data?.rates.find((r) => r.defaultFor === 'services')?.ratePercent ?? 19);
  const errs = [...new Set(Object.values(f.errors))];
  return (
    <>
      <h3>Positionen</h3>
      {inv.lines.length === 0 && <p className="muted">Noch keine Positionen.</p>}
      {inv.lines.length > 0 && (
        <div className="tablewrap"><table className="nights lines">
          <thead><tr><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis brutto</th><th className="num">USt</th><th className="num">Gesamt brutto</th>{draft && <th />}</tr></thead>
          <tbody>{inv.lines.map((l) => (
            <tr key={l.id}>
              <td>{l.description}{l.detail && <><br /><small>{l.detail}</small></>}</td>
              <td className="num">{l.quantity.toLocaleString('de-DE')}</td><td className="num">{formatMoney(l.unitPriceCents)}</td>
              <td className="num">{l.taxRatePercent.toLocaleString('de-DE')} %</td><td className="num">{formatMoney(l.totalCents)}</td>
              {draft && <td className="num"><button type="button" className="iconbtn" aria-label={`${l.description} entfernen`} onClick={() => void remove(l.id)}>✕</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {draft && <p className="muted small">Eigene Position: Bezeichnung, Menge und Preis frei eintragen – oder einen gespeicherten Artikel übernehmen und anpassen.</p>}
      {draft && (
        <form className="addcharge" noValidate onSubmit={(e) => void f.submit({
          description: v.description, detail: v.detail, quantity: Number(v.quantity.replace(',', '.')), unitPriceCents: parseMoney(v.price), taxRatePercent: Number(defaultRate),
        }, e)}>
          <select value="" onChange={(e) => pickService(e.target.value)} aria-label="Leistung übernehmen">
            <option value="">Artikel übernehmen …</option>
            {!!base.data?.services.length && <optgroup label="Hotel-Leistungen">{base.data.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMoney(s.priceCents)})</option>)}</optgroup>}
            {!!base.data?.items.length && <optgroup label="Eigene Artikel (Angebote → Leistungen)">{base.data.items.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMoney(s.priceCents)})</option>)}</optgroup>}
          </select>
          <input placeholder="Bezeichnung (frei)" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} aria-label="Bezeichnung" />
          <input placeholder="Beschreibung (optional)" value={v.detail} onChange={(e) => setV({ ...v, detail: e.target.value })} aria-label="Beschreibung" />
          <input className="short" placeholder="Menge" inputMode="decimal" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} aria-label="Menge" />
          <input className="short" placeholder="Preis brutto" inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} aria-label="Einzelpreis brutto" />
          <select className="short" value={defaultRate} onChange={(e) => setV({ ...v, rate: e.target.value })} aria-label="Steuersatz">
            {base.data?.rates.map((r) => <option key={r.id} value={r.ratePercent}>{r.ratePercent.toLocaleString('de-DE')} %</option>)}
          </select>
          <Button type="submit" busy={f.busy}>Position hinzufügen</Button>
        </form>
      )}
      {errs.length > 0 && <p className="error">{errs.join(' · ')}</p>}
      {draft && <p className="muted small">Für eine Teilrechnung (z. B. Firma zahlt die Übernachtung, der Gast die Extras) einfach die nicht gewünschten Positionen entfernen und für den Rest eine zweite Rechnung anlegen. Negativer Preis = Nachlass.</p>}
    </>
  );
}

export function PaymentForm({ bookingId, invoiceId, suggestCents, onDone }: { bookingId?: string; invoiceId?: string; suggestCents: number; onDone?: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const { user } = useAuth();
  // Mitarbeiter buchen genau den offenen Betrag; Teil- und Minusbeträge nur der Administrator
  const locked = user.role !== 'admin' && suggestCents > 0;
  const [v, setV] = useState({ amount: suggestCents > 0 ? moneyInput(suggestCents) : '', method: 'Bar', date: todayBerlin(), payer: '', note: '' });
  useEffect(() => setV((x) => ({ ...x, amount: suggestCents > 0 ? moneyInput(suggestCents) : '' })), [suggestCents]);
  const f = useSubmit(paymentInput, async (d) => {
    await api('POST', '/payments', d);
    toast(`${formatMoney(d.amountCents)} (${d.method}) gebucht`);
    bump();
    onDone?.();
  });
  // Kartenzahlung über das EC-Gerät: Betrag ans Gerät senden, bei Erfolg wird die Zahlung gebucht
  const terminal = useLoad(() => api<{ ready: boolean }>('GET', '/terminal/status')).data;
  const [card, setCard] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const payByCard = async () => {
    const amountCents = parseMoney(v.amount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) { setCard({ busy: false, error: 'Bitte einen Betrag größer als 0 eintragen' }); return; }
    setCard({ busy: true, error: null });
    try {
      const r = await api<{ message: string }>('POST', '/payments/terminal', { bookingId, invoiceId, amountCents, payer: v.payer, note: v.note });
      toast(`${formatMoney(amountCents)}: ${r.message}`);
      setCard({ busy: false, error: null });
      bump();
      onDone?.();
    } catch (e) {
      setCard({ busy: false, error: e instanceof Error ? e.message : 'Fehler' });
      bump();
    }
  };
  return (
    <form className="payform" noValidate onSubmit={(e) => {
      if (terminal?.ready && v.method === 'Karte' && !window.confirm('Kartenzahlung buchen, ohne das EC-Gerät zu benutzen?\n\nNur verwenden, wenn die Zahlung am Gerät bereits erfolgreich war.')) { e.preventDefault(); return; }
      void f.submit({ bookingId, invoiceId, amountCents: parseMoney(v.amount), method: v.method, date: v.date, payer: v.payer, note: v.note }, e);
    }}>
      <div className="segmented" role="radiogroup" aria-label="Zahlungsart">
        {PAYMENT_METHODS_BILLING.slice(0, 3).map((m) => <button key={m} type="button" role="radio" aria-checked={v.method === m} className={v.method === m ? 'on' : ''} onClick={() => setV({ ...v, method: m })}>{m}</button>)}
        <select value={PAYMENT_METHODS_BILLING.slice(0, 3).includes(v.method as never) ? '' : v.method} onChange={(e) => e.target.value && setV({ ...v, method: e.target.value })} aria-label="Weitere Zahlungsart">
          <option value="">weitere …</option>{PAYMENT_METHODS_BILLING.slice(3).map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="inlinefields">
        <input inputMode="decimal" value={v.amount} readOnly={locked} title={locked ? 'Immer der volle offene Betrag – Teilzahlungen bucht der Administrator' : undefined} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="Betrag" aria-label="Betrag" />
        <input type="date" value={v.date} max={todayBerlin()} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="Datum" />
      </div>
      <input value={v.payer} onChange={(e) => setV({ ...v, payer: e.target.value })} placeholder="Zahler (falls abweichend)" aria-label="Zahler" />
      <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Bemerkung" aria-label="Bemerkung" />
      {Object.keys(f.errors).length > 0 && <p className="error">{[...new Set(Object.values(f.errors))].join(' · ')}</p>}
      {card.busy && <p className="notice">Der Betrag steht am EC-Gerät – bitte den Gast dort mit Karte zahlen lassen. Dieses Fenster geöffnet lassen.</p>}
      {card.error && <p className="notice danger">{card.error}</p>}
      <div className="formactions">
        {terminal?.ready && v.method === 'Karte' && <Button variant="primary" busy={card.busy} disabled={f.busy} onClick={() => void payByCard()}>Mit EC-Gerät kassieren</Button>}
        <Button type="submit" variant={terminal?.ready && v.method === 'Karte' ? 'default' : 'primary'} busy={f.busy} disabled={card.busy}>{terminal?.ready && v.method === 'Karte' ? 'Nur buchen (ohne Gerät)' : 'Zahlung buchen'}</Button>
      </div>
    </form>
  );
}

export function PaymentList({ list }: { list: PaymentDto[] }) {
  const { bump } = useData();
  const toast = useToast();
  const [reverse, setReverse] = useState<PaymentDto | null>(null);
  const isAdmin = useAuth().user.role === 'admin'; // Gegenbuchungen nur durch den Administrator
  const f = useSubmit(reverseInput, async (d) => { await api('POST', `/payments/${reverse!.id}/reverse`, d); toast('Gegenbuchung erfasst'); setReverse(null); bump(); });
  const [note, setNote] = useState('');
  if (!list.length) return <p className="muted small">Noch keine Zahlungen.</p>;
  return (
    <>
      <ul className="payments">
        {list.map((p) => (
          <li key={p.id} className={p.reversed || p.reversesId ? 'struck' : ''}>
            <span>{deDate(p.date)} · {p.method}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ' · Anzahlung'}<br /><small>{[p.payer, p.note, p.recordedBy, p.tse ? (p.tse.status === 'signed' ? `TSE Nr. ${p.tse.transactionNumber}` : 'TSE-Ausfall') : ''].filter(Boolean).join(' · ')}</small></span>
            <b className="num">{formatMoney(p.amountCents)}</b>
            {isAdmin && !p.reversed && !p.reversesId && <button type="button" className="linkbtn" onClick={() => { setNote(''); setReverse(p); }}>Gegenbuchen</button>}
          </li>
        ))}
      </ul>
      {reverse && (
        <Dialog title="Zahlung gegenbuchen" onClose={() => setReverse(null)}
          footer={<><Button onClick={() => setReverse(null)}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit({ note })}>Gegenbuchen</Button></>}>
          <p>{formatMoney(reverse.amountCents)} ({reverse.method}) vom {deDate(reverse.date)} wird mit einer Gegenbuchung über {formatMoney(-reverse.amountCents)} aufgehoben. Die ursprüngliche Buchung bleibt sichtbar.</p>
          <Field label="Grund" error={f.errors.note}><input value={note} onChange={(e) => setNote(e.target.value)} autoFocus placeholder="z. B. falscher Betrag erfasst" /></Field>
        </Dialog>
      )}
    </>
  );
}

function Payments({ inv }: { inv: InvoiceDto }) {
  return (
    <>
      <h3>Zahlungen</h3>
      <PaymentList list={inv.payments} />
      {inv.status === 'issued' && inv.openCents !== 0 && <PaymentForm invoiceId={inv.id} suggestCents={inv.openCents} />}
    </>
  );
}

function CancelDialog({ inv, onClose, onDone }: { inv: InvoiceDto; onClose: () => void; onDone: (id: string) => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const f = useSubmit(cancelInput, async (d) => {
    const r = await api<{ id: string; number: string }>('POST', `/invoices/${inv.id}/cancel`, d);
    toast(`Stornobeleg ${r.number} erstellt`);
    bump();
    onDone(r.id);
  });
  return (
    <Dialog title={`Rechnung ${inv.number} stornieren`} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="danger" busy={f.busy} onClick={() => void f.submit({ reason })}>Stornobeleg erstellen</Button></>}>
      <p>Die Rechnung bleibt unverändert erhalten. Es entsteht ein Stornobeleg mit eigener Nummer über {formatMoney(-inv.grossCents)}.
        {inv.paidCents !== 0 && ` Bereits gezahlte ${formatMoney(inv.paidCents)} werden als Anzahlung auf die Reservierung übertragen und mit der nächsten Rechnung verrechnet.`}</p>
      <Field label="Grund" error={f.errors.reason}><input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="z. B. falscher Empfänger, Preis falsch" /></Field>
      <p className="muted small">Danach bei Bedarf über die Reservierung eine korrigierte Rechnung erstellen.</p>
    </Dialog>
  );
}
