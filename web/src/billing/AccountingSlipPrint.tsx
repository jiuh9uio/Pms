import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { AccountingSlipDto } from '../../../src/shared/billing.js';
import { formatMoney } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, LoadState, fmtDateTime, useLoad, useToast } from '../ui.tsx';

/** Zettel für die Buchhaltung (A4, halbe Seite reicht): Zahlungen, Rechnungen mit Steuer, Summen. Interner Vermerk. */
export function AccountingSlipPrint() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const payment = params.get('payment');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error } = useLoad(() => api<AccountingSlipDto>('GET', `/bookings/${id}/accounting-slip${payment ? `?payment=${payment}` : ''}`), [id, payment]);
  useEffect(() => { if (data) document.title = `Buchhaltung ${data.booking.number}`; }, [data]);
  useEffect(() => { if (!data || params.get('druck') !== '1') return; const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }, [data, params]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  const s = data;
  const bon = async () => {
    setBusy(true);
    try { await api('POST', `/bookings/${id}/accounting-slip/bon${payment ? `?payment=${payment}` : ''}`, {}); toast('Zettel auf dem Bondrucker gedruckt'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Druck fehlgeschlagen', 'error'); }
    setBusy(false);
  };
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Drucken (A4)</Button>
        <Button busy={busy} onClick={() => void bon()}>Auf Bondrucker</Button>
        <span className="muted">Interner Zettel für die Buchhaltung – kein Kassenbeleg und keine Rechnung.</span>
      </div>
      <article className="invoice acctslip">
        <header><b>{s.hotelName}</b><span>Zahlung – für die Buchhaltung</span></header>
        <p className="muted small">Interner Zettel, kein Kassenbeleg · erstellt {fmtDateTime(s.createdAt)} von {s.createdBy}</p>
        <table className="kv"><tbody>
          <tr><th>Reservierung</th><td>{s.booking.number}</td><th>Aufenthalt</th><td>{deDate(s.booking.from)} – {deDate(s.booking.to)}</td></tr>
          <tr><th>Gast</th><td>{s.booking.guest}{s.booking.company && <> · {s.booking.company}</>}</td><th>Zimmer</th><td>{s.booking.rooms}</td></tr>
        </tbody></table>
        <h2>{s.onlyRecent ? 'Zahlung dieses Vorgangs' : 'Alle Zahlungen'}</h2>
        {s.payments.length === 0 ? <p>Keine Zahlung gebucht.</p> : (
          <table className="lines"><thead><tr><th>Datum</th><th>Zahlungsart</th><th>Hinweis</th><th className="num">Betrag</th></tr></thead><tbody>
            {s.payments.map((p, i) => (
              <tr key={i}><td>{deDate(p.date)}</td><td>{p.method}{p.reversal ? ' (Korrektur)' : ''}</td>
                <td>{[p.invoiceNumber ? `auf Rechnung ${p.invoiceNumber}` : '', p.givenCents != null && p.givenCents > p.amountCents ? `gegeben ${formatMoney(p.givenCents)}, Rückgeld ${formatMoney(p.givenCents - p.amountCents)}` : '', p.tse ?? '', `kassiert von ${p.recordedBy}`].filter(Boolean).join(' · ')}</td>
                <td className="num">{formatMoney(p.amountCents)}</td></tr>
            ))}
            {s.byMethod.map((m) => <tr key={m.method} className="sum"><td colSpan={3}>Summe {m.method}</td><td className="num">{formatMoney(m.amountCents)}</td></tr>)}
          </tbody></table>
        )}
        <h2>Rechnungen</h2>
        {s.invoices.length === 0 ? <p>Noch keine Rechnung ausgestellt.</p> : (
          <table className="lines"><thead><tr><th>Nummer</th><th>Datum</th><th>Steuer</th><th className="num">Brutto</th></tr></thead><tbody>
            {s.invoices.map((i) => (
              <tr key={i.number}><td>{i.kind === 'cancellation' ? 'Storno ' : ''}{i.number}{i.status === 'cancelled' ? ' (storniert)' : ''}</td><td>{deDate(i.issueDate)}</td>
                <td>{i.taxes.map((t) => `${t.rate.toLocaleString('de-DE')} %: netto ${formatMoney(t.netCents)}, MwSt ${formatMoney(t.taxCents)}`).join(' · ')}</td>
                <td className="num">{formatMoney(i.grossCents)}</td></tr>
            ))}
          </tbody></table>
        )}
        <table className="sums acctsums"><tbody>
          <tr><td>Gesamtbetrag der Reservierung</td><td className="num">{formatMoney(s.totalCents)}</td></tr>
          <tr><td>Bezahlt</td><td className="num">{formatMoney(s.paidCents)}</td></tr>
          <tr className="sum"><td>Offen</td><td className="num">{formatMoney(s.openCents)}</td></tr>
        </tbody></table>
        <div className="signatures"><span>Geprüft / abgelegt (Datum, Zeichen)</span></div>
      </article>
    </div>
  );
}
