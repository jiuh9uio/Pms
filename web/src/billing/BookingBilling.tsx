import { useState } from 'react';
import type { BookingBillingDto } from '../../../src/shared/billing.js';
import { formatMoney, type BookingDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, useLoad, useToast } from '../ui.tsx';
import { InvoiceStatus, PaymentForm, PaymentList } from './InvoiceDialog.tsx';

/** In der Reservierung: Rechnungen, Anzahlungen, Zahlungen und was noch offen ist. */
export function BookingBilling({ booking }: { booking: BookingDto }) {
  const { rev, bump, openInvoice } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<BookingBillingDto>('GET', `/bookings/${booking.id}/billing`), [booking.id, rev]);
  const [pay, setPay] = useState(false);
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
        {drafts.length === 0 && <Button variant="primary" busy={busy === 'all'} onClick={() => void create('all')}>Rechnung erstellen</Button>}
        {drafts.length === 0 && booking.chargesCents > 0 && <>
          <Button busy={busy === 'lodging'} onClick={() => void create('lodging')}>Nur Übernachtung</Button>
          <Button busy={busy === 'extras'} onClick={() => void create('extras')}>Nur Extras</Button>
        </>}
        <Button onClick={() => setPay(!pay)} aria-expanded={pay}>{pay ? 'Zahlung schließen' : 'Anzahlung / Zahlung'}</Button>
      </div>
      {pay && <PaymentForm bookingId={booking.id} suggestCents={Math.max(0, balance)} onDone={() => setPay(false)} />}
      {data.payments.length > 0 && <><h3>Zahlungen</h3><PaymentList list={data.payments} /></>}
      {data.unassignedPaidCents !== 0 && <p className="muted small">{formatMoney(data.unassignedPaidCents)} Anzahlung ohne Rechnung – wird beim Ausstellen der nächsten Rechnung verrechnet.</p>}
    </>
  );
}
