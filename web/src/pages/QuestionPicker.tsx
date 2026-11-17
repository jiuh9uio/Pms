import { useState } from 'react';
import { api } from '../api.ts';
import { Button, useLoad, useToast } from '../ui.tsx';

/**
 * Fragenkatalog zum Anklicken: gesammelte Fragen als Kästchen, eigene Frage dazuschreiben (wahlweise für später merken).
 * Die Reihenfolge im Angebot ist die Reihenfolge des Anklickens.
 */
export function QuestionPicker({ selected, onChange, disabled, isAdmin }: { selected: string[]; onChange: (list: string[]) => void; disabled?: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const loaded = useLoad(() => api<string[]>('GET', '/offer-questions')).data;
  const [bank, setBank] = useState<string[] | null>(null);
  const list = bank ?? loaded ?? [];
  const [own, setOwn] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  // eigene Fragen dieses Angebots, die (noch) nicht im Katalog stehen, erscheinen mit
  const all = [...list, ...selected.filter((q) => !list.includes(q))];
  const toggle = (q: string) => onChange(selected.includes(q) ? selected.filter((x) => x !== q) : [...selected, q]);
  const add = async () => {
    const q = own.trim();
    if (q.length < 2) return;
    if (!selected.includes(q)) onChange([...selected, q]);
    setOwn('');
    if (keep && !list.includes(q)) {
      setBusy(true);
      try { setBank(await api<string[]>('POST', '/offer-questions', { question: q })); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
      setBusy(false);
    }
  };
  const remove = async (q: string) => {
    if (!window.confirm(`„${q}“ aus dem Fragenkatalog entfernen? (Bereits gestellte Fragen bleiben unverändert.)`)) return;
    try { setBank(await api<string[]>('POST', '/offer-questions/remove', { question: q })); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <div className="qpick">
      <div className="qpick-head"><span className="muted small">{selected.length ? `${selected.length} ${selected.length === 1 ? 'Frage' : 'Fragen'} ausgewählt` : 'Fragen anklicken, die der Kunde beantworten soll'}</span>
        {!disabled && selected.length > 0 && <button type="button" className="linkbtn" onClick={() => onChange([])}>Auswahl leeren</button>}</div>
      <div className="qpick-list">
        {all.map((q) => {
          const on = selected.includes(q);
          return (
            <label key={q} className={`qchip${on ? ' on' : ''}`}>
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(q)} />
              <span>{q}</span>
              {isAdmin && !disabled && list.includes(q) && <button type="button" className="qchip-x" aria-label={`„${q}“ aus dem Katalog entfernen`} title="Aus dem Fragenkatalog entfernen" onClick={(e) => { e.preventDefault(); void remove(q); }}>×</button>}
            </label>
          );
        })}
        {all.length === 0 && <span className="muted small">Noch keine Fragen im Katalog – unten die erste eintragen.</span>}
      </div>
      {!disabled && (
        <div className="qpick-add">
          <input value={own} maxLength={200} placeholder="Eigene Frage, z. B. Gewünschte Uhrzeit für den Sektempfang?" onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} aria-label="Eigene Frage" />
          <Button busy={busy} disabled={own.trim().length < 2} onClick={() => void add()}>Hinzufügen</Button>
          <label className="check small"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /><span>für später im Katalog merken</span></label>
        </div>
      )}
    </div>
  );
}
