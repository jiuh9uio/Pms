import { useState } from 'react';
import { formatMoney, type CompanyDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

export function Companies() {
  const { rev, openCompany, newBooking } = useData();
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api<CompanyDto[]>('GET', '/companies?q=' + encodeURIComponent(q.trim())), [q, rev]);
  return (
    <>
      <PageHeader title="Firmen" sub="Firmenkunden mit Rechnungsanschrift, vereinbarten Preisen und Zahlungsziel"
        actions={<Button variant="primary" onClick={() => openCompany(null)}>Firma anlegen</Button>} />
      <div className="filters"><input type="search" placeholder="Firma, Ort, Ansprechpartner …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" /></div>
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">{q ? 'Keine Firma gefunden.' : 'Noch keine Firmen angelegt.'}</p> : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Firma</th><th className="hide-sm">Ansprechpartner</th><th className="hide-sm">Vereinbarte Preise</th><th className="num">Buchungen</th><th className="hide-sm">Zuletzt</th><th className="num hide-sm">Berechnet</th><th /></tr></thead>
          <tbody>{data.map((c) => (
            <tr key={c.id} className="rowlink" tabIndex={0} onClick={() => openCompany(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') openCompany(c.id); }}>
              <td><b>{c.name}</b> {!c.active && <Badge>inaktiv</Badge>}{c.city && <><br /><small>{c.city}</small></>}</td>
              <td className="hide-sm">{c.contactName}{c.email && <><br /><small>{c.email}</small></>}</td>
              <td className="hide-sm">{c.rates.length ? `${c.rates.length} ${c.rates.length === 1 ? 'Kategorie' : 'Kategorien'}` : <span className="muted">keine</span>}</td>
              <td className="num">{c.bookingCount}</td><td className="hide-sm muted">{deDate(c.lastStay)}</td><td className="num hide-sm">{formatMoney(c.revenueCents)}</td>
              <td className="num" onClick={(e) => e.stopPropagation()}>{c.active && <Button onClick={() => newBooking({ companyId: c.id })}>Buchen</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
    </>
  );
}
