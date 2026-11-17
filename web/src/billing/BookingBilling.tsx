import { useState } from 'react';
import type { BookingBillingDto } from '../../../src/shared/billing.js';
import { formatMoney, type BookingDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, useLoad, useToast } from '../ui.tsx';
import { InvoiceStatus, PaymentForm, PaymentList } from './InvoiceDialog.tsx';
import { SettleDialog } from './SettleDialog.tsx';
import { DepositPanel } from './DepositPanel.tsx';
import { CancelFeeDialog } from './CancelFeeDialog.tsx';

/** In der Reservierung: Rechnungen, Anzahlungen, Zahlungen und was noch offen ist. */
export function BookingBilling({ booking }: { booking: BookingDto }) {
  const { rev, bump, openInvoice } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<BookingBillingDto>('GET', `/bookings/${booking.id}/billing`), [booking.id, rev]);
  const [pay, setPay] = useState(false);
  const [payCents, setPayCents] = useState<number | null>(null);
  const [settle, setSettle] = useState(false);
  const [fee, setFee] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (include: 'all' | 'lodging' | 'extras') => {
    setBusy(include);
    try {
      const r = await api<{ id: string }>('POST', '/invoices', { bookingId: booking.id, include });
      bump();
      openInvoice(r.id);
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  if (!data) return null;
  const balance = booking.totalCents - data.paidCents;
  const notInvoiced = booking.totalCents - data.invoicedCents;
  const drafts = data.invoices.filter((i) => i.status === 'draft');
  // offen ist, was die Reservierung noch kostet – oder was auf ausgestellten Rechnungen noch fehlt
  const openOnInvoices = data.invoices.filter((i) => i.status === 'issued' && i.kind === 'invoice').reduce((x, i) => x + Math.max(0, i.openCents), 0);
  const toPay = Math.max(balance, openOnInvoices, 0);
  // alles berechnet und bezahlt: kein weiterer Bezahlvorgang möglich
  const settled = toPay === 0 && data.uninvoicedCents <= 0 && data.invoices.some((i) => i.status === 'issued');
  return (
    <>
      <h3>Rechnungen und Zahlungen</h3>
      <table className="sums"><tbody>
        <tr><td>Bezahlt (inkl. Anzahlungen)</td><td className="num">{formatMoney(data.paidCents)}</td></tr>
        <tr className="sum"><td>{balance >= 0 ? 'Noch zu zahlen' : 'Guthaben des Gastes'}</td><td className="num">{formatMoney(Math.abs(balance))}</td></tr>
        {data.invoicedCents > 0 && notInvoiced !== 0 && <tr><td>Noch nicht berechnet</td><td className="num">{formatMoney(notInvoiced)}</td></tr>}
      </tbody></table>
      {data.invoices.length > 0 && (
        <ul className="plain compact">
          {data.invoices.map((i) => (
            <li key={i.id} className="rowlink" onClick={() => openInvoice(i.id)}>
              <span>{i.number ?? 'Entwurf'} <InvoiceStatus inv={i} /><br /><small>{i.issueDate ? deDate(i.issueDate) : 'noch nicht ausgestellt'} · {i.recipientCompany || i.recipientName}</small></span>
              <span className="right">{formatMoney(i.grossCents)}{i.openCents !== 0 && <><br /><small>offen {formatMoney(i.openCents)}</small></>}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="btnrow">
        {!settled && <Button variant="primary" onClick={() => setSettle(true)}>Bezahlen / Abrechnen</Button>}
        {(data.payments.length > 0 || data.invoices.length > 0) && <a className="btn" href={`/buchhaltung/${booking.id}`} target="_blank" rel="noopener" title="Alle Zahlungen und Rechnungen dieser Reservierung für die Buchhaltung">Zettel Buchhaltung</a>}
        {drafts.length === 0 && data.uninvoicedCents > 0 && booking.chargesCents > 0 && <>
          <Button busy={busy === 'lodging'} onClick={() => void create('lodging')}>Rechnung nur Übernachtung</Button>
          <Button busy={busy === 'extras'} onClick={() => void create('extras')}>Rechnung nur Extras</Button>
        </>}
        {drafts.length === 0 && data.uninvoicedCents > 0 && <Button busy={busy === 'all'} onClick={() => void create('all')}>Rechnungsentwurf</Button>}
        {booking.rooms.some((r) => r.status === 'cancelled' || r.status === 'no_show') && <Button onClick={() => setFee(true)} title="Ausfallgebühr für stornierte oder nicht angereiste Zimmer als Rechnungsentwurf">Ausfallgebühr …</Button>}
        {toPay > 0 && <Button onClick={() => { setPayCents(null); setPay(!pay); }} aria-expanded={pay}>{pay ? 'Zahlung schließen' : 'Einzelne Zahlung'}</Button>}
      </div>
      {settled && <p className="notice">Alles berechnet und bezahlt – es ist nichts mehr zu kassieren. Eine falsch gebuchte Zahlung korrigiert der Administrator in der Rechnung über „Gegenbuchen“.</p>}
      {settle && <SettleDialog booking={booking} onClose={() => setSettle(false)} />}
      {fee && <CancelFeeDialog bookingId={booking.id} onClose={() => setFee(false)} />}
      {pay && toPay > 0 && <PaymentForm bookingId={booking.id} suggestCents={payCents ?? toPay} onDone={() => { setPay(false); setPayCents(null); }} />}
      {!settled && toPay > 0 && <>
        <h3>Anzahlung</h3>
        <DepositPanel kind="booking" refId={booking.id} base={`/bookings/${booking.id}`} suggestCents={Math.round((booking.totalCents * 0.3) / 1000) * 1000}
          latestDue={booking.rooms.map((r) => r.from).sort()[0] ?? ''} onPay={(c) => { setPayCents(Math.min(c, toPay)); setPay(true); }} />
      </>}
      {data.payments.length > 0 && <><h3>Zahlungen</h3><PaymentList list={data.payments} /></>}
      {data.unassignedPaidCents !== 0 && <p className="muted small">{formatMoney(data.unassignedPaidCents)} Anzahlung ohne Rechnung – wird beim Ausstellen der nächsten Rechnung verrechnet.</p>}
    </>
  );
}
