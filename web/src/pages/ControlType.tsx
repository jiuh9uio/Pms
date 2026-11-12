import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inspectionItemInput, inspectionVisitInput, type InspectionDetailDto, type InspectionItemDto } from '../../../src/shared/controls.js';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, Field, LoadState, PageHeader, useLoad, useSubmit, useToast } from '../ui.tsx';
import { TypeDialog } from './Controls.tsx';
import { Hygiene } from './Hygiene.tsx';

export function ControlType() {
  const { id } = useParams();
  const { user } = useAuth();
  const { rev, bump } = useData();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const { data, error } = useLoad(() => api<InspectionDetailDto>('GET', `/inspection-types/${id}`), [id, rev]);
  const [edit, setEdit] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [visit, setVisit] = useState({ date: todayBerlin(), inspector: '', result: '', notes: '' });

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const toggle = (i: InspectionItemDto, patch: Partial<InspectionItemDto>) =>
    act(() => api('PUT', `/inspection-items/${i.id}`, { ready: i.ready, note: i.note, version: i.version, ...patch }));
  const addItem = useSubmit(inspectionItemInput, async (d) => { await api('POST', `/inspection-types/${id}/items`, d); setNewItem(''); bump(); });
  const addVisit = useSubmit(inspectionVisitInput, async (d) => {
    await api('POST', `/inspection-types/${id}/visits`, d);
    setVisit({ date: todayBerlin(), inspector: '', result: '', notes: '' });
    toast('Kontrolle eingetragen');
    bump();
  });

  if (!data) return <><PageHeader title="Kontrolle" /><LoadState error={error} loading /></>;
  const { type, items, visits } = data;
  return (
    <>
      <p className="crumb"><Link to="/kontrollen">Kontrollen</Link> ›</p>
      <PageHeader title={type.name} actions={isAdmin && <Button onClick={() => setEdit(true)}>Bearbeiten</Button>} />

      {type.kind === 'hygiene' && <Hygiene />}

      <section className="card">
        <h2>Unterlagen bereithalten</h2>
        <p className="muted">Abhaken, was griffbereit ist, und notieren, wo es liegt. Die Liste ist ein Vorschlag und nicht vollständig – welche Unterlagen verlangt werden können, bitte mit der zuständigen Stelle oder der Steuerberatung klären.</p>
        {items.length === 0 && <p className="muted">Noch keine Unterlagen erfasst.</p>}
        <ul className="checklist">
          {items.map((i) => (
            <li key={i.id} className={i.ready ? 'done' : ''}>
              <label className="check"><input type="checkbox" checked={i.ready} onChange={(e) => void toggle(i, { ready: e.target.checked })} /><span>{i.text}</span></label>
              <input className="note" defaultValue={i.note} placeholder="Ablageort / Bemerkung" aria-label={`Bemerkung zu ${i.text}`}
                onBlur={(e) => { if (e.target.value.trim() !== i.note) void toggle(i, { note: e.target.value.trim() }); }} />
              {isAdmin && <button type="button" className="iconbtn" aria-label={`${i.text} entfernen`} onClick={() => { if (window.confirm(`„${i.text}“ aus der Liste entfernen?`)) void act(() => api('POST', `/inspection-items/${i.id}/remove`)); }}>✕</button>}
            </li>
          ))}
        </ul>
        {isAdmin && (
          <form className="addrow" onSubmit={(e) => void addItem.submit({ text: newItem }, e)} noValidate>
            <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Weitere Unterlage …" aria-label="Weitere Unterlage" />
            <Button type="submit" busy={addItem.busy}>Hinzufügen</Button>
          </form>
        )}
        {addItem.errors.text && <p className="error">{addItem.errors.text}</p>}
      </section>

      <section className="card">
        <h2>Kontrollbesuche</h2>
        <form className="formgrid cols3" onSubmit={(e) => void addVisit.submit(visit, e)} noValidate>
          <Field label="Datum" error={addVisit.errors.date}><input type="date" value={visit.date} max={todayBerlin()} onChange={(e) => setVisit({ ...visit, date: e.target.value })} /></Field>
          <Field label="Prüfer / Behörde" error={addVisit.errors.inspector}><input value={visit.inspector} onChange={(e) => setVisit({ ...visit, inspector: e.target.value })} /></Field>
          <Field label="Ergebnis" error={addVisit.errors.result}><input value={visit.result} onChange={(e) => setVisit({ ...visit, result: e.target.value })} placeholder="z. B. ohne Beanstandung" /></Field>
          <Field label="Notizen / Auflagen" wide error={addVisit.errors.notes}><textarea rows={2} value={visit.notes} onChange={(e) => setVisit({ ...visit, notes: e.target.value })} /></Field>
          <div className="wide"><Button type="submit" variant="primary" busy={addVisit.busy}>Kontrolle eintragen</Button></div>
        </form>
        {visits.length > 0 && (
          <div className="tablewrap"><table>
            <thead><tr><th>Datum</th><th>Prüfer / Behörde</th><th>Ergebnis</th><th className="hide-sm">Notizen</th><th className="hide-sm">Eingetragen von</th></tr></thead>
            <tbody>{visits.map((v) => (
              <tr key={v.id}><td className="nowrap">{deDate(v.date)}</td><td>{v.inspector || '–'}</td><td>{v.result || '–'}</td><td className="hide-sm">{v.notes}</td><td className="muted hide-sm">{v.recordedBy}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {edit && <TypeDialog type={type} onClose={() => setEdit(false)} />}
    </>
  );
}
