import { useState } from 'react';
import type { GuestDto, GuestDuplicate } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

export function Guests() {
  const { user } = useAuth();
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
      {user.role === 'admin' && <Duplicates />}
    </>
  );
}

/** Mögliche doppelte Gäste finden und zusammenführen (nur Administrator). */
function Duplicates() {
  const toast = useToast();
  const { rev, bump } = useData();
  const [open, setOpen] = useState(false);
  const { data, error } = useLoad(() => (open ? api<GuestDuplicate[]>('GET', '/guests/duplicates') : Promise.resolve(null)), [open, rev]);
  const name = (g: GuestDto) => [g.firstName, g.lastName].filter(Boolean).join(' ');
  const detail = (g: GuestDto) => [g.email, g.phone, g.city].filter(Boolean).join(' · ') || 'keine weiteren Angaben';
  const merge = async (keep: GuestDto, other: GuestDto) => {
    if (!window.confirm(`„${name(other)}“ in „${name(keep)}“ aufgehen lassen?\n\nAlle Reservierungen gehen auf den verbleibenden Gast über, fehlende Angaben werden ergänzt. Der zweite Eintrag wird gelöscht – das lässt sich nicht rückgängig machen.`)) return;
    try { const r = await api<{ bookingsMoved: number }>('POST', `/guests/${keep.id}/merge`, { otherId: other.id }); toast(`Zusammengeführt – ${r.bookingsMoved} Reservierung(en) übernommen`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <section className="card">
      <div className="cardhead"><div><h2>Doppelte Gäste</h2><p className="muted">Gäste mit gleicher E-Mail-Adresse oder gleichem Namen – oft derselbe Mensch, zweimal angelegt.</p></div>
        <div className="actions"><Button onClick={() => setOpen(!open)}>{open ? 'Ausblenden' : 'Doppelte suchen'}</Button></div></div>
      {open && <LoadState error={error} loading={!data} />}
      {open && data && (data.length === 0 ? <p className="muted">Keine möglichen Doppelten gefunden.</p> : (
        <div className="tablewrap"><table>
          <thead><tr><th>Bleibt</th><th>Geht darin auf</th><th>Grund</th><th /></tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.keep.id + d.other.id}>
              <td><b>{name(d.keep)}</b> <small className="muted">({d.keep.stays} Res.)</small><br /><small>{detail(d.keep)}</small></td>
              <td><b>{name(d.other)}</b> <small className="muted">({d.other.stays} Res.)</small><br /><small>{detail(d.other)}</small></td>
              <td>{d.reason}</td>
              <td className="num"><Button onClick={() => void merge(d.keep, d.other)}>Zusammenführen</Button> <Button onClick={() => void merge(d.other, d.keep)}>Umgekehrt</Button></td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      {open && <p className="muted small">Gleicher Name heißt nicht immer gleicher Mensch – bitte Ort, Telefon und E-Mail vergleichen. Rechnungen bleiben unverändert.</p>}
    </section>
  );
}
