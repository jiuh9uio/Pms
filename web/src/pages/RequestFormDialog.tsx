import { useState } from 'react';
import { FORM_DEFAULTS, REQUEST_LABEL, REQUEST_TYPES, formSettings, tableTimes, type FormSettings, type SiteSettings } from '../../../src/shared/site.js';
import { api } from '../api.ts';
import { Button, Dialog, Field, useToast } from '../ui.tsx';

type ListKey = 'meetingKinds' | 'layouts' | 'equipment' | 'catering';
const LISTS: [ListKey, string, string][] = [
  ['meetingKinds', 'Tagung: Art der Veranstaltung', 'z. B. Innungsversammlung'],
  ['layouts', 'Tagung: Bestuhlung', 'z. B. Bankett-Tafel'],
  ['equipment', 'Tagung: Technik', 'z. B. Fernseher mit HDMI'],
  ['catering', 'Tagung: Verpflegung', 'z. B. Vegetarisches Mittagessen'],
];

/** Eine Liste bearbeiten: Einträge hinzufügen, löschen, verschieben. */
function ListEditor({ label, value, placeholder, onChange, error }: { label: string; value: string[]; placeholder: string; onChange: (v: string[]) => void; error?: string }) {
  const [add, setAdd] = useState('');
  const push = () => {
    const x = add.trim();
    if (!x) return;
    if (value.some((y) => y.toLowerCase() === x.toLowerCase())) { setAdd(''); return; }
    onChange([...value, x.slice(0, 60)]); setAdd('');
  };
  const move = (i: number, d: -1 | 1) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };
  return (
    <div className="listedit">
      <div className="listedit-head"><b>{label}</b><small className="muted">{value.length ? `${value.length} ${value.length === 1 ? 'Eintrag' : 'Einträge'}` : 'leer – wird im Formular nicht angezeigt'}</small></div>
      <ul>{value.map((x, i) => (
        <li key={x}>
          <span>{x}</span>
          <button type="button" className="iconbtn" aria-label={`${x} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="iconbtn" aria-label={`${x} nach unten`} disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="iconbtn danger" aria-label={`${x} löschen`} onClick={() => onChange(value.filter((_, k) => k !== i))}>✕</button>
        </li>
      ))}</ul>
      <div className="listedit-add"><input value={add} maxLength={60} placeholder={placeholder} onChange={(e) => setAdd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } }} /><Button onClick={push} disabled={!add.trim() || value.length >= 20}>Hinzufügen</Button></div>
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/** Fenster „Anfrageformular bearbeiten“: Arten an/aus, Auswahllisten, Tischzeiten. Speichert direkt. */
export function RequestFormDialog({ site, onClose, onSaved }: { site: SiteSettings; onClose: () => void; onSaved: (s: SiteSettings) => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormSettings>(site.form);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = formSettings.safeParse(f);
    if (!p.success) { setErr(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.'), i.message]))); return; }
    setBusy(true);
    try { onSaved(await api<SiteSettings>('PUT', '/settings/site', { ...site, form: p.data })); toast('Anfrageformular gespeichert'); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const times = tableTimes(f);
  return (
    <Dialog title="Anfrageformular bearbeiten" size="lg" onClose={onClose}
      footer={<><Button className="left" onClick={() => { if (window.confirm('Alle Listen und Einstellungen des Formulars auf die Vorgabe zurücksetzen?')) setF(FORM_DEFAULTS); }}>Vorgabe wiederherstellen</Button><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></>}>
      <p className="muted">Hier legen Sie fest, was Gäste im Anfrageformular der Gästeseite auswählen können – passend zu dem, was Ihr Haus anbietet. Geänderte Listen gelten sofort für neue Anfragen; Anfragen, die schon im Posteingang liegen, bleiben unverändert.</p>
      <h3>Welche Anfragen sind möglich?</h3>
      <div className="formgrid cols3">
        {REQUEST_TYPES.map((t) => <label key={t} className="check"><input type="checkbox" checked={f.types[t]} onChange={(e) => setF({ ...f, types: { ...f.types, [t]: e.target.checked } })} /><span>{REQUEST_LABEL[t]}</span></label>)}
      </div>
      <h3>Tisch im Restaurant</h3>
      <div className="formgrid cols3">
        <Field label="Früheste Uhrzeit" error={err.tableFrom}><input type="time" value={f.tableFrom} onChange={(e) => setF({ ...f, tableFrom: e.target.value })} /></Field>
        <Field label="Späteste Uhrzeit" error={err.tableTo}><input type="time" value={f.tableTo} onChange={(e) => setF({ ...f, tableTo: e.target.value })} /></Field>
        <Field label="Abstand"><select value={f.tableStep} onChange={(e) => setF({ ...f, tableStep: Number(e.target.value) as 15 | 30 | 60 })}><option value={15}>Viertelstunde</option><option value={30}>halbe Stunde</option><option value={60}>Stunde</option></select></Field>
        <Field label="Höchstens Personen online" error={err.tableMaxPersons} hint="größere Runden fragen als Feier an"><input inputMode="numeric" value={String(f.tableMaxPersons)} onChange={(e) => setF({ ...f, tableMaxPersons: Number(e.target.value) || 0 })} /></Field>
      </div>
      <p className="muted small">Gäste können wählen: {times.length ? `${times[0]} bis ${times[times.length - 1]} Uhr (${times.length} Zeiten)` : '–'}. Ruhetage prüfen Sie bei der Antwort – das Formular kennt Ihre Öffnungstage nicht.</p>
      <h3>Auswahllisten</h3>
      <div className="listedit-grid">
        {LISTS.map(([k, label, ph]) => <ListEditor key={k} label={label} placeholder={ph} value={f[k]} error={err[k]} onChange={(v) => setF({ ...f, [k]: v })} />)}
      </div>
    </Dialog>
  );
}
