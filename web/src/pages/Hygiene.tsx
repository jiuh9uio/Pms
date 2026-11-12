import { useEffect, useState, type ReactNode } from 'react';
import {
  hygieneAreaInput, hygienePointInput, hygieneReadingsInput, outOfRange, rangeLabel,
  type HygieneAreaDto, type HygienePointDto, type HygieneReadingDto,
} from '../../../src/shared/controls.js';
import { addDays, todayBerlin, weekdayOf } from '../../../src/shared/hotel.js';
import { ApiFailure, api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { WD, deDate, deShort } from '../hotel/common.tsx';
import { Button, LoadState, useLoad, useToast } from '../ui.tsx';
import { MasterDialog } from './RoomsPrices.tsx';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const num = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const parseTemp = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.').replace('−', '-')));
/** Wurde der Wert erst an einem späteren Tag eingetragen? */
const late = (r: HygieneReadingDto) => new Date(r.enteredAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) > r.date;

/**
 * Temperatur-Eigenkontrolle: oben die Bereiche (Küche, Lager …), darunter je Bereich eine Tabelle mit den Messstellen.
 * Werte werden von Hand eingetragen – das Protokoll belegt, dass tatsächlich gemessen wurde.
 */
export function Hygiene() {
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const today = todayBerlin();
  const [areaId, setAreaId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<'entry' | 'month'>('entry');
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dlg, setDlg] = useState<ReactNode>(null);
  const [draft, setDraft] = useState<Record<string, { value: string; note: string }>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const areas = useLoad(() => api<HygieneAreaDto[]>('GET', '/hygiene/areas'), [rev]);
  const visible = (areas.data ?? []).filter((a) => a.active || isAdmin);
  const area = visible.find((a) => a.id === areaId) ?? visible[0];
  const points = (area?.points ?? []).filter((p) => p.active || isAdmin);

  const days = Array.from({ length: 7 }, (_, i) => addDays(date, i - 6));
  const monthStart = `${month}-01`;
  const monthEnd = addDays(addDays(monthStart, 31).slice(0, 8) + '01', -1);
  const range = mode === 'entry' ? [days[0]!, date] : [monthStart, monthEnd];
  const readings = useLoad(() => api<HygieneReadingDto[]>('GET', `/hygiene/readings?from=${range[0]}&to=${range[1]}`), [range[0], range[1], rev]);
  const at = (pointId: string, d: string) => readings.data?.find((r) => r.pointId === pointId && r.date === d);

  // Eingabefelder mit den bereits gespeicherten Werten des gewählten Tages vorbelegen
  useEffect(() => {
    if (!readings.data) return;
    const next: typeof draft = {};
    for (const r of readings.data) if (r.date === date) next[r.pointId] = { value: String(r.valueC).replace('.', ','), note: r.note };
    setDraft(next);
    setErrors([]);
  }, [readings.data, date]);

  const close = () => setDlg(null);
  const editArea = (a?: HygieneAreaDto) => setDlg(<MasterDialog title={a ? 'Bereich bearbeiten' : 'Bereich anlegen'} path="/hygiene/areas" id={a?.id ?? null} version={a?.version} schema={hygieneAreaInput} onClose={close}
    fields={[{ key: 'name', label: 'Name', type: 'text', wide: true, hint: 'z. B. Küche, Lager, Theke' }, ...(a ? [{ key: 'active', label: 'Anzeigen', type: 'check' as const }] : [])]}
    initial={{ name: a?.name ?? '', active: a?.active ?? true }} />);
  const editPoint = (p?: HygienePointDto) => setDlg(<MasterDialog title={p ? 'Messstelle bearbeiten' : 'Messstelle anlegen'} path="/hygiene/points" id={p?.id ?? null} version={p?.version} schema={hygienePointInput} onClose={close}
    fields={[
      { key: 'name', label: 'Name', type: 'text', hint: 'z. B. Kühltruhe, Kühlschrank 1, Kühlhaus' },
      { key: 'areaId', label: 'Bereich', type: 'select', options: (areas.data ?? []).map((a): [string, string] => [a.id, a.name]) },
      { key: 'minC', label: 'Mindestens °C', type: 'numberOpt', hint: 'leer = keine Untergrenze' }, { key: 'maxC', label: 'Höchstens °C', type: 'numberOpt', hint: 'z. B. −18 für Tiefkühlung, 7 für Kühlung' },
      ...(p ? [{ key: 'active', label: 'Anzeigen', type: 'check' as const, hint: 'Ausgeblendete Messstellen behalten ihre bisherigen Werte.' }] : []),
    ]}
    initial={{ name: p?.name ?? '', areaId: p?.areaId ?? area?.id ?? '', minC: p?.minC == null ? '' : String(p.minC).replace('.', ','), maxC: p?.maxC == null ? '' : String(p.maxC).replace('.', ','), active: p?.active ?? true }} />);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const entries = points.filter((p) => draft[p.id]?.value.trim()).map((p) => ({ pointId: p.id, date, valueC: parseTemp(draft[p.id]!.value), note: draft[p.id]!.note.trim() }));
    const parsed = hygieneReadingsInput.safeParse({ entries });
    if (!parsed.success) { setErrors([...new Set(parsed.error.issues.map((i) => i.message))]); return; }
    setBusy(true);
    try {
      await api('PUT', '/hygiene/readings', parsed.data);
      toast(`${entries.length} ${entries.length === 1 ? 'Wert' : 'Werte'} für ${deDate(date)} gespeichert`);
      bump();
    } catch (err) {
      setErrors(err instanceof ApiFailure && Object.keys(err.fields).length ? Object.values(err.fields) : [err instanceof Error ? err.message : 'Fehler']);
    }
    setBusy(false);
  };
  const setCell = (id: string, patch: Partial<{ value: string; note: string }>) => setDraft((d) => ({ ...d, [id]: { value: '', note: '', ...d[id], ...patch } }));
  const cell = (r: HygieneReadingDto | undefined, p: HygienePointDto) => {
    if (!r) return <span className="muted">–</span>;
    const bad = outOfRange(r.valueC, p);
    const title = [`${num(r.valueC)} °C`, r.note, `eingetragen von ${r.userName}`, late(r) ? `nachgetragen am ${deDate(new Date(r.enteredAt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }))}` : ''].filter(Boolean).join(' · ');
    return <span className={bad ? 'temp bad' : 'temp'} title={title}>{num(r.valueC)}{late(r) && <sup aria-label="nachgetragen">n</sup>}{r.note && <sup aria-label="mit Bemerkung">*</sup>}</span>;
  };
  const missing = points.filter((p) => p.active && !at(p.id, today)).length;

  return (
    <section className="card hygiene">
      <div className="cardhead">
        <div><h2>Temperaturprotokoll</h2><p className="muted">Bereiche</p></div>
        <div className="actions noprint">
          <div className="segmented" role="radiogroup" aria-label="Ansicht">
            <button type="button" role="radio" aria-checked={mode === 'entry'} className={mode === 'entry' ? 'on' : ''} onClick={() => setMode('entry')}>Eintragen</button>
            <button type="button" role="radio" aria-checked={mode === 'month'} className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Monatsprotokoll</button>
          </div>
          {isAdmin && <Button onClick={() => editArea()}>Bereich anlegen</Button>}
        </div>
      </div>
      <LoadState error={areas.error ?? readings.error} loading={!areas.data} />
      <div className="tabs noprint" role="tablist" aria-label="Bereiche">
        {visible.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === area?.id} className={`${a.id === area?.id ? 'on' : ''}${a.active ? '' : ' off'}`} onClick={() => setAreaId(a.id)}>{a.name}</button>
        ))}
      </div>
      {area && (
        <>
          <div className="areahead">
            <h3>{area.name}{mode === 'month' && ` · ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`}</h3>
            <div className="actions noprint">
              {mode === 'month' && <><input type="month" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="Monat" /><Button onClick={() => window.print()}>Drucken</Button></>}
              {isAdmin && <><Button onClick={() => editArea(area)}>Bereich bearbeiten</Button><Button onClick={() => editPoint()}>Messstelle anlegen</Button></>}
            </div>
          </div>
          {points.length === 0 && <p className="notice">In diesem Bereich gibt es noch keine Messstellen. {isAdmin ? 'Über „Messstelle anlegen“ z. B. die Kühltruhe mit ihrem Sollwert eintragen.' : 'Der Administrator kann sie anlegen.'}</p>}

          {points.length > 0 && mode === 'entry' && (
            <form onSubmit={(e) => void save(e)} noValidate>
              {date === today && missing > 0 && <p className="notice warn">Heute fehlen noch {missing} {missing === 1 ? 'Wert' : 'Werte'} in diesem Bereich.</p>}
              <div className="tablewrap">
                <table className="temps">
                  <thead><tr>
                    <th>Messstelle</th>
                    {days.slice(0, 6).map((d) => <th key={d} className="num hide-sm">{WD[weekdayOf(d)]} {deShort(d)}</th>)}
                    <th className="entrycol"><label>Wert in °C am <input type="date" value={date} max={today} onChange={(e) => e.target.value && e.target.value <= today && setDate(e.target.value)} /></label></th>
                    <th>Bemerkung / Maßnahme</th>
                  </tr></thead>
                  <tbody>
                    {points.map((p) => {
                      const d = draft[p.id] ?? { value: '', note: '' };
                      const v = parseTemp(d.value);
                      const bad = !Number.isNaN(v) && outOfRange(v, p);
                      return (
                        <tr key={p.id} className={p.active ? '' : 'off'}>
                          <td>{isAdmin ? <button type="button" className="linkbtn strong" onClick={() => editPoint(p)}>{p.name}</button> : <b>{p.name}</b>}<br /><small>Soll: {rangeLabel(p)}</small></td>
                          {days.slice(0, 6).map((day) => <td key={day} className="num hide-sm">{cell(at(p.id, day), p)}</td>)}
                          <td className="entrycol"><input inputMode="decimal" className={bad ? 'tempinput bad' : 'tempinput'} value={d.value} placeholder="–" aria-label={`${p.name}: Wert in °C`} onChange={(e) => setCell(p.id, { value: e.target.value })} /></td>
                          <td><input value={d.note} placeholder={bad ? 'Abweichung: Was wurde unternommen?' : ''} className={bad && !d.note.trim() ? 'bad' : ''} aria-label={`${p.name}: Bemerkung`} onChange={(e) => setCell(p.id, { note: e.target.value })} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {errors.length > 0 && <p className="notice danger" role="alert">{errors.join(' · ')}</p>}
              <div className="formactions"><Button type="submit" variant="primary" busy={busy}>Werte speichern</Button></div>
              <p className="muted small">Rot = außerhalb des Sollbereichs (dann ist eine Bemerkung zur Maßnahme Pflicht). <sup>n</sup> = nachträglich eingetragen, <sup>*</sup> = mit Bemerkung. Jeder Eintrag wird mit Namen und Zeitpunkt gespeichert; Korrekturen stehen im Änderungsprotokoll.</p>
            </form>
          )}

          {points.length > 0 && mode === 'month' && (
            <div className="tablewrap">
              <table className="temps month">
                <thead><tr><th>Tag</th>{points.map((p) => <th key={p.id} className="num">{p.name}<br /><small>{rangeLabel(p)}</small></th>)}<th>Bemerkungen</th><th className="hide-sm">Eingetragen von</th></tr></thead>
                <tbody>
                  {Array.from({ length: Number(monthEnd.slice(8)) }, (_, i) => addDays(monthStart, i)).filter((d) => d <= today).map((d) => {
                    const row = points.map((p) => at(p.id, d));
                    return (
                      <tr key={d}>
                        <td className="nowrap">{WD[weekdayOf(d)]} {deShort(d)}</td>
                        {points.map((p, i) => <td key={p.id} className="num">{cell(row[i], p)}</td>)}
                        <td>{points.map((p, i) => (row[i]?.note ? `${p.name}: ${row[i]!.note}` : '')).filter(Boolean).join('; ')}</td>
                        <td className="muted hide-sm">{[...new Set(row.filter(Boolean).map((r) => r!.userName))].join(', ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {dlg}
    </section>
  );
}
