import { useEffect, useState } from 'react';
import {
  INVOICE_STATUS_LABEL, PAYMENT_METHODS_BILLING, cancelInput, invoiceLineInput, invoiceUpdateInput, paymentInput, reverseInput,
  type InvoiceDto, type PaymentDto,
} from '../../../src/shared/billing.js';
import { formatMoney, moneyInput, parseMoney, todayBerlin, type ServiceDto } from '../../../src/shared/hotel.js';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import { useNavigate } from 'react-router-dom';
import { hasModule } from '../../../src/shared/schemas.js';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { api } from '../api.ts';
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
  const [mail, setMail] = useState(false);

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
  const title = inv ? (inv.number ? `${inv.kind === 'cancellation' ? 'Stornobeleg' : 'Rechnung'} ${inv.number}` : 'Rechnungsentwurf') : 'Rechnung';

  return (
    <Dialog title={<>{title} {inv && <InvoiceStatus inv={inv} />}</>} onClose={onClose} size="xl"
      footer={inv && <>
        {inv.status === 'draft' && <Button variant="danger" className="left" onClick={() => void remove()}>Entwurf verwerfen</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && <Button variant="danger" className="left" onClick={() => setCancel(true)}>Stornieren</Button>}
        {inv.bookingId && <Button onClick={() => openBooking(inv.bookingId!)}>Reservierung {inv.bookingNumber}</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && hasModule(user, 'erechnung') && <Button busy={busy} onClick={() => void einvoice()}>E-Rechnung</Button>}
        {inv.status === 'issued' && inv.kind === 'invoice' && <Button onClick={() => setMail(true)}>Per E-Mail senden</Button>}
        <a className="btn" href={`/rechnung/${id}`} target="_blank" rel="noopener">{inv.status === 'draft' ? 'Vorschau' : 'Drucken / PDF'}</a>
        {inv.status === 'draft' ? <Button variant="primary" busy={busy} onClick={() => void issue()}>Ausstellen</Button> : <Button onClick={onClose}>Schließen</Button>}
      </>}>
      {!inv ? <LoadState error={error} loading /> : (
        <div className="split">
          <div>
            {inv.status === 'cancelled' && <p className="notice danger">Storniert durch {inv.cancelledByNumber ? <button type="button" className="linkbtn" onClick={() => openInvoice(inv.cancelledById!)}>{inv.cancelledByNumber}</button> : 'Stornobeleg'}. Grund: {inv.cancelReason}</p>}
            {inv.kind === 'cancellation' && inv.cancelsId && <p className="notice">Storniert die Rechnung <button type="button" className="linkbtn" onClick={() => openInvoice(inv.cancelsId!)}>{inv.cancelsNumber}</button>.</p>}
            {inv.status === 'draft' ? <Recipient inv={inv} /> : (
              <div className="chosen"><span>
                {inv.recipientCompany && <><b>{inv.recipientCompany}</b><br /></>}{inv.recipientName}{inv.recipientCompany ? '' : ''}<br />
                <small>{[inv.recipientStreet, [inv.recipientZip, inv.recipientCity].filter(Boolean).join(' '), inv.recipientCountry].filter(Boolean).join(', ')}{inv.recipientVatId && ` · USt-IdNr. ${inv.recipientVatId}`}</small>
              </span><span className="right muted small">Datum {deDate(inv.issueDate)}<br />Leistung {deDate(inv.serviceFrom)} – {deDate(inv.serviceTo)}{inv.dueDate && inv.kind === 'invoice' && <><br />fällig {deDate(inv.dueDate)}</>}</span></div>
            )}
            <Lines inv={inv} />
          </div>
          <aside>
            <h3 className="first">Beträge</h3>
            <table className="sums"><tbody>
              {inv.taxes.map((t) => (
                <tr key={t.rate} className="vat"><td>Netto {t.rate.toLocaleString('de-DE')} % {formatMoney(t.netCents)}</td><td className="num">USt {formatMoney(t.taxCents)}</td></tr>
              ))}
              <tr className="sum"><td>Gesamt (brutto)</td><td className="num">{formatMoney(inv.grossCents)}</td></tr>
              {inv.status !== 'draft' && inv.kind === 'invoice' && <>
                <tr><td>Bezahlt</td><td className="num">{formatMoney(inv.paidCents)}</td></tr>
                <tr className="sum"><td>Offen</td><td className="num">{formatMoney(inv.openCents)}</td></tr>
              </>}
            </tbody></table>
            {inv.status === 'draft' && <p className="muted small">Entwurf – noch ohne Rechnungsnummer. Beim Ausstellen werden noch nicht zugeordnete Anzahlungen der Reservierung verrechnet.</p>}
            {(inv.status === 'issued' || inv.payments.length > 0) && inv.kind === 'invoice' && <Payments inv={inv} />}
            {inv.issuedAt && <p className="muted small">Ausgestellt {fmtDateTime(inv.issuedAt)} von {inv.issuedBy}</p>}
          </aside>
        </div>
      )}
      {inv && mail && <MailDialog path={`/invoices/${id}/mail`} title={`Rechnung ${inv.number} per E-Mail`} onClose={() => setMail(false)} onSent={bump} />}
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
    serviceFrom: inv.serviceFrom ?? '', serviceTo: inv.serviceTo ?? '', notes: inv.notes,
  };
  const [v, setV] = useState(init);
  useEffect(() => setV(init), [inv.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const f = useSubmit(invoiceUpdateInput, async (d) => { await api('PUT', `/invoices/${inv.id}`, d); toast('Gespeichert'); bump(); });
  const input = (k: keyof typeof v, label: string, o: { wide?: boolean; type?: string; hint?: string } = {}) => (
    <Field label={label} error={f.errors[k]} wide={o.wide} hint={o.hint}><input type={o.type ?? 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  return (
    <form onSubmit={(e) => void f.submit({ ...v, serviceFrom: v.serviceFrom || null, serviceTo: v.serviceTo || null, version: inv.version }, e)} noValidate>
      <h3 className="first">Rechnungsempfänger</h3>
      <div className="formgrid">
        {input('recipientCompany', 'Firma', { hint: 'leer bei Privatrechnung' })}{input('recipientName', 'Name / z. Hd.')}
        {input('recipientStreet', 'Straße und Hausnummer', { wide: true })}{input('recipientZip', 'PLZ')}{input('recipientCity', 'Ort')}
        {input('recipientCountry', 'Land')}{input('recipientVatId', 'USt-IdNr. des Empfängers', { hint: 'bei Firmen, falls vorhanden' })}
        {input('serviceFrom', 'Leistung von', { type: 'date' })}{input('serviceTo', 'Leistung bis', { type: 'date' })}
        <Field label="Hinweis auf der Rechnung" wide error={f.errors.notes}><textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      {dirty && <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Empfänger speichern</Button></div>}
    </form>
  );
}

function Lines({ inv }: { inv: InvoiceDto }) {
  const { bump } = useData();
  const toast = useToast();
  const draft = inv.status === 'draft';
  const base = useLoad(async () => {
    if (!draft) return null;
    const [services, rates] = await Promise.all([api<ServiceDto[]>('GET', '/services'), api<TaxRateDto[]>('GET', '/tax-rates')]);
    return { services: services.filter((s) => s.active), rates: rates.filter((r) => r.active) };
  }, [draft]);
  const [v, setV] = useState({ description: '', detail: '', quantity: '1', price: '', rate: '' });
  const f = useSubmit(invoiceLineInput, async (d) => { await api('POST', `/invoices/${inv.id}/lines`, d); setV({ description: '', detail: '', quantity: '1', price: '', rate: v.rate }); bump(); });
  const remove = async (lineId: string) => { try { await api('POST', `/invoice-lines/${lineId}/remove`); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const pickService = (sid: string) => {
    const s = base.data?.services.find((x) => x.id === sid);
    if (s) setV({ ...v, description: s.name, price: moneyInput(s.priceCents), rate: String(s.taxRatePercent) });
  };
  const defaultRate = v.rate || String(base.data?.rates.find((r) => r.defaultFor === 'services')?.ratePercent ?? 19);
  const errs = [...new Set(Object.values(f.errors))];
  return (
    <>
      <h3>Positionen</h3>
      {inv.lines.length === 0 && <p className="muted">Noch keine Positionen.</p>}
      {inv.lines.length > 0 && (
        <div className="tablewrap"><table className="nights lines">
          <thead><tr><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">USt</th><th className="num">Betrag</th>{draft && <th />}</tr></thead>
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
      {draft && (
        <form className="addcharge" noValidate onSubmit={(e) => void f.submit({
          description: v.description, detail: v.detail, quantity: Number(v.quantity.replace(',', '.')), unitPriceCents: parseMoney(v.price), taxRatePercent: Number(defaultRate),
        }, e)}>
          <select value="" onChange={(e) => pickService(e.target.value)} aria-label="Leistung übernehmen">
            <option value="">Leistung übernehmen …</option>
            {base.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMoney(s.priceCents)})</option>)}
          </select>
          <input placeholder="Bezeichnung" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} aria-label="Bezeichnung" />
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
  const [v, setV] = useState({ amount: suggestCents > 0 ? moneyInput(suggestCents) : '', method: 'Bar', date: todayBerlin(), payer: '', note: '' });
  useEffect(() => setV((x) => ({ ...x, amount: suggestCents > 0 ? moneyInput(suggestCents) : '' })), [suggestCents]);
  const f = useSubmit(paymentInput, async (d) => {
    await api('POST', '/payments', d);
    toast(`${formatMoney(d.amountCents)} (${d.method}) gebucht`);
    bump();
    onDone?.();
  });
  return (
    <form className="payform" noValidate onSubmit={(e) => void f.submit({ bookingId, invoiceId, amountCents: parseMoney(v.amount), method: v.method, date: v.date, payer: v.payer, note: v.note }, e)}>
      <div className="segmented" role="radiogroup" aria-label="Zahlungsart">
        {PAYMENT_METHODS_BILLING.slice(0, 3).map((m) => <button key={m} type="button" role="radio" aria-checked={v.method === m} className={v.method === m ? 'on' : ''} onClick={() => setV({ ...v, method: m })}>{m}</button>)}
        <select value={PAYMENT_METHODS_BILLING.slice(0, 3).includes(v.method as never) ? '' : v.method} onChange={(e) => e.target.value && setV({ ...v, method: e.target.value })} aria-label="Weitere Zahlungsart">
          <option value="">weitere …</option>{PAYMENT_METHODS_BILLING.slice(3).map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <div className="inlinefields">
        <input inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="Betrag" aria-label="Betrag" />
        <input type="date" value={v.date} max={todayBerlin()} onChange={(e) => setV({ ...v, date: e.target.value })} aria-label="Datum" />
      </div>
      <input value={v.payer} onChange={(e) => setV({ ...v, payer: e.target.value })} placeholder="Zahler (falls abweichend)" aria-label="Zahler" />
      <input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Bemerkung" aria-label="Bemerkung" />
      {Object.keys(f.errors).length > 0 && <p className="error">{[...new Set(Object.values(f.errors))].join(' · ')}</p>}
      <Button type="submit" variant="primary" busy={f.busy}>Zahlung buchen</Button>
    </form>
  );
}

export function PaymentList({ list }: { list: PaymentDto[] }) {
  const { bump } = useData();
  const toast = useToast();
  const [reverse, setReverse] = useState<PaymentDto | null>(null);
  const f = useSubmit(reverseInput, async (d) => { await api('POST', `/payments/${reverse!.id}/reverse`, d); toast('Gegenbuchung erfasst'); setReverse(null); bump(); });
  const [note, setNote] = useState('');
  if (!list.length) return <p className="muted small">Noch keine Zahlungen.</p>;
  return (
    <>
      <ul className="payments">
        {list.map((p) => (
          <li key={p.id} className={p.reversed || p.reversesId ? 'struck' : ''}>
            <span>{deDate(p.date)} · {p.method}{p.invoiceNumber ? ` · ${p.invoiceNumber}` : ' · Anzahlung'}<br /><small>{[p.payer, p.note, p.recordedBy].filter(Boolean).join(' · ')}</small></span>
            <b className="num">{formatMoney(p.amountCents)}</b>
            {!p.reversed && !p.reversesId && <button type="button" className="linkbtn" onClick={() => { setNote(''); setReverse(p); }}>Gegenbuchen</button>}
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
