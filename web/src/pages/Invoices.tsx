import { useState } from 'react';
import { PAYMENT_METHODS_BILLING, type InvoiceListRow } from '../../../src/shared/billing.js';
import { formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { InvoiceStatus } from '../billing/InvoiceDialog.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

const STATUS: [string, string][] = [['archive', 'Alle Rechnungen'], ['open', 'Offen'], ['paid', 'Bezahlt'], ['cancelled', 'Storniert'], ['draft', 'Entwürfe']];

/** Rechnungsarchiv des Hotels: alle Rechnungen und Stornobelege mit Suche, Filtern, Summen und PDF. */
export function Invoices() {
  const { rev, bump, openInvoice, openBooking } = useData();
  const toast = useToast();
  const today = todayBerlin();
  const [f, setF] = useState({ status: 'archive', q: '', from: '', to: '', serviceFrom: '', serviceTo: '', method: '' });
  const [more, setMore] = useState(false);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v.trim()) params.set(k, v.trim());
  const { data, error } = useLoad(() => api<InvoiceListRow[]>('GET', '/invoices?' + params), [params.toString(), rev]);
  const sum = (k: 'grossCents' | 'paidCents' | 'openCents') => (data ?? []).filter((i) => i.status !== 'draft').reduce((s, i) => s + i[k], 0);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const free = async () => {
    try { const r = await api<{ id: string }>('POST', '/invoices', { include: 'none' }); bump(); openInvoice(r.id); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const filtered = !!(f.from || f.to || f.serviceFrom || f.serviceTo || f.method);
  return (
    <>
      <PageHeader title="Rechnungsarchiv" sub="Alle Hotelrechnungen und Stornobelege – suchen, filtern, ansehen, drucken, versenden"
        actions={<Button onClick={() => void free()}>Freie Rechnung</Button>} />
      <div className="filters">
        <div className="segmented" role="radiogroup" aria-label="Status">
          {STATUS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.status === k} className={f.status === k ? 'on' : ''} onClick={() => set({ status: k })}>{l}</button>)}
        </div>
        <input type="search" placeholder="Rechnungsnummer, Gast, Firma, Reservierungsnummer …" value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Suche" />
        <Button onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Weniger Filter' : `Weitere Filter${filtered ? ' (aktiv)' : ''}`}</Button>
      </div>
      {more && (
        <div className="filters card">
          <label className="inlinelabel">Rechnungsdatum von <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="inlinelabel">bis <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
          <label className="inlinelabel">Leistungszeitraum von <input type="date" value={f.serviceFrom} onChange={(e) => set({ serviceFrom: e.target.value })} /></label>
          <label className="inlinelabel">bis <input type="date" value={f.serviceTo} onChange={(e) => set({ serviceTo: e.target.value })} /></label>
          <label className="inlinelabel">Zahlungsart <select value={f.method} onChange={(e) => set({ method: e.target.value })}><option value="">alle</option>{PAYMENT_METHODS_BILLING.map((m) => <option key={m}>{m}</option>)}</select></label>
          {filtered && <Button onClick={() => set({ from: '', to: '', serviceFrom: '', serviceTo: '', method: '' })}>Filter zurücksetzen</Button>}
        </div>
      )}
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">Keine Rechnungen gefunden. Rechnungen entstehen in der Reservierung über „Bezahlen / Abrechnen“.</p> : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th className="hide-sm">Leistungszeitraum</th><th className="hide-sm">Reservierung</th><th>Status</th><th className="num">Betrag</th><th className="num hide-sm">Bezahlt</th><th className="num">Offen</th><th /></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} className="rowlink" tabIndex={0} onClick={() => openInvoice(i.id)} onKeyDown={(e) => { if (e.key === 'Enter') openInvoice(i.id); }}>
              <td className="strong nowrap">{i.number ?? 'Entwurf'}</td><td className="nowrap">{i.issueDate ? deDate(i.issueDate) : '–'}</td>
              <td>{i.recipientCompany || i.recipientName}{i.recipientCompany && i.recipientName && <><br /><small>{i.recipientName}</small></>}</td>
              <td className="hide-sm nowrap">{i.serviceFrom ? `${deDate(i.serviceFrom)}${i.serviceTo && i.serviceTo !== i.serviceFrom ? ` – ${deDate(i.serviceTo)}` : ''}` : '–'}</td>
              <td className="hide-sm">{i.bookingId ? <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); openBooking(i.bookingId!); }}>{i.bookingNumber}</button> : '–'}</td>
              <td><InvoiceStatus inv={i} /></td>
              <td className="num">{formatMoney(i.grossCents)}</td><td className="num hide-sm">{i.status === 'draft' ? '–' : formatMoney(i.paidCents)}</td><td className="num">{i.openCents ? formatMoney(i.openCents) : '–'}</td>
              <td className="nowrap">{i.status !== 'draft' && <a className="linkbtn" href={`/api/v1/invoices/${i.id}/pdf`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>PDF</a>}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}>{data.length} {data.length === 1 ? 'Eintrag' : 'Einträge'}{data.length >= 500 ? ' (höchstens 500 – bitte Filter eingrenzen)' : ''}</td><td className="hide-sm" /><td className="hide-sm" /><td />
            <td className="num">{formatMoney(sum('grossCents'))}</td><td className="num hide-sm">{formatMoney(sum('paidCents'))}</td><td className="num">{formatMoney(sum('openCents'))}</td><td /></tr></tfoot>
        </table></div>
      ))}
      <p className="muted small">Ausgestellte Rechnungen lassen sich nicht ändern oder löschen; eine Korrektur erfolgt durch einen Stornobeleg (nur Administrator) und eine neue Rechnung. Das PDF wird beim Ausstellen gespeichert und danach unverändert ausgegeben. In den Summen zählen Stornobelege mit negativem Betrag.</p>
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
