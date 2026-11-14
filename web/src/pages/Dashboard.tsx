import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, type BookingListRow, type DashboardDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';
import { BookingTable } from './Reservations.tsx';

const TASK_TONE: Record<string, string> = { cleaning: 'warn',  overdue_arrival: 'warn', overdue_departure: 'warn', arrival: 'in', departure: 'out', tentative: 'info', option: 'warn' };

export function Dashboard() {
  const { user } = useAuth();
  const { rev, bump, openBooking, newBooking } = useData();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<DashboardDto>('GET', '/dashboard'), [rev]);
  const open = useLoad(() => api<{ count: number; cents: number; overdue: number }>('GET', '/invoices/summary'), [rev]);
  const [busy, setBusy] = useState<string | null>(null);
  // Kennzahlen aktualisieren sich von selbst
  useEffect(() => {
    const t = setInterval(reload, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const clean = async (roomId: string) => {
    setBusy(roomId);
    try { await api('POST', `/rooms/${roomId}/housekeeping`, { status: 'clean' }); toast('Zimmer als sauber gemeldet'); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const checkout = async (r: BookingListRow) => {
    setBusy(r.id);
    try {
      await api('POST', `/booking-rooms/${r.id}/status`, { status: 'checked_out', version: r.version });
      toast(`Zimmer ${r.roomNumber} ausgecheckt`);
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const kpi = (label: string, value: string | number, sub?: string) => <div className="card kpicard"><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;

  return (
    <>
      <PageHeader title={`Guten Tag, ${user.name}`} sub={today} actions={<Button variant="primary" onClick={() => newBooking()}>Neue Reservierung</Button>} />
      <LoadState error={error} loading={!data} />
      {data && data.rooms.total === 0 && <p className="notice warn">Es sind noch keine Zimmer angelegt. {user.role === 'admin' ? <Link to="/zimmer">Jetzt Kategorien, Preise und Zimmer einrichten</Link> : 'Bitte den Administrator bitten, Zimmer einzurichten.'}</p>}
      {data && (
        <>
          <div className="kpis">
            {kpi('Anreisen heute', data.arrivals.length, 'noch nicht eingecheckt')}
            {kpi('Abreisen heute', data.departures.length, 'noch nicht ausgecheckt')}
            {kpi('Belegte Zimmer', data.rooms.occupied, 'Gäste im Haus')}
            {kpi('Freie Zimmer', data.rooms.free, `von ${data.rooms.total}`)}
            {kpi('Gesperrte Zimmer', data.rooms.blocked)}
            {kpi('Auslastung heute', `${data.rooms.occupancyPercent} %`, 'gebuchte Zimmer heute Nacht')}
            {kpi('Logisumsatz heute', formatMoney(data.revenueTodayCents), 'gebuchte Übernachtungen')}
            {kpi('Logisumsatz Monat', formatMoney(data.revenueMonthCents), 'laufender Monat, gebucht')}
            <Link to="/rechnungen" className="card kpicard linkcard"><span>Offene Rechnungen</span><b>{open.data?.count ?? '–'}</b><small>{open.data ? `${formatMoney(open.data.cents)}${open.data.overdue ? ` · ${open.data.overdue} überfällig` : ''}` : ''}</small></Link>
          </div>
          <p className="muted small">Umsatz = gebuchte Übernachtungspreise (brutto, ohne Zusatzleistungen). Offene Rechnungen = ausgestellt und noch nicht vollständig bezahlt.</p>

          <section className="card">
            <h2>Aufgaben heute</h2>
            {data.tasks.length === 0 ? <p className="muted">Alles erledigt.</p> : (
              <ul className="tasks">
                {data.tasks.map((t) => (
                  <li key={t.kind + t.bookingRoomId} className={`task ${TASK_TONE[t.kind]}`}>
                    {t.kind === 'cleaning'
                      ? <button type="button" onClick={() => void clean(t.bookingRoomId)}>{t.text} – <u>als sauber melden</u></button>
                      : <button type="button" onClick={() => openBooking(t.bookingId)}>{t.text}</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.dirty.length > 0 && (
            <section className="card">
              <h2>Zu reinigen ({data.dirty.length})</h2>
              <ul className="plain">
                {data.dirty.map((d) => (
                  <li key={d.roomId}>
                    <span><b>Zimmer {d.number}</b> <small className="inl">{d.categoryName}</small><br />
                      <small>{d.arrivalToday ? `heute Anreise: ${d.arrivalToday}` : d.occupied ? 'Gast im Haus' : 'frei'}</small></span>
                    <Button variant={d.arrivalToday ? 'primary' : 'default'} busy={busy === d.roomId} onClick={() => void clean(d.roomId)}>Sauber</Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="cards two">
            <section className="card flush">
              <h2 className="pad">Anreisen heute</h2>
              {data.arrivals.length ? <BookingTable compact rows={data.arrivals} action={(r) => <Button variant="primary" onClick={() => openBooking(r.bookingId)}>Check-in</Button>} /> : <p className="muted pad">Keine offenen Anreisen.</p>}
            </section>
            <section className="card flush">
              <h2 className="pad">Abreisen heute</h2>
              {data.departures.length ? <BookingTable compact rows={data.departures} action={(r) => <Button variant="primary" busy={busy === r.id} onClick={() => void checkout(r)}>Check-out</Button>} /> : <p className="muted pad">Keine offenen Abreisen.</p>}
            </section>
          </div>
        </>
      )}
    </>
  );
}
