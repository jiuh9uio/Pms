import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { intervalLabel, outOfRange, quickValues, rangeLabel, type CleaningDueDto, type HygieneOpenDto, type InspectionTypeDto } from '../../../src/shared/controls.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, useLoad, useToast } from '../ui.tsx';

const STORE = 'pms-eigenkontrolle-spaeter';

/**
 * Kurzabfrage beim Start des Programms (im Startmenü): Für jeden Bereich, in dem heute noch nichts eingetragen ist,
 * wird je Messstelle der abgelesene Wert angetippt (Werte im Sollbereich) – gespeichert wird der echte Zahlenwert mit
 * Namen und Uhrzeit. Liegt ein Wert außerhalb, geht es über „Nein – Werte eintragen“ (dort ist eine Maßnahme Pflicht).
 * Reinigung: ein Tipp auf „Ja“.
 */
export function HygienePrompt({ temp: askTemp = true, clean: askClean = true }: { temp?: boolean; clean?: boolean }) {
  const { bump } = useData();
  const toast = useToast();
  const navigate = useNavigate();
  const { data } = useLoad(async () => {
    const [temp, clean] = await Promise.all([askTemp ? api<HygieneOpenDto[]>('GET', '/hygiene/open') : Promise.resolve([]), askClean ? api<CleaningDueDto[]>('GET', '/cleaning/due') : Promise.resolve([])]);
    // Reihenfolge: erst alle Temperaturen, dann die fällige Reinigung
    type Q = { key: string; kind: 'temp'; area: HygieneOpenDto } | { key: string; kind: 'clean'; area: CleaningDueDto };
    return [...temp.map((a): Q => ({ key: 't' + a.areaId, kind: 'temp', area: a })), ...clean.map((a): Q => ({ key: 'c' + a.areaId, kind: 'clean', area: a }))];
    // Nur beim Start fragen – „Später“ gilt, bis das Programmfenster geschlossen wird (und höchstens für heute).
  }, []);
  const [skipped, setSkippedState] = useState<string[]>(() => { try { const v = JSON.parse(sessionStorage.getItem(STORE) ?? 'null') as { day: string; keys: string[] } | null; return v && v.day === todayBerlin() ? v.keys : []; } catch { return []; } });
  const setSkipped = (keys: string[]) => { setSkippedState(keys); try { sessionStorage.setItem(STORE, JSON.stringify({ day: todayBerlin(), keys })); } catch { /* ohne Speicher gilt es bis zum Neuladen */ } };
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const open = (data ?? []).filter((q) => !skipped.includes(q.key));
  const q = open[0];
  if (!q) return null;
  const area = q.area;
  const skip = () => { setSkipped([...skipped, q.key]); setVals({}); };
  const num = (s: string | undefined) => (s == null || s.trim() === '' ? NaN : Number(s.replace(',', '.').replace('−', '-')));
  const points = q.kind === 'temp' ? q.area.points : [];
  const allSet = points.every((p) => Number.isFinite(num(vals[p.id])));
  const anyOut = points.some((p) => Number.isFinite(num(vals[p.id])) && outOfRange(num(vals[p.id]), p));

  const yes = async () => {
    setBusy(true);
    try {
      if (q.kind === 'temp') await api('PUT', '/hygiene/readings', { entries: points.map((p) => ({ pointId: p.id, date: todayBerlin(), valueC: num(vals[p.id]), note: '' })) });
      else await api('POST', `/cleaning/areas/${area.areaId}/done`);
      toast(`${area.areaName}: ${q.kind === 'temp' ? 'Werte gespeichert' : 'Reinigung erledigt'}`);
      skip();
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const no = async () => {
    const types = await api<InspectionTypeDto[]>('GET', '/inspection-types');
    const hygiene = types.find((t) => t.kind === 'hygiene' && t.active) ?? types.find((t) => t.kind === 'hygiene');
    setSkipped(open.map((x) => x.key));
    if (hygiene) navigate(`/kontrollen/${hygiene.id}?bereich=${area.areaId}`);
  };

  return (
    <Dialog title={q.kind === 'temp' ? `${area.areaName}: Temperaturen ablesen` : `${area.areaName}: Reinigung erledigt?`} onClose={skip}
      footer={<>
        <Button className="left" onClick={skip}>Später</Button>
        <Button onClick={() => void no()}>{q.kind === 'temp' ? 'Nein – Werte eintragen' : 'Nein – einzeln abhaken'}</Button>
        {q.kind === 'temp'
          ? <Button variant="primary" busy={busy} className="big" disabled={!allSet || anyOut} onClick={() => void yes()}>Speichern</Button>
          : <Button variant="primary" busy={busy} className="big" onClick={() => void yes()} autoFocus>Ja</Button>}
      </>}>
      {q.kind === 'temp' && <p className="muted small">Thermometer ablesen und den Wert antippen (oder eintippen). Gespeichert wird der abgelesene Wert.</p>}
      <ul className="plain">
        {q.kind === 'temp'
          ? q.area.points.map((p) => {
            const v = num(vals[p.id]);
            const out = Number.isFinite(v) && outOfRange(v, p);
            return (
              <li key={p.id} className="readrow">
                <span><b>{p.name}</b> <span className="muted small">Soll: {rangeLabel(p)}</span></span>
                <div className="chips small">
                  {quickValues(p).map((x) => <button key={x} type="button" className={`chip${v === x ? ' on' : ''}`} aria-pressed={v === x} onClick={() => setVals({ ...vals, [p.id]: String(x) })}>{x > 0 ? '+' : ''}{x}°</button>)}
                  <input className={`tempinput${out ? ' bad' : ''}`} inputMode="decimal" aria-label={`${p.name}: anderer Wert in °C`} placeholder="anderer Wert"
                    value={vals[p.id] != null && !quickValues(p).includes(v) ? vals[p.id] : ''} onChange={(e) => setVals({ ...vals, [p.id]: e.target.value })} />
                </div>
                {out && <small className="error">Außerhalb des Sollbereichs – bitte über „Nein – Werte eintragen“ mit Maßnahme erfassen.</small>}
              </li>
            );
          })
          : q.area.tasks.map((t) => <li key={t.id}><b>{t.name}</b><span className="muted">{intervalLabel(t.intervalDays)}</span></li>)}
      </ul>
      {open.length > 1 && <p className="muted small">Danach: {open.slice(1).map((x) => `${x.area.areaName} (${x.kind === 'temp' ? 'Temperatur' : 'Reinigung'})`).join(', ')}</p>}
    </Dialog>
  );
}
