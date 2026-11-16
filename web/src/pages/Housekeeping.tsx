import { useState } from 'react';
import { addDays, todayBerlin } from '../../../src/shared/hotel.js';
import { MANUAL_CLEAN_LABEL, type CleanList, type CleanRow, type ManualClean } from '../../../src/shared/team.js';
import type { RoomDto } from '../../../src/shared/hotel.js';
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
  const [adding, setAdding] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printBon = async () => {
    setPrinting(true);
    try { await api('POST', '/housekeeping/print', { date }); toast('Reinigungsliste auf dem Bondrucker gedruckt'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Druck fehlgeschlagen', 'error'); }
    setPrinting(false);
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
          <Button busy={printing} onClick={() => void printBon()}>Bon drucken</Button>
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
          <ManualCleans date={date} list={data.manual} adding={adding} setAdding={setAdding} />
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
                  <td className="noprint">{date !== today ? <small className="muted">nur heute änderbar</small> : r.housekeeping === 'dirty' ? <Button variant="primary" onClick={() => void set(r, 'clean')}>Fertig</Button> : <Button onClick={() => void set(r, 'dirty')}>Zu reinigen</Button>}</td>
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

/** Kleines Extrafeld: Reinigung von Hand eintragen (Komplett- oder Zwischenreinigung), abhaken oder entfernen. */
function ManualCleans({ date, list, adding, setAdding }: { date: string; list: ManualClean[]; adding: boolean; setAdding: (v: boolean) => void }) {
  const toast = useToast();
  const { bump } = useData();
  const rooms = useLoad(() => api<RoomDto[]>('GET', '/rooms')).data?.filter((r) => r.active) ?? [];
  const [v, setV] = useState({ roomId: '', kind: 'interim' as ManualClean['kind'], note: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!v.roomId) { toast('Bitte ein Zimmer wählen', 'error'); return; }
    setBusy(true);
    try { await api('POST', '/housekeeping/manual', { date, ...v }); toast('Reinigung eingetragen'); setV({ roomId: '', kind: v.kind, note: '' }); setAdding(false); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const act = async (m: ManualClean, what: 'done' | 'undo' | 'remove') => {
    if (what === 'remove' && !window.confirm(`Eintrag für Zimmer ${m.room} entfernen?`)) return;
    try {
      if (what === 'remove') await api('POST', `/housekeeping/manual/${m.id}/remove`, {});
      else await api('POST', `/housekeeping/manual/${m.id}/done`, { done: what === 'done' });
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <div className="manualclean printable">
      {list.length > 0 && (
        <ul className="plain mc-list">
          {list.map((m) => (
            <li key={m.id} className={m.done ? 'done' : ''}>
              <span><b>Zimmer {m.room}</b> · {MANUAL_CLEAN_LABEL[m.kind]}{m.note && <> · <i>{m.note}</i></>}<br /><small className="muted">von Hand eingetragen von {m.by}{m.done ? ' · erledigt' : ''}</small></span>
              <span className="noprint btnrow">
                {m.done ? <Button onClick={() => void act(m, 'undo')}>Wieder offen</Button> : <Button variant="primary" onClick={() => void act(m, 'done')}>Fertig</Button>}
                <button type="button" className="iconbtn" aria-label="Entfernen" title="Entfernen" onClick={() => void act(m, 'remove')}>✕</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!adding ? <button type="button" className="linkbtn noprint" onClick={() => setAdding(true)}>+ Reinigung von Hand eintragen</button> : (
        <div className="mc-form noprint">
          <select value={v.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })} aria-label="Zimmer">
            <option value="">Zimmer wählen …</option>{rooms.map((r) => <option key={r.id} value={r.id}>{r.number} – {r.categoryName}</option>)}
          </select>
          <div className="segmented" role="radiogroup" aria-label="Art der Reinigung">
            {(['full', 'interim'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={v.kind === k} className={v.kind === k ? 'on' : ''} onClick={() => setV({ ...v, kind: k })}>
              {k === 'full' ? 'Komplettreinigung' : 'Zwischenreinigung (Gäste noch da)'}</button>)}
          </div>
          <input value={v.note} maxLength={200} placeholder="Notiz (optional), z. B. Handtücher wechseln" onChange={(e) => setV({ ...v, note: e.target.value })} aria-label="Notiz" />
          <Button variant="primary" busy={busy} onClick={() => void add()}>Eintragen</Button>
          <Button onClick={() => setAdding(false)}>Abbrechen</Button>
        </div>
      )}
    </div>
  );
}
