import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  INTERVALS, cleaningTaskInput, intervalLabel,
  type CleaningEntryDto, type CleaningTaskDto, type HygieneAreaDto,
} from '../../../src/shared/controls.js';
import { addDays, todayBerlin, weekdayOf } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { WD, deDate, deShort } from '../hotel/common.tsx';
import { Badge, Button, LoadState, printOnly, useLoad, useToast } from '../ui.tsx';
import { MasterDialog } from './RoomsPrices.tsx';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const time = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

/**
 * Reinigungsprotokoll: je Bereich die Reinigungsaufgaben mit Intervall. Abgehakt wird nur für heute,
 * mit Namen und Uhrzeit. Das Monatsprotokoll zeigt, wann was erledigt wurde.
 */
export function Cleaning() {
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const today = todayBerlin();
  const [params] = useSearchParams();
  const [areaId, setAreaId] = useState<string | null>(params.get('bereich'));
  const [mode, setMode] = useState<'today' | 'month'>('today');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState<ReactNode>(null);

  const monthStart = `${month}-01`;
  const monthEnd = addDays(addDays(monthStart, 31).slice(0, 8) + '01', -1);
  const data = useLoad(async () => {
    const [areas, tasks, log] = await Promise.all([
      api<HygieneAreaDto[]>('GET', '/hygiene/areas'), api<CleaningTaskDto[]>('GET', '/cleaning/tasks'),
      api<CleaningEntryDto[]>('GET', `/cleaning/log?from=${monthStart}&to=${monthEnd}`),
    ]);
    return { areas, tasks, log };
  }, [rev, monthStart]);

  if (!data.data) return <section className="card"><h2>Reinigungsprotokoll</h2><LoadState error={data.error} loading /></section>;
  const { areas, tasks, log } = data.data;
  const visible = areas.filter((a) => a.active || isAdmin);
  const area = visible.find((a) => a.id === areaId) ?? visible[0];
  const list = tasks.filter((t) => t.areaId === area?.id && (t.active || isAdmin));
  const dueCount = list.filter((t) => t.active && t.due && !t.doneToday).length;

  const act = async (key: string, fn: () => Promise<unknown>, msg: string) => {
    setBusy(key);
    try { await fn(); toast(msg); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const edit = (t?: CleaningTaskDto) => setDlg(<MasterDialog title={t ? 'Reinigungsaufgabe bearbeiten' : 'Reinigungsaufgabe anlegen'} path="/cleaning/tasks" id={t?.id ?? null} version={t?.version} schema={cleaningTaskInput} onClose={() => setDlg(null)}
    fields={[
      { key: 'name', label: 'Was ist zu reinigen?', type: 'text', wide: true, hint: 'z. B. Arbeitsflächen desinfizieren, Fritteuse Öl wechseln, Kühltruhe abtauen' },
      { key: 'areaId', label: 'Bereich', type: 'select', options: areas.map((a): [string, string] => [a.id, a.name]) },
      { key: 'intervalDays', label: 'Wie oft?', type: 'selectInt', options: INTERVALS.map(([d, l]): [string, string] => [String(d), l]) },
      ...(t ? [{ key: 'active', label: 'Aktiv', type: 'check' as const, hint: 'Inaktive Aufgaben werden nicht mehr fällig; bisherige Einträge bleiben erhalten.' }] : []),
    ]}
    initial={{ name: t?.name ?? '', areaId: t?.areaId ?? area?.id ?? '', intervalDays: String(t?.intervalDays ?? 1), active: t?.active ?? true }} />);

  return (
    <section className="card hygiene cleaning">
      <div className="cardhead">
        <div><h2>Reinigungsprotokoll</h2><p className="muted">Reinigungsaufgaben je Bereich mit Intervall</p></div>
        <div className="actions noprint">
          <div className="segmented" role="radiogroup" aria-label="Ansicht">
            <button type="button" role="radio" aria-checked={mode === 'today'} className={mode === 'today' ? 'on' : ''} onClick={() => setMode('today')}>Heute</button>
            <button type="button" role="radio" aria-checked={mode === 'month'} className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Monatsprotokoll</button>
          </div>
          {isAdmin && <Button onClick={() => edit()}>Aufgabe anlegen</Button>}
        </div>
      </div>
      <div className="tabs noprint" role="tablist" aria-label="Bereiche">
        {visible.map((a) => {
          const n = tasks.filter((t) => t.areaId === a.id && t.active && t.due && !t.doneToday).length;
          return <button key={a.id} type="button" role="tab" aria-selected={a.id === area?.id} className={`${a.id === area?.id ? 'on' : ''}${a.active ? '' : ' off'}`} onClick={() => setAreaId(a.id)}>{a.name}{n > 0 && <span className="count">{n}</span>}</button>;
        })}
      </div>
      {area && list.length === 0 && <p className="notice">In diesem Bereich gibt es noch keine Reinigungsaufgaben. {isAdmin ? 'Über „Aufgabe anlegen“ z. B. „Arbeitsflächen desinfizieren – täglich“ eintragen.' : 'Der Administrator kann sie anlegen.'}</p>}

      {area && list.length > 0 && mode === 'today' && (
        <>
          {dueCount > 1 && <p className="noprint"><Button variant="primary" busy={busy === 'all'} onClick={() => void act('all', () => api('POST', `/cleaning/areas/${area.id}/done`), `${area.name}: ${dueCount} Aufgaben erledigt`)}>Alle fälligen erledigt ({dueCount})</Button></p>}
          <ul className="checklist">
            {list.map((t) => {
              const done = t.doneToday;
              const entry = log.find((l) => l.taskId === t.id && l.date === today);
              return (
                <li key={t.id} className={`${done ? 'done' : ''}${t.active ? '' : ' off'}`}>
                  <label className="check">
                    <input type="checkbox" checked={done} disabled={busy === t.id || (!done && !t.active)}
                      onChange={() => void (done
                        ? act(t.id, () => api('POST', `/cleaning/tasks/${t.id}/undo`), `„${t.name}“ zurückgenommen`)
                        : act(t.id, () => api('POST', `/cleaning/tasks/${t.id}/done`), `„${t.name}“ erledigt`))} />
                    <span>{isAdmin ? <button type="button" className="linkbtn strong" onClick={() => edit(t)}>{t.name}</button> : <b>{t.name}</b>}<br />
                      <small>{intervalLabel(t.intervalDays)}{t.lastDate && !done && ` · zuletzt ${deDate(t.lastDate)} (${t.lastBy})`}</small></span>
                  </label>
                  <span className="right">
                    {done ? <Badge tone="ok">erledigt {entry ? `${time(entry.doneAt)} · ${entry.userName}` : ''}</Badge>
                      : !t.active ? <Badge>inaktiv</Badge>
                        : t.due ? <Badge tone="warn">{t.dueDate < today ? `überfällig seit ${deDate(t.dueDate)}` : 'heute fällig'}</Badge>
                          : <span className="muted small">wieder fällig am {deDate(t.dueDate)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">Abhaken geht nur für heute und wird mit Namen und Uhrzeit gespeichert. Versehentliches Abhaken lässt sich am selben Tag zurücknehmen; das steht im Änderungsprotokoll.</p>
        </>
      )}

      {area && list.length > 0 && mode === 'month' && (
        <>
          <div className="areahead">
            <h3>{area.name} · Reinigung {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</h3>
            <div className="actions noprint"><input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" /><Button onClick={() => printOnly('cleaning')}>Drucken</Button></div>
          </div>
          <div className="tablewrap">
            <table className="temps month">
              <thead><tr><th>Tag</th>{list.map((t) => <th key={t.id} className="num">{t.name}<br /><small>{intervalLabel(t.intervalDays)}</small></th>)}</tr></thead>
              <tbody>
                {Array.from({ length: Number(monthEnd.slice(8)) }, (_, i) => addDays(monthStart, i)).filter((d) => d <= today).map((d) => (
                  <tr key={d}>
                    <td className="nowrap">{WD[weekdayOf(d)]} {deShort(d)}</td>
                    {list.map((t) => {
                      const e = log.find((l) => l.taskId === t.id && l.date === d);
                      return <td key={t.id} className="num">{e ? <span className="temp ok" title={`${e.userName}, ${time(e.doneAt)} Uhr`}>✓ <small>{e.userName}</small></span> : <span className="muted">–</span>}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {dlg}
    </section>
  );
}
