import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { hygieneAreaInput, intervalLabel, type CleaningTaskDto, type HygieneAreaDto, type InspectionTypeDto } from '../../../src/shared/controls.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Badge, Button, useLoad, useToast } from '../ui.tsx';
import { MasterDialog } from './RoomsPrices.tsx';

const SUGGESTIONS = ['Küche', 'Theke', 'Lager', 'Kühlhaus', 'Bar', 'Frühstücksraum'];
/** Häufige Kühlgeräte mit üblichem Sollbereich – nach dem Anlegen in der Tabelle anpassbar */
const DEVICES: { name: string; minC: number | null; maxC: number | null }[] = [
  { name: 'Kühltruhe', minC: null, maxC: -18 }, { name: 'Kühlschrank', minC: 0, maxC: 7 }, { name: 'Kühlhaus', minC: 0, maxC: 4 }, { name: 'Getränkekühlung', minC: 2, maxC: 8 },
];
/** „Kühltruhe“, „Kühltruhe 2“, „Kühltruhe 3“ … – die nächste freie Nummer */
const nextName = (base: string, taken: string[]) => {
  if (!taken.some((n) => n === base)) return base;
  let i = 2;
  while (taken.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
};

/** Nur für den Administrator: Bereiche (Zonen) für die Eigenkontrolle anlegen und umbenennen. */
export function Zones({ types }: { types: InspectionTypeDto[] }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<HygieneAreaDto[]>('GET', '/hygiene/areas'), [rev]);
  const tasks = useLoad(() => api<CleaningTaskDto[]>('GET', '/cleaning/tasks'), [rev]);
  const addDevice = async (a: HygieneAreaDto, d: (typeof DEVICES)[number]) => {
    const name = nextName(d.name, a.points.map((p) => p.name));
    try { await api('POST', '/hygiene/points', { areaId: a.id, name, minC: d.minC, maxC: d.maxC, active: true }); toast(`${a.name}: „${name}“ angelegt`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const [dlg, setDlg] = useState<ReactNode>(null);
  const hygiene = types.find((t) => t.kind === 'hygiene');
  if (!data) return null;

  const edit = (a?: HygieneAreaDto) => setDlg(<MasterDialog title={a ? 'Bereich bearbeiten' : 'Bereich anlegen'} path="/hygiene/areas" id={a?.id ?? null} version={a?.version} schema={hygieneAreaInput} onClose={() => setDlg(null)}
    fields={[{ key: 'name', label: 'Name', type: 'text', wide: true, hint: 'z. B. Küche, Theke, Lager' }, ...(a ? [{ key: 'active', label: 'Anzeigen', type: 'check' as const, hint: 'Ausgeblendete Bereiche werden nicht mehr abgefragt; ihre bisherigen Einträge bleiben erhalten.' }] : [])]}
    initial={{ name: a?.name ?? '', active: a?.active ?? true }} />);
  const quick = async (name: string) => {
    try { await api('POST', '/hygiene/areas', { name, active: true }); toast(`Bereich „${name}“ angelegt`); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const free = SUGGESTIONS.filter((s) => !data.some((a) => a.name.toLowerCase() === s.toLowerCase()));

  return (
    <section className="card">
      <div className="cardhead">
        <div><h2>Bereiche für die Eigenkontrolle</h2><p className="muted">Je Bereich fragt das Programm täglich „alles im Sollwert?“ – sobald dort mindestens eine Messstelle angelegt ist.</p></div>
        <Button variant="primary" onClick={() => edit()}>Bereich anlegen</Button>
      </div>
      <ul className="plain">
        {data.map((a) => {
          const n = a.points.filter((p) => p.active).length;
          return (
            <li key={a.id}>
              <span><b>{a.name}</b> {!a.active && <Badge>ausgeblendet</Badge>}<br />
                <small>{n ? `${n} ${n === 1 ? 'Messstelle' : 'Messstellen'}: ${a.points.filter((p) => p.active).map((p) => p.name).join(', ')}` : 'Noch keine Messstelle – Temperatur wird noch nicht abgefragt'}</small><br />
                <small>{(() => { const c = (tasks.data ?? []).filter((t) => t.areaId === a.id && t.active); return c.length ? `Reinigung: ${c.map((t) => `${t.name} (${intervalLabel(t.intervalDays)})`).join(', ')}` : 'Noch keine Reinigungsaufgabe'; })()}</small>
                <span className="chips small">{DEVICES.map((d) => <button key={d.name} type="button" className="chip" onClick={() => void addDevice(a, d)}>+ {nextName(d.name, a.points.map((p) => p.name))}</button>)}</span></span>
              <span className="actions">
                {hygiene && <Link className="btn linklike" to={`/kontrollen/${hygiene.id}?bereich=${a.id}`}>Messstellen &amp; Reinigung</Link>}
                <Button onClick={() => edit(a)}>Umbenennen</Button>
              </span>
            </li>
          );
        })}
      </ul>
      {free.length > 0 && (
        <p className="chips"><span className="muted">Schnell anlegen:</span>
          {free.map((s) => <button key={s} type="button" className="chip" onClick={() => void quick(s)}>+ {s}</button>)}
        </p>
      )}
      {dlg}
    </section>
  );
}
