import { useState } from 'react';
import { NOTE_KINDS, NOTE_KIND_LABEL, REPEATS, REPEAT_LABEL, recurringInput, teamNoteInput, type NoteKind, type RecurringDto, type TeamNoteDto } from '../../../src/shared/team.js';
import { useAuth } from '../App.tsx';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, PageHeader, fmtDateTime, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

export const TEAM_TABS = [['open', 'Offen'], ['note', 'Übergaben'], ['task', 'Aufgaben'], ['repair', 'Reparaturen'], ['done', 'Erledigt']] as const;
const tone = (k: NoteKind) => (k === 'repair' ? 'warn' : k === 'task' ? 'accent' : 'neutral');

/** Team: Übergabebuch, Aufgaben und Reparaturmeldungen für alle Benutzer. */
export function Team() {
  const toast = useToast();
  const { rev, bump } = useData();
  const { current, bar } = useTabs(TEAM_TABS);
  const { data, error } = useLoad(() => api<TeamNoteDto[]>('GET', `/team/notes?view=${current}`), [current, rev]);
  const [v, setV] = useState({ kind: 'note' as NoteKind, text: '', place: '', dueDate: '' });
  const f = useSubmit(teamNoteInput, async (d) => {
    await api('POST', '/team/notes', d);
    toast(`${NOTE_KIND_LABEL[d.kind]} eingetragen`); setV({ ...v, text: '', place: '', dueDate: '' }); bump();
  });
  const act = async (path: string, body: object, msg: string) => {
    try { await api('POST', path, body); toast(msg); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const done = (n: TeamNoteDto) => {
    const note = n.kind === 'note' ? '' : window.prompt('Kurzer Vermerk zur Erledigung (kann leer bleiben):', '');
    if (note === null) return;
    void act(`/team/notes/${n.id}/done`, { done: true, note }, 'Als erledigt eingetragen');
  };
  return (
    <>
      <PageHeader title="Team" sub="Übergabebuch, Aufgaben und Reparaturen – für alle sichtbar, nichts geht zwischen den Schichten verloren" />
      <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <h2>Neuer Eintrag</h2>
        <div className="formgrid cols3">
          <Field label="Art"><select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as NoteKind })}>{NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_LABEL[k]}</option>)}</select></Field>
          <Field label="Zimmer oder Ort" error={f.errors.place} hint="optional, z. B. Zimmer 12"><input value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} /></Field>
          <Field label="Zu erledigen bis" error={f.errors.dueDate} hint="optional"><input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
          <Field label="Text" error={f.errors.text} wide><textarea rows={3} value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} placeholder={v.kind === 'repair' ? 'Was ist kaputt?' : v.kind === 'task' ? 'Was ist zu tun?' : 'Was soll die nächste Schicht wissen?'} /></Field>
        </div>
        <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Eintragen</Button></div>
      </form>
      {bar}
      <LoadState error={error} loading={!data} />
      {data?.length === 0 && <p className="card muted">Keine Einträge in dieser Ansicht.</p>}
      {data?.map((n) => (
        <section key={n.id} className={`card teamnote${!n.readByMe ? ' unread' : ''}`}>
          <div className="cardhead">
            <div>
              <p><Badge tone={tone(n.kind)}>{NOTE_KIND_LABEL[n.kind]}</Badge>{n.place && <> <b>{n.place}</b></>}{n.dueDate && <> · bis {deDate(n.dueDate)}{n.overdue && <> <Badge tone="danger">überfällig</Badge></>}</>}{!n.readByMe && <> <Badge tone="accent">neu</Badge></>}</p>
              <p className="notetext">{n.text}</p>
              <p className="muted small">{n.createdBy} · {fmtDateTime(n.createdAt)}{n.readBy.length > 0 && ` · gelesen von ${n.readBy.join(', ')}`}
                {n.status === 'done' && ` · erledigt von ${n.doneBy}${n.doneAt ? ` am ${fmtDateTime(n.doneAt)}` : ''}${n.doneNote ? `: ${n.doneNote}` : ''}`}</p>
            </div>
            <div className="actions">
              {!n.readByMe && <Button onClick={() => void act(`/team/notes/${n.id}/read`, {}, 'Als gelesen vermerkt')}>Gelesen</Button>}
              {n.status === 'open' ? <Button variant="primary" onClick={() => done(n)}>Erledigt</Button> : <Button onClick={() => void act(`/team/notes/${n.id}/done`, { done: false }, 'Wieder offen')}>Wieder öffnen</Button>}
            </div>
          </div>
        </section>
      ))}
      <Recurring />
      <p className="muted small">Einträge lassen sich nicht löschen oder nachträglich ändern – so bleibt nachvollziehbar, was übergeben wurde. Erledigtes steht unter „Erledigt“.</p>
    </>
  );
}

const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const when = (r: RecurringDto) => (r.repeat === 'daily' ? 'täglich' : r.repeat === 'weekly' ? `jeden ${WD[r.day]}` : `am ${r.day}. jedes Monats`);

/** Wiederkehrende Aufgaben: erscheinen am fälligen Tag von selbst unter „Aufgaben“. Anlegen und Entfernen nur für Administratoren. */
function Recurring() {
  const { user } = useAuth();
  const toast = useToast();
  const { rev, bump } = useData();
  const { data } = useLoad(() => api<RecurringDto[]>('GET', '/team/recurring'), [rev]);
  const [v, setV] = useState({ text: '', place: '', repeat: 'weekly' as (typeof REPEATS)[number], day: '1' });
  const f = useSubmit(recurringInput, async (d) => { await api('POST', '/team/recurring', d); toast('Wiederkehrende Aufgabe angelegt'); setV({ ...v, text: '', place: '' }); bump(); });
  const remove = async (r: RecurringDto) => {
    if (!window.confirm(`„${r.text}“ nicht mehr automatisch anlegen? Bereits angelegte Aufgaben bleiben.`)) return;
    try { await api('DELETE', `/team/recurring/${r.id}`); toast('Entfernt'); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const admin = user.role === 'admin';
  if (!admin && !data?.length) return null;
  return (
    <section className="card">
      <h2>Wiederkehrende Aufgaben</h2>
      <p className="muted">Diese Aufgaben legt das Programm am fälligen Tag von selbst an – sie stehen dann oben unter „Aufgaben“, bis jemand sie erledigt.</p>
      {data && data.length > 0 && (
        <div className="tablewrap"><table>
          <thead><tr><th>Aufgabe</th><th>Ort</th><th>Wann</th>{admin && <th />}</tr></thead>
          <tbody>{data.map((r) => <tr key={r.id}><td>{r.text}</td><td>{r.place || '–'}</td><td>{when(r)}</td>{admin && <td><Button variant="danger" onClick={() => void remove(r)}>Entfernen</Button></td>}</tr>)}</tbody>
        </table></div>
      )}
      {admin && (
        <form onSubmit={(e) => void f.submit({ ...v, day: v.repeat === 'daily' ? 0 : Number(v.day) }, e)} noValidate>
          <div className="formgrid cols3">
            <Field label="Was ist zu tun?" error={f.errors.text} wide><input value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} placeholder="z. B. Getränke bestellen" /></Field>
            <Field label="Ort" error={f.errors.place} hint="optional"><input value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} /></Field>
            <Field label="Wiederholung"><select value={v.repeat} onChange={(e) => setV({ ...v, repeat: e.target.value as (typeof REPEATS)[number], day: e.target.value === 'monthly' ? '1' : '1' })}>{REPEATS.map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}</select></Field>
            {v.repeat === 'weekly' && <Field label="Wochentag" error={f.errors.day}><select value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })}>{[1, 2, 3, 4, 5, 6, 0].map((n) => <option key={n} value={n}>{WD[n]}</option>)}</select></Field>}
            {v.repeat === 'monthly' && <Field label="Tag im Monat" error={f.errors.day} hint="1 bis 28"><input inputMode="numeric" value={v.day} onChange={(e) => setV({ ...v, day: e.target.value })} /></Field>}
          </div>
          <div className="formactions"><Button type="submit" busy={f.busy}>Wiederkehrende Aufgabe anlegen</Button></div>
        </form>
      )}
    </section>
  );
}
