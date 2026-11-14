import { useState } from 'react';
import { addDays, todayBerlin, type BreakfastDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** Frühstücksliste: wer frühstückt am Morgen des gewählten Tages – zum Ansehen, Drucken und Senden an den Küchendrucker. */
export function Breakfast() {
  const { user } = useAuth();
  const { rev, openBooking } = useData();
  const toast = useToast();
  const today = todayBerlin();
  // nachmittags interessiert meist schon das Frühstück von morgen
  const [date, setDate] = useState(() => (new Date().toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }) >= '12' ? addDays(today, 1) : today));
  const { data, error } = useLoad(() => api<BreakfastDto>('GET', `/breakfast?date=${date}`), [date, rev]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await api('POST', '/breakfast/print', { date }); toast('Frühstücksliste an die Küche gesendet'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const persons = data ? data.total.adults + data.total.children : 0;
  return (
    <>
      <PageHeader title="Frühstück" sub={`${weekday(date)}, ${deDate(date)}${date === today ? ' · heute' : date === addDays(today, 1) ? ' · morgen' : ''}`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">‹</Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" />
          <Button onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag">›</Button>
          <Button onClick={() => window.print()}>Drucken</Button>
          <Button variant="primary" busy={busy} disabled={!data?.printerReady} onClick={() => void send()}>An Küche senden</Button>
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Frühstück {weekday(date)}, {deDate(date)}</h2>
          {!data.printerReady && <p className="notice noprint">Der Küchendrucker ist noch nicht eingerichtet. {user.role === 'admin' ? 'Das geht unter Verwaltung → Einstellungen → Küchendrucker.' : 'Das richtet der Administrator ein.'} Die Liste lässt sich solange über „Drucken“ auf einem normalen Drucker ausgeben.</p>}
          {data.autoTime && <p className="muted noprint">Die Liste des Tages wird täglich um {data.autoTime} Uhr von selbst in der Küche gedruckt{data.autoLast ? ` (zuletzt für den ${deDate(data.autoLast)})` : ''}.</p>}
          {data.variant && <p className="notice warn printable"><b>{data.variant.text}</b> <span className="muted small noprint">· Regel „{data.variant.name}“</span></p>}
          <div className="kpis">
            <div className="card kpicard printable"><span>Frühstücksgäste</span><b>{persons}</b><small>{data.total.adults} Erwachsene{data.total.children ? `, ${data.total.children} ${data.total.children === 1 ? 'Kind' : 'Kinder'}` : ''}</small></div>
            <div className="card kpicard printable"><span>Zimmer mit Frühstück</span><b>{data.total.rooms}</b><small>{data.total.without ? `${data.total.without} belegt ohne Frühstück` : 'alle belegten Zimmer'}</small></div>
          </div>
          {data.rooms.length === 0 ? <p className="card printable">In der Nacht davor ist kein Zimmer belegt.</p> : (
            <div className="tablewrap card flush printable"><table>
              <thead><tr><th>Zimmer</th><th>Gast</th><th className="num">Erw.</th><th className="num">Kinder</th><th>Frühstück</th><th>Hinweis</th></tr></thead>
              <tbody>{data.rooms.map((r) => (
                <tr key={r.room} className={r.breakfast ? undefined : 'faded'}>
                  <td className="strong">{r.room}</td>
                  <td><button type="button" className="linkbtn" onClick={() => openBooking(r.bookingId)}>{r.guest}</button></td>
                  <td className="num">{r.adults}</td><td className="num">{r.children || '–'}</td>
                  <td>{r.breakfast ? <Badge tone="ok">gebucht</Badge> : <Badge>ohne</Badge>}</td>
                  <td>{[r.departing && 'reist ab', !r.arrived && 'noch nicht angereist', r.notes].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small noprint">Gezeigt werden die Zimmer, die in der Nacht auf den {deDate(date)} belegt sind. „Gebucht“ heißt: an der Reservierung hängt eine Leistung mit dem Kennzeichen „Frühstück“ (Zimmer &amp; Preise → Leistungen). Frühstück lässt sich in der Reservierung unter „Frühstück und Zusatzleistungen“ nachbuchen.</p>
        </>
      )}
    </>
  );
}
