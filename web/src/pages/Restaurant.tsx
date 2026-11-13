import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, isIsoDate, todayBerlin } from '../../../src/shared/hotel.js';
import {
  TABLE_STATUS_LABEL, endTime, holdsTable, overlaps, restaurantTableInput, tableReservationInput,
  type RestaurantTableDto, type TableReservationDto, type TableStatus,
} from '../../../src/shared/restaurant.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';
import { MasterDialog } from './RoomsPrices.tsx';

const TONE: Record<TableStatus, 'accent' | 'ok' | 'neutral' | 'danger' | 'warn'> = { booked: 'accent', seated: 'ok', done: 'neutral', cancelled: 'danger', no_show: 'warn' };
const WEEKDAY = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const weekday = (d: string) => WEEKDAY[new Date(`${d}T12:00:00Z`).getUTCDay()];

/** Bereich „Restaurant“: Tischreservierungen je Tag, Tische einrichten (Administrator). */
export function Restaurant() {
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const today = todayBerlin();
  const [params] = useSearchParams();
  const wanted = params.get('datum');
  const [date, setDate] = useState(wanted && isIsoDate(wanted) ? wanted : today);
  // Sprung aus der Suche auf einen bestimmten Tag
  useEffect(() => { if (wanted && isIsoDate(wanted)) setDate(wanted); }, [wanted]);
  const [dlg, setDlg] = useState<ReactNode>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { data, error } = useLoad(async () => {
    const [tables, list] = await Promise.all([api<RestaurantTableDto[]>('GET', '/restaurant/tables'), api<TableReservationDto[]>('GET', `/restaurant/reservations?date=${date}`)]);
    return { tables, list };
  }, [date, rev]);
  const printer = useLoad(() => api<{ ready: boolean }>('GET', '/restaurant/printer')).data;
  const [sending, setSending] = useState(false);
  const sendKitchen = async () => {
    setSending(true);
    try { await api('POST', '/restaurant/reservations/print', { date }); toast('Reservierungen an die Küche gesendet'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setSending(false);
  };
  const close = () => setDlg(null);

  const setStatus = async (r: TableReservationDto, status: TableStatus, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    setBusy(r.id);
    try { await api('POST', `/restaurant/reservations/${r.id}/status`, { status, version: r.version }); toast(`${r.name}: ${TABLE_STATUS_LABEL[status]}`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const editTable = (t?: RestaurantTableDto) => setDlg(<MasterDialog title={t ? `${t.name} bearbeiten` : 'Tisch anlegen'} path="/restaurant/tables" id={t?.id ?? null} version={t?.version} schema={restaurantTableInput} onClose={close}
    fields={[
      { key: 'name', label: 'Bezeichnung', type: 'text', hint: 'z. B. Tisch 4, Stammtisch, Terrasse 2' }, { key: 'seats', label: 'Plätze', type: 'int' },
      { key: 'area', label: 'Raum / Bereich', type: 'text', hint: 'z. B. Gaststube, Saal, Terrasse' }, { key: 'sort', label: 'Reihenfolge', type: 'int', hint: 'kleine Zahl zuerst' },
      ...(t ? [{ key: 'active', label: 'In Benutzung', type: 'check' as const, hint: ' Nicht mehr benutzte Tische lassen sich nicht reservieren.' }] : []),
    ]}
    initial={{ name: t?.name ?? '', seats: String(t?.seats ?? 4), area: t?.area ?? '', sort: String(t?.sort ?? (data?.tables.length ?? 0) + 1), active: t?.active ?? true }} />);

  const active = data?.list.filter((r) => holdsTable(r.status)) ?? [];
  return (
    <>
      <PageHeader title="Tischreservierungen" sub={`${weekday(date)}, ${deDate(date)}${date === today ? ' · heute' : ''}`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))} aria-label="Vorheriger Tag">‹</Button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Datum" />
          <Button onClick={() => setDate(addDays(date, 1))} aria-label="Nächster Tag">›</Button>
          {date !== today && <Button onClick={() => setDate(today)}>Heute</Button>}
          <Button onClick={() => window.print()}>Drucken</Button>
          {printer?.ready && <Button busy={sending} onClick={() => void sendKitchen()}>An Küche senden</Button>}
          <Button variant="primary" onClick={() => data && setDlg(<ReservationDialog date={date} tables={data.tables} list={data.list} res={null} onClose={close} />)}>Neue Reservierung</Button>
        </>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Tischreservierungen {weekday(date)}, {deDate(date)}</h2>
          {data.tables.length === 0 && <p className="notice warn">Es sind noch keine Tische angelegt. Reservierungen sind trotzdem möglich – nur ohne Tischzuweisung. {isAdmin ? 'Tische lassen sich unten anlegen.' : 'Tische legt der Administrator an.'}</p>}
          <p className="muted">{active.length} {active.length === 1 ? 'Reservierung' : 'Reservierungen'} · {active.reduce((s, r) => s + r.persons, 0)} Personen{active.some((r) => !r.tableId) ? ` · ${active.filter((r) => !r.tableId).length} ohne Tisch` : ''}</p>
          {data.list.length === 0 ? <p className="card printable">Für diesen Tag ist nichts reserviert.</p> : (
            <div className="tablewrap card flush printable"><table>
              <thead><tr><th>Uhrzeit</th><th>Name</th><th className="num">Pers.</th><th>Tisch</th><th>Status</th><th className="noprint" /></tr></thead>
              <tbody>{data.list.map((r) => (
                <tr key={r.id} className={holdsTable(r.status) || r.status === 'done' ? undefined : 'faded'}>
                  <td className="strong nowrap">{r.time}<small className="muted"> – {endTime(r.time, r.durationMin)}</small></td>
                  <td>{r.name}{r.phone && <><br /><small>{r.phone}</small></>}{r.note && <><br /><small className="muted">{r.note}</small></>}</td>
                  <td className="num">{r.persons}</td>
                  <td>{r.tableName ?? <span className="muted">offen</span>}</td>
                  <td><Badge tone={TONE[r.status]}>{TABLE_STATUS_LABEL[r.status]}</Badge></td>
                  <td className="noprint rowactions">
                    {r.status === 'booked' && <Button variant="primary" busy={busy === r.id} onClick={() => void setStatus(r, 'seated')}>Gäste da</Button>}
                    {r.status === 'seated' && <Button busy={busy === r.id} onClick={() => void setStatus(r, 'done')}>Tisch frei</Button>}
                    {holdsTable(r.status) && <Button onClick={() => setDlg(<ReservationDialog date={date} tables={data.tables} list={data.list} res={r} onClose={close} />)}>Ändern</Button>}
                    {r.status === 'booked' && <Button busy={busy === r.id} onClick={() => void setStatus(r, 'no_show', `${r.name} als nicht erschienen markieren?`)}>Nicht erschienen</Button>}
                    {r.status === 'booked' && <Button variant="danger" busy={busy === r.id} onClick={() => void setStatus(r, 'cancelled', `Reservierung von ${r.name} stornieren?`)}>Stornieren</Button>}
                    {!holdsTable(r.status) && <Button busy={busy === r.id} onClick={() => void setStatus(r, r.status === 'done' ? 'seated' : 'booked')}>Zurücknehmen</Button>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          {isAdmin && (
            <section className="card">
              <div className="cardhead"><h2>Tische</h2><div className="actions"><Button onClick={() => editTable()}>Anlegen</Button></div></div>
              {data.tables.length === 0 ? <p className="muted">Noch keine Tische.</p> : (
                <div className="chips">{data.tables.map((t) => (
                  <button key={t.id} type="button" className="chip" onClick={() => editTable(t)} style={t.active ? undefined : { opacity: .5 }}>{t.name} · {t.seats} Pl.{t.area ? ` · ${t.area}` : ''}{t.active ? '' : ' · außer Betrieb'}</button>
                ))}</div>
              )}
            </section>
          )}
        </>
      )}
      {dlg}
    </>
  );
}

function ReservationDialog({ date, tables, list, res, onClose }: { date: string; tables: RestaurantTableDto[]; list: TableReservationDto[]; res: TableReservationDto | null; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({
    date: res?.date ?? date, time: res?.time ?? '18:00', durationMin: String(res?.durationMin ?? 120), persons: String(res?.persons ?? 2),
    name: res?.name ?? '', phone: res?.phone ?? '', note: res?.note ?? '', tableId: res?.tableId ?? '',
  });
  // Belegung des gewählten Tages laden, falls das Datum im Dialog geändert wird
  const other = useLoad(() => (v.date === date ? Promise.resolve(list) : api<TableReservationDto[]>('GET', `/restaurant/reservations?date=${v.date}`)), [v.date]).data ?? list;
  const f = useSubmit(res ? tableReservationInput : tableReservationInput, async (d) => {
    await api(res ? 'PUT' : 'POST', res ? `/restaurant/reservations/${res.id}` : '/restaurant/reservations', res ? { ...d, version: res.version } : d);
    toast(res ? 'Reservierung geändert' : `Tisch für ${d.name} reserviert`);
    bump();
    onClose();
  });
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const slot = { time: v.time, durationMin: num(v.durationMin) || 0 };
  const persons = num(v.persons) || 0;
  const taken = (t: RestaurantTableDto) => other.some((o) => o.tableId === t.id && o.id !== res?.id && holdsTable(o.status) && overlaps(o, slot));
  const send = (e?: React.FormEvent) => void f.submit({ ...v, durationMin: num(v.durationMin), persons: num(v.persons), tableId: v.tableId || null }, e);
  const input = (k: 'name' | 'phone' | 'note' | 'time' | 'date' | 'persons' | 'durationMin', label: string, o: { type?: string; wide?: boolean; hint?: string } = {}) => (
    <Field label={label} error={f.errors[k]} wide={o.wide} hint={o.hint}><input type={o.type ?? 'text'} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} autoFocus={k === 'name' && !res} /></Field>
  );
  return (
    <Dialog title={res ? `Reservierung ${res.name}` : 'Neue Tischreservierung'} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>{res ? 'Speichern' : 'Reservieren'}</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        {input('name', 'Name', { wide: true })}
        {input('date', 'Datum', { type: 'date' })}{input('time', 'Uhrzeit', { type: 'time' })}
        {input('persons', 'Personen', { type: 'number' })}{input('durationMin', 'Dauer in Minuten', { type: 'number' })}
        <Field label="Tisch" error={f.errors.tableId} wide hint="Belegte und zu kleine Tische sind ausgegraut.">
          <select value={v.tableId} onChange={(e) => setV({ ...v, tableId: e.target.value })}>
            <option value="">noch offen</option>
            {tables.filter((t) => t.active || t.id === res?.tableId).map((t) => {
              const off = taken(t) || t.seats < persons;
              return <option key={t.id} value={t.id} disabled={off}>{t.name} · {t.seats} Plätze{t.area ? ` · ${t.area}` : ''}{taken(t) ? ' – belegt' : t.seats < persons ? ' – zu klein' : ''}</option>;
            })}
          </select>
        </Field>
        {input('phone', 'Telefon', { wide: true })}
        {input('note', 'Bemerkung', { wide: true, hint: 'z. B. Kinderstuhl, Allergie, Geburtstag' })}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
