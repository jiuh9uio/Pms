import { useState } from 'react';
import type { GuestDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

export function Guests() {
  const { rev, openGuest, newBooking } = useData();
  const [q, setQ] = useState('');
  const { data, error } = useLoad(() => api<GuestDto[]>('GET', '/guests?q=' + encodeURIComponent(q.trim())), [q, rev]);
  return (
    <>
      <PageHeader title="Gäste" actions={<Button variant="primary" onClick={() => openGuest(null)}>Gast anlegen</Button>} />
      <div className="filters"><input type="search" placeholder="Name, Firma, E-Mail, Telefon, Ort …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" /></div>
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">{q ? 'Kein Gast gefunden.' : 'Noch keine Gäste angelegt. Gäste entstehen auch automatisch beim Anlegen einer Reservierung.'}</p> : (
        <div className="tablewrap card flush">
          <table>
            <thead><tr><th>Name</th><th className="hide-sm">Kontakt</th><th className="hide-sm">Ort</th><th className="num">Aufenthalte</th><th className="hide-sm">Zuletzt</th><th></th></tr></thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.id} className="rowlink" tabIndex={0} onClick={() => openGuest(g.id)} onKeyDown={(e) => { if (e.key === 'Enter') openGuest(g.id); }}>
                  <td><b>{[g.firstName, g.lastName].filter(Boolean).join(' ')}</b>{(g.stays ?? 0) >= 3 && <> <Badge tone="accent">Stammgast</Badge></>}{g.company && <><br /><small>{g.company}</small></>}</td>
                  <td className="hide-sm">{g.phone}{g.phone && g.email && <br />}<small>{g.email}</small></td>
                  <td className="hide-sm">{g.city}</td>
                  <td className="num">{g.stays}</td>
                  <td className="muted hide-sm">{g.lastStay ? deDate(g.lastStay) : '–'}</td>
                  <td className="num" onClick={(e) => e.stopPropagation()}><Button onClick={() => newBooking({ guest: g })}>Buchen</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
