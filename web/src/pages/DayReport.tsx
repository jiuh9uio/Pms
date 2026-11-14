import { useState } from 'react';
import { addDays, formatMoney, parseMoney, todayBerlin } from '../../../src/shared/hotel.js';
import type { DayReport as Report } from '../../../src/shared/team.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, PageHeader, useLoad } from '../ui.tsx';

/** Tagesabschluss: Zahlungen je Zahlungsart, Rechnungen, offene An- und Abreisen – zum Abgleich mit Kasse und EC-Gerät. */
export function DayReport() {
  const { rev, openBooking } = useData();
  const today = todayBerlin();
  const [date, setDate] = useState(today);
  const [counted, setCounted] = useState('');
  const { data, error } = useLoad(() => api<Report>('GET', `/reports/day?date=${date}`), [date, rev]);
  const c = parseMoney(counted);
  const diff = data && !Number.isNaN(c) && counted.trim() ? c - data.cashCents : null; // parseMoney liefert Cent
  return (
    <>
      <PageHeader title="Tagesabschluss" sub={`${deDate(date)}${date === today ? ' · heute' : ''}`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">‹</Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" />
          <Button onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag">›</Button>
          <Button onClick={() => window.print()}>Drucken</Button>
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Tagesabschluss {deDate(date)}</h2>
          <div className="kpis">
            <div className="card kpicard printable"><span>Zahlungen gesamt</span><b>{formatMoney(data.totalCents)}</b><small>{data.paymentList.length} Buchungen</small></div>
            <div className="card kpicard printable"><span>davon bar</span><b>{formatMoney(data.cashCents)}</b><small>laut Programm</small></div>
            <div className="card kpicard printable"><span>Rechnungen</span><b>{data.invoices.count}</b><small>{formatMoney(data.invoices.cents)}{data.invoices.cancelled ? ` · ${data.invoices.cancelled} Storno` : ''}</small></div>
            <div className="card kpicard printable"><span>Belegt</span><b>{data.occupied} / {data.rooms}</b><small>Zimmer in dieser Nacht</small></div>
          </div>
          <section className="card printable">
            <h2>Zahlungen je Zahlungsart</h2>
            {data.payments.length === 0 ? <p className="muted">An diesem Tag wurde keine Zahlung erfasst.</p> : (
              <div className="tablewrap"><table>
                <thead><tr><th>Zahlungsart</th><th className="num">Anzahl</th><th className="num">Summe</th></tr></thead>
                <tbody>{data.payments.map((p) => <tr key={p.method}><td>{p.method}</td><td className="num">{p.count}</td><td className="num">{formatMoney(p.cents)}</td></tr>)}
                  <tr><td><b>Gesamt</b></td><td className="num"><b>{data.paymentList.length}</b></td><td className="num"><b>{formatMoney(data.totalCents)}</b></td></tr></tbody>
              </table></div>
            )}
            <div className="formgrid cols3 noprint">
              <Field label="Gezähltes Bargeld aus diesen Zahlungen" hint="nur zum Vergleichen – wird nicht gespeichert"><input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="0,00" /></Field>
              {diff !== null && <p className={`notice ${diff === 0 ? '' : 'warn'}`}>{diff === 0 ? 'Stimmt mit dem Programm überein.' : `Abweichung: ${diff > 0 ? '+' : ''}${formatMoney(diff)} gegenüber dem Programm.`}</p>}
            </div>
          </section>
          {data.paymentList.length > 0 && (
            <section className="card printable">
              <h2>Einzelne Zahlungen</h2>
              <div className="tablewrap"><table>
                <thead><tr><th>Zeit</th><th>Zahlungsart</th><th>Beleg</th><th>Zahler</th><th>Erfasst von</th><th className="num">Betrag</th></tr></thead>
                <tbody>{data.paymentList.map((p, i) => <tr key={i}><td>{p.time}</td><td>{p.method}{p.reversal && <> <Badge tone="warn">Gegenbuchung</Badge></>}</td><td>{p.ref || '–'}</td><td>{p.payer || '–'}</td><td>{p.by}</td><td className="num">{formatMoney(p.cents)}</td></tr>)}</tbody>
              </table></div>
            </section>
          )}
          <section className="card printable">
            <h2>An- und Abreisen</h2>
            <p>Anreisen: {data.arrivals.checkedIn} von {data.arrivals.expected} eingecheckt · Abreisen: {data.departures.checkedOut} von {data.departures.expected} ausgecheckt</p>
            {data.arrivals.open.length > 0 && <p><b>Noch nicht angereist:</b> {data.arrivals.open.map((o, i) => <span key={i}>{i > 0 && ', '}<button type="button" className="linkbtn" onClick={() => openBooking(o.bookingId)}>Zi. {o.room} {o.guest}</button></span>)}</p>}
            {data.departures.open.length > 0 && <p><b>Noch nicht ausgecheckt:</b> {data.departures.open.map((o, i) => <span key={i}>{i > 0 && ', '}<button type="button" className="linkbtn" onClick={() => openBooking(o.bookingId)}>Zi. {o.room} {o.guest}</button></span>)}</p>}
            {data.arrivals.open.length === 0 && data.departures.open.length === 0 && <p className="muted">Nichts offen.</p>}
          </section>
          <p className="muted small noprint">Der Tagesabschluss ist eine Übersicht zum Abgleichen und ändert nichts. Er zählt die im Programm erfassten Zahlungen nach ihrem Zahlungsdatum. Er ist kein Kassenbuch und ersetzt keine Kassenaufzeichnung nach den steuerlichen Vorschriften.</p>
        </>
      )}
    </>
  );
}
