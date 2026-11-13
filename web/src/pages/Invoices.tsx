import { useState } from 'react';
import type { InvoiceListRow } from '../../../src/shared/billing.js';
import { formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { InvoiceStatus } from '../billing/InvoiceDialog.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

export function Invoices() {
  const { rev, bump, openInvoice } = useData();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [q, setQ] = useState('');
  const today = todayBerlin();
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (q.trim()) params.set('q', q.trim());
  const { data, error } = useLoad(() => api<InvoiceListRow[]>('GET', '/invoices?' + params), [status, q, rev]);
  const open = (data ?? []).reduce((s, i) => s + i.openCents, 0);
  const free = async () => {
    try { const r = await api<{ id: string }>('POST', '/invoices', { include: 'none' }); bump(); openInvoice(r.id); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <>
      <PageHeader title="Rechnungen" sub="Rechnungen, offene Posten und Export für die Buchhaltung"
        actions={<Button onClick={() => void free()}>Freie Rechnung</Button>} />
      <div className="filters">
        <div className="segmented" role="radiogroup" aria-label="Filter">
          {[['open', 'Offen'], ['draft', 'Entwürfe'], ['', 'Alle']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={status === k} className={status === k ? 'on' : ''} onClick={() => setStatus(k!)}>{l}</button>)}
        </div>
        <input type="search" placeholder="Nummer, Empfänger, Buchung …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
      </div>
      <LoadState error={error} loading={!data} />
      {data && status === 'open' && data.length > 0 && <p className="notice warn">{data.length} offene {data.length === 1 ? 'Rechnung' : 'Rechnungen'} über zusammen {formatMoney(open)}</p>}
      {data && (data.length === 0 ? <p className="muted">{status === 'open' ? 'Keine offenen Rechnungen.' : 'Keine Rechnungen gefunden.'} Rechnungen entstehen aus der Reservierung („Rechnung erstellen“).</p> : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th className="hide-sm">Buchung</th><th>Status</th><th className="num">Betrag</th><th className="num">Offen</th></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} className="rowlink" tabIndex={0} onClick={() => openInvoice(i.id)} onKeyDown={(e) => { if (e.key === 'Enter') openInvoice(i.id); }}>
              <td className="strong nowrap">{i.number ?? 'Entwurf'}</td><td className="nowrap">{i.issueDate ? deDate(i.issueDate) : '–'}</td>
              <td>{i.recipientCompany || i.recipientName}{i.recipientCompany && i.recipientName && <><br /><small>{i.recipientName}</small></>}</td>
              <td className="hide-sm">{i.bookingNumber ?? '–'}</td><td><InvoiceStatus inv={i} /></td>
              <td className="num">{formatMoney(i.grossCents)}</td><td className="num">{i.openCents ? formatMoney(i.openCents) : '–'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      <section className="card">
        <h2>Export für die Buchhaltung</h2>
        <p className="muted">CSV-Dateien (Semikolon, deutsche Zahlen) mit allen ausgestellten Rechnungen und Stornobelegen inkl. Netto und Umsatzsteuer je Satz sowie allen Zahlungen. Ein DATEV-Format ist noch nicht enthalten.</p>
        <div className="filters">
          <label className="inlinelabel">von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inlinelabel">bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <a className="btn" href={`/api/v1/invoices/export.csv?from=${from}&to=${to}`}>Rechnungen (CSV)</a>
          <a className="btn" href={`/api/v1/payments/export.csv?from=${from}&to=${to}`}>Zahlungen (CSV)</a>
        </div>
      </section>
    </>
  );
}
