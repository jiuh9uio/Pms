import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { hygieneAreaInput, type HygieneAreaDto, type InspectionTypeDto } from '../../../src/shared/controls.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Badge, Button, useLoad, useToast } from '../ui.tsx';
import { MasterDialog } from './RoomsPrices.tsx';

const SUGGESTIONS = ['Küche', 'Theke', 'Lager', 'Kühlhaus', 'Bar', 'Frühstücksraum'];

/** Nur für den Administrator: Bereiche (Zonen) für die Eigenkontrolle anlegen und umbenennen. */
export function Zones({ types }: { types: InspectionTypeDto[] }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<HygieneAreaDto[]>('GET', '/hygiene/areas'), [rev]);
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
                <small>{n ? `${n} ${n === 1 ? 'Messstelle' : 'Messstellen'}: ${a.points.filter((p) => p.active).map((p) => p.name).join(', ')}` : 'Noch keine Messstelle – wird deshalb noch nicht abgefragt'}</small></span>
              <span className="actions">
                {hygiene && <Link className="btn linklike" to={`/kontrollen/${hygiene.id}?bereich=${a.id}`}>{n ? 'Messstellen' : 'Messstelle anlegen'}</Link>}
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
