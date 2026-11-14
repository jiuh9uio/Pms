import { useState } from 'react';
import { addDays, todayBerlin } from '../../../src/shared/hotel.js';
import type { CleanList, CleanRow } from '../../../src/shared/team.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const work = (r: CleanRow) => (r.departing ? 'Endreinigung' : r.staying ? 'Zwischenreinigung' : r.housekeeping === 'dirty' ? 'Reinigen' : '–');

/** Reinigungsliste: welches Zimmer heute wie zu reinigen ist – zum Abhaken am Bildschirm oder als Ausdruck. */
export function Housekeeping() {
  const toast = useToast();
  const { rev, bump } = useData();
  const today = todayBerlin();
  const [date, setDate] = useState(today);
  const [onlyWork, setOnlyWork] = useState(true);
  const { data, error } = useLoad(() => api<CleanList>('GET', `/housekeeping?date=${date}`), [date, rev]);
  const set = async (r: CleanRow, status: 'clean' | 'dirty') => {
    try { await api('POST', `/rooms/${r.roomId}/housekeeping`, { status }); toast(`Zimmer ${r.room}: ${status === 'clean' ? 'sauber' : 'zu reinigen'}`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const rows = data?.rows.filter((r) => !onlyWork || r.departing || r.staying || r.arriving || r.housekeeping === 'dirty') ?? [];
  return (
    <>
      <PageHeader title="Reinigung" sub={`${WEEKDAY[new Date(`${date}T12:00:00Z`).getUTCDay()]}, ${deDate(date)}${date === today ? ' · heute' : ''}`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">‹</Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" />
          <Button onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag">›</Button>
          <Button onClick={() => window.print()}>Drucken</Button>
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Reinigungsliste {deDate(date)}</h2>
          <div className="kpis">
            <div className="card kpicard printable"><span>Abreisen</span><b>{data.total.departures}</b><small>Endreinigung</small></div>
            <div className="card kpicard printable"><span>Bleiber</span><b>{data.total.stays}</b><small>Zwischenreinigung</small></div>
            <div className="card kpicard printable"><span>Anreisen</span><b>{data.total.arrivals}</b><small>müssen fertig sein</small></div>
            <div className="card kpicard"><span>Noch zu reinigen</span><b>{data.total.dirty}</b><small>laut Zimmerstatus</small></div>
          </div>
          <label className="check noprint"><input type="checkbox" checked={onlyWork} onChange={(e) => setOnlyWork(e.target.checked)} /><span>Nur Zimmer zeigen, in denen etwas zu tun ist</span></label>
          {rows.length === 0 ? <p className="card printable">Heute ist kein Zimmer zu reinigen.</p> : (
            <div className="tablewrap card flush printable"><table>
              <thead><tr><th>Zimmer</th><th>Heute</th><th>Zu tun</th><th>Gast</th><th>Danach</th><th>Status</th><th className="noprint" /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.roomId}>
                  <td className="strong">{r.room}{r.floor && <><br /><small className="muted">Etage {r.floor}</small></>}</td>
                  <td>{[r.departing && 'Abreise', r.staying && 'bleibt', r.arriving && 'Anreise'].filter(Boolean).join(' + ') || 'frei'}</td>
                  <td>{work(r)}</td>
                  <td>{r.guest ? `${r.guest} (${r.persons})` : '–'}</td>
                  <td>{r.nextGuest ? `${r.nextGuest} (${r.nextPersons})` : '–'}</td>
                  <td>{r.housekeeping === 'clean' ? <Badge tone="ok">sauber</Badge> : <Badge tone="warn">zu reinigen</Badge>}</td>
                  <td className="noprint">{r.housekeeping === 'dirty' ? <Button variant="primary" onClick={() => void set(r, 'clean')}>Fertig</Button> : <Button onClick={() => void set(r, 'dirty')}>Zu reinigen</Button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small noprint">In Klammern steht die Personenzahl. „Zu tun“ ergibt sich aus der Belegung: Abreise = Endreinigung, Bleiber = Zwischenreinigung. Der Status „sauber / zu reinigen“ ist derselbe wie im Belegungsplan; beim Check-out setzt das Programm ihn von selbst auf „zu reinigen“.</p>
        </>
      )}
    </>
  );
}
