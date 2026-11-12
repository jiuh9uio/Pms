import { useEffect, useRef, useState } from 'react';
import { STATUS_LABEL, addDays, diffDays, todayBerlin, weekdayOf, type CalendarDto, type CalendarEntry } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { StatusBadge, WD, deDate, deShort } from '../hotel/common.tsx';
import { Button, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';

type View = 'day' | 'week' | 'month';
const DAYS: Record<View, number> = { day: 2, week: 14, month: 31 };
const LABEL_W = 120;
const ROW_H = 44;
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

interface Drag { entry: CalendarEntry; mode: 'move' | 'start' | 'end'; x: number; y: number; dDays: number; dRows: number; moved: boolean }

export function Plan() {
  const { rev, bump, openBooking, newBooking, openBlock } = useData();
  const toast = useToast();
  const today = todayBerlin();
  const [view, setView] = useState<View>(() => (window.innerWidth < 760 ? 'day' : 'week'));
  const [from, setFrom] = useState(() => (window.innerWidth < 760 ? today : addDays(today, -1)));
  // Tagesansicht lädt den Vortag mit, damit heutige Abreisen sichtbar sind
  const start = view === 'day' ? addDays(from, -1) : from;
  const { data, error, reload } = useLoad(() => api<CalendarDto>('GET', `/calendar?from=${start}&days=${DAYS[view]}`), [start, view, rev]);
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  // Daten regelmäßig auffrischen, damit Buchungen anderer Arbeitsplätze erscheinen
  useEffect(() => {
    const t = setInterval(() => { if (!dragRef.current) reload(); }, 60_000);
    return () => clearInterval(t);
  }, [reload]);

  const shift = (n: number) => setFrom(addDays(from, n));
  const tools = (
    <>
      <div className="segmented" role="radiogroup" aria-label="Ansicht">
        {(['day', 'week', 'month'] as View[]).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'on' : ''}
            onClick={() => { setView(v); setFrom(v === 'day' ? today : addDays(today, -1)); }}>{{ day: 'Tag', week: 'Woche', month: 'Monat' }[v]}</button>
        ))}
      </div>
      <div className="stepper">
        <Button onClick={() => shift(view === 'day' ? -1 : -7)} aria-label="Zurück">‹</Button>
        <Button onClick={() => setFrom(view === 'day' ? today : addDays(today, -1))}>Heute</Button>
        <Button onClick={() => shift(view === 'day' ? 1 : 7)} aria-label="Weiter">›</Button>
      </div>
      <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Datum" className="dateinput" />
      <Button onClick={() => openBlock({ from })}>Zimmer sperren</Button>
      <Button variant="primary" onClick={() => newBooking({ from: from < today ? today : from })}>Neue Reservierung</Button>
    </>
  );

  if (!data) return <><PageHeader title="Belegungsplan" actions={tools} /><LoadState error={error} loading /></>;
  if (data.rooms.length === 0)
    return <><PageHeader title="Belegungsplan" /><p className="notice">Es sind noch keine Zimmer angelegt. Ein Administrator kann sie unter „Zimmer &amp; Preise“ einrichten.</p></>;

  if (view === 'day') return <><PageHeader title="Belegungsplan" sub={longDate(from)} actions={tools} /><DayView data={data} day={from} /></>;

  const days = Array.from({ length: data.days }, (_, i) => addDays(data.from, i));
  const cols = `${LABEL_W}px repeat(${data.days * 2}, minmax(${view === 'month' ? 14 : 24}px, 1fr))`;
  const cellW = () => ((grid.current?.getBoundingClientRect().width ?? 0) - LABEL_W) / data.days;

  const draggable = (e: CalendarEntry) => e.kind === 'block' || e.status === 'tentative' || e.status === 'confirmed' || e.status === 'checked_in';
  const onDown = (ev: React.PointerEvent, entry: CalendarEntry, mode: Drag['mode']) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    setDrag({ entry, mode, x: ev.clientX, y: ev.clientY, dDays: 0, dRows: 0, moved: false });
  };
  const onMove = (ev: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || !draggable(d.entry)) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    const fixedStart = d.entry.status === 'checked_in';
    const dDays = fixedStart && d.mode !== 'end' ? 0 : Math.round(dx / cellW());
    const dRows = d.mode === 'move' ? Math.round(dy / ROW_H) : 0;
    setDrag({ ...d, dDays, dRows, moved: d.moved || Math.abs(dx) > 5 || Math.abs(dy) > 5 });
  };
  const preview = (d: Drag) => {
    const idx = data.rooms.findIndex((r) => r.id === d.entry.roomId);
    const room = data.rooms[Math.min(data.rooms.length - 1, Math.max(0, idx + d.dRows))]!;
    let { from: f, to: t } = d.entry;
    if (d.mode === 'move') { f = addDays(f, d.dDays); t = addDays(t, d.dDays); }
    if (d.mode === 'start') f = addDays(f, Math.min(d.dDays, diffDays(f, t) - 1));
    if (d.mode === 'end') t = addDays(t, Math.max(d.dDays, 1 - diffDays(f, t)));
    return { roomId: room.id, from: f, to: t };
  };
  const onUp = async () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) return;
    const e = d.entry;
    if (!d.moved) return e.kind === 'block' ? openBlock({ entry: e }) : openBooking(e.bookingId!);
    const p = preview(d);
    if (p.roomId === e.roomId && p.from === e.from && p.to === e.to) return;
    try {
      if (e.kind === 'block') await api('PUT', `/blocks/${e.blockId}`, { ...p, reason: e.reason ?? '', version: e.version });
      else await api('PATCH', `/booking-rooms/${e.bookingRoomId}`, { ...p, version: e.version });
      const room = data.rooms.find((r) => r.id === p.roomId)!;
      toast(`${e.kind === 'block' ? 'Sperre' : e.guestName}: Zimmer ${room.number}, ${deShort(p.from)} – ${deShort(p.to)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Fehler', 'error');
    }
    bump();
  };

  const col = (date: string, half: 0 | 1) => {
    const i = diffDays(data.from, date);
    return i < 0 ? 2 : i >= data.days ? 2 + data.days * 2 : 2 + i * 2 + half;
  };
  const dayCls = (d: string) => `${[0, 6].includes(weekdayOf(d)) ? ' we' : ''}${d === today ? ' today' : ''}`;
  const occupancy = (d: string) => {
    const n = new Set(data.entries.filter((e) => e.kind === 'stay' && e.from <= d && e.to > d).map((e) => e.roomId)).size;
    return Math.round((n / data.rooms.length) * 100);
  };

  return (
    <>
      <PageHeader title="Belegungsplan" sub={`${deDate(data.from)} – ${deDate(addDays(data.from, data.days - 1))}`} actions={tools} />
      <div className="planwrap">
        <div className={`plan ${view}${drag?.moved ? ' dragging' : ''}`} ref={grid} style={{ minWidth: LABEL_W + data.days * (view === 'month' ? 30 : 52) }}>
          <div className="prow phead" style={{ gridTemplateColumns: cols }}>
            <div className="plabel">Zimmer</div>
            {days.map((d, i) => (
              <div key={d} className={`pday${dayCls(d)}`} style={{ gridColumn: `${2 + i * 2} / span 2` }}>
                <span>{WD[weekdayOf(d)]}</span><b>{d.slice(8)}</b>{(i === 0 || d.slice(8) === '01') && <small>{MONTHS[Number(d.slice(5, 7)) - 1]}</small>}
              </div>
            ))}
          </div>
          {data.rooms.map((room) => (
            <div key={room.id} className="prow" style={{ gridTemplateColumns: cols, height: ROW_H }}>
              <div className="plabel"><b>{room.number}</b><small>{room.categoryName}</small></div>
              {days.map((d, i) => (
                <button key={d} type="button" className={`pcell${dayCls(d)}`} style={{ gridColumn: `${2 + i * 2} / span 2` }}
                  aria-label={`Zimmer ${room.number}, ${deDate(d)}: neue Reservierung`} onClick={() => newBooking({ roomId: room.id, from: d })} />
              ))}
              {data.entries.map((e) => {
                const dragging = drag?.entry.allocationId === e.allocationId && drag.moved;
                const p = dragging ? preview(drag!) : e;
                if (p.roomId !== room.id) return null;
                const cls = e.kind === 'block' ? 'blocked' : `st-${e.status}`;
                const label = e.kind === 'block' ? `Gesperrt${e.reason ? ': ' + e.reason : ''}` : e.guestName;
                return (
                  <div key={e.allocationId} className={`pbar ${cls}${dragging ? ' ghost' : ''}${draggable(e) ? ' drag' : ''}`}
                    style={{ gridColumn: `${col(p.from, 1)} / ${col(p.to, 1)}` }}
                    title={`${label} · ${deDate(p.from)} – ${deDate(p.to)}${e.status ? ' · ' + STATUS_LABEL[e.status] : ''}`}
                    onPointerDown={(ev) => onDown(ev, e, 'move')} onPointerMove={onMove} onPointerUp={() => void onUp()} onPointerCancel={() => setDrag(null)}
                    role="button" tabIndex={0} onKeyDown={(k) => { if (k.key === 'Enter') e.kind === 'block' ? openBlock({ entry: e }) : openBooking(e.bookingId!); }}>
                    {draggable(e) && e.status !== 'checked_in' && diffDays(data.from, e.from) >= 0 && <i className="grip l" onPointerDown={(ev) => onDown(ev, e, 'start')} />}
                    <span>{label}</span>
                    {draggable(e) && diffDays(e.to, addDays(data.from, data.days)) >= 0 && <i className="grip r" onPointerDown={(ev) => onDown(ev, e, 'end')} />}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="prow pfoot" style={{ gridTemplateColumns: cols }}>
            <div className="plabel">Auslastung</div>
            {days.map((d, i) => <div key={d} className="pday" style={{ gridColumn: `${2 + i * 2} / span 2` }}>{occupancy(d)}%</div>)}
          </div>
        </div>
      </div>
      <div className="legend">
        {(['confirmed', 'tentative', 'checked_in', 'checked_out'] as const).map((s) => <StatusBadge key={s} status={s} />)}
        <span className="status blocked">Gesperrt</span>
        <span className="muted">Balken ziehen = verschieben · Rand ziehen = verlängern/verkürzen · freies Feld anklicken = neue Reservierung</span>
      </div>
    </>
  );
}

const longDate = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Tagesansicht: je Zimmer, was heute ansteht – gut für das Smartphone. */
function DayView({ data, day }: { data: CalendarDto; day: string }) {
  const { openBooking, newBooking, openBlock } = useData();
  return (
    <div className="tablewrap card flush">
      <table>
        <thead><tr><th>Zimmer</th><th>Belegung</th><th className="hide-sm">Zeitraum</th><th></th></tr></thead>
        <tbody>
          {data.rooms.map((room) => {
            const list = data.entries.filter((e) => e.roomId === room.id && e.from <= day && e.to >= day);
            const night = list.find((e) => e.to > day);
            const leaving = list.find((e) => e.to === day && e.kind === 'stay');
            return (
              <tr key={room.id}>
                <td><b>{room.number}</b><br /><small>{room.categoryName}</small></td>
                <td>
                  {leaving && <div className="rowlink" onClick={() => openBooking(leaving.bookingId!)}><span className="muted">Abreise:</span> {leaving.guestName} <StatusBadge status={leaving.status!} /></div>}
                  {night?.kind === 'block' && <div className="rowlink" onClick={() => openBlock({ entry: night })}><span className="status blocked">Gesperrt</span> {night.reason}</div>}
                  {night?.kind === 'stay' && <div className="rowlink" onClick={() => openBooking(night.bookingId!)}>{night.from === day && <span className="muted">Anreise: </span>}<b>{night.guestName}</b> <StatusBadge status={night.status!} /></div>}
                  {!night && !leaving && <span className="muted">frei</span>}
                </td>
                <td className="muted hide-sm nowrap">{night ? `${deShort(night.from)} – ${deShort(night.to)}` : ''}</td>
                <td className="num">{!night && <Button onClick={() => newBooking({ roomId: room.id, from: day })}>Buchen</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
