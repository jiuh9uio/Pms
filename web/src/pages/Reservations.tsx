import { useState } from 'react';
import { ROOM_STATUSES, STATUS_LABEL, formatMoney, todayBerlin, type BookingListRow } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { StatusBadge, deDate, persons } from '../hotel/common.tsx';
import { Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

/** compact = schmale Darstellung für die Übersicht (ohne Personen und Preis) */
export function BookingTable({ rows, action, compact }: { rows: BookingListRow[]; action?: (r: BookingListRow) => React.ReactNode; compact?: boolean }) {
  const { openBooking } = useData();
  return (
    <div className="tablewrap">
      <table>
        <thead><tr><th>Gast</th><th>Zimmer</th><th>Zeitraum</th>{!compact && <th className="hide-sm">Personen</th>}<th>Status</th>{!compact && <th className="num hide-sm">Logis</th>}{action && <th></th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="rowlink" tabIndex={0} onClick={() => openBooking(r.bookingId)} onKeyDown={(e) => { if (e.key === 'Enter') openBooking(r.bookingId); }}>
              <td><b>{r.guestName}</b><br /><small className="nowrap">{r.number}</small><small>{r.groupName && ` · ${r.groupName}`}{r.roomCount > 1 && ` · ${r.roomCount} Zimmer`}</small></td>
              <td>{r.roomNumber}<br /><small>{r.categoryName}</small></td>
              <td className="nowrap">{compact ? `bis ${deDate(r.to).slice(0, 6)}` : `${deDate(r.from)} – ${deDate(r.to)}`}<br /><small>{r.nights} {r.nights === 1 ? 'Nacht' : 'Nächte'}{compact && ` · ${persons(r.adults, r.children)}`}</small></td>
              {!compact && <td className="hide-sm">{persons(r.adults, r.children)}</td>}
              <td><StatusBadge status={r.status} /></td>
              {!compact && <td className="num hide-sm">{formatMoney(r.lodgingCents)}</td>}
              {action && <td className="num" onClick={(e) => e.stopPropagation()}>{action(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Reservations() {
  const { rev, newBooking } = useData();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [from, setFrom] = useState(todayBerlin());
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (status) params.set('status', status);
  if (from) params.set('from', from);
  const { data, error } = useLoad(() => api<BookingListRow[]>('GET', '/bookings?' + params), [q, status, from, rev]);
  return (
    <>
      <PageHeader title="Reservierungen" actions={<Button variant="primary" onClick={() => newBooking()}>Neue Reservierung</Button>} />
      <div className="filters">
        <input type="search" placeholder="Name, Firma, Buchungsnummer, Zimmer …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="active">Alle aktiven</option><option value="">Alle</option>
          {ROOM_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <label className="inlinelabel">Abreise ab <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
      </div>
      <LoadState error={error} loading={!data} />
      {data && (data.length ? <div className="card flush"><BookingTable rows={data} /></div> : <p className="muted">Keine Reservierungen gefunden.</p>)}
    </>
  );
}
