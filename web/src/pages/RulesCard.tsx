import { useEffect, useState } from 'react';
import { RULE_MEASURES, RULE_MEASURE_LABEL, RULE_OPS, RULE_OP_LABEL, breakfastRulesInput, type BreakfastRule } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useToast } from '../ui.tsx';

type Draft = Omit<BreakfastRule, 'value'> & { value: string };
const WD: [number, string][] = [[1, 'Mo'], [2, 'Di'], [3, 'Mi'], [4, 'Do'], [5, 'Fr'], [6, 'Sa'], [0, 'So']];
const blank = (): Draft => ({ name: '', measure: 'breakfast_persons', op: 'lt', value: '4', weekdays: [], text: '', active: true });

/** Algorithmen: Regeln, die das Programm selbst auswertet. Bisher für das Frühstück. */
export function RulesCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<{ rules: BreakfastRule[] }>('GET', '/settings/breakfast-rules'));
  const [rules, setRules] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (data) setRules(data.rules.map((r) => ({ ...r, value: String(r.value) }))); }, [data]);
  if (!rules) return <section className="card"><h2>Frühstücksregeln</h2><LoadState error={error} loading /></section>;
  const set = (i: number, p: Partial<Draft>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const move = (i: number, d: number) => { const c = [...rules]; const [x] = c.splice(i, 1); c.splice(i + d, 0, x!); setRules(c); };
  const save = async () => {
    setFail(null);
    const parsed = breakfastRulesInput.safeParse({ rules: rules.map((r) => ({ ...r, value: r.value.trim() === '' ? NaN : Number(r.value) })) });
    if (!parsed.success) { const i = parsed.error.issues[0]!; setFail(`Regel ${Number(i.path[1]) + 1}: ${i.message}`); return; }
    setBusy(true);
    try { await api('PUT', '/settings/breakfast-rules', parsed.data); toast('Regeln gespeichert'); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <div className="cardhead"><div><h2>Frühstücksregeln</h2><p className="muted">Das Programm prüft für jeden Tag die Regeln von oben nach unten. Die erste, die zutrifft, gilt – ihr Text steht dann groß auf der Frühstücksliste und auf dem Ausdruck für die Küche. Trifft keine zu, erscheint kein Hinweis.</p></div>
        <div className="actions"><Button onClick={() => setRules([...rules, blank()])}>Regel hinzufügen</Button></div></div>
      {rules.length === 0 && <p className="muted">Noch keine Regel. Beispiel: „Wenn Frühstücksgäste weniger als 4, dann: Frühstück in der 1. Etage“.</p>}
      {rules.map((r, i) => (
        <fieldset key={i} className="rulebox">
          <legend>Regel {i + 1}{!r.active && ' (aus)'}</legend>
          <div className="formgrid cols3">
            <Field label="Name"><input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="z. B. Kleines Frühstück" /></Field>
            <Field label="Wenn"><select value={r.measure} onChange={(e) => set(i, { measure: e.target.value as Draft['measure'] })}>{RULE_MEASURES.map((m) => <option key={m} value={m}>{RULE_MEASURE_LABEL[m]}</option>)}</select></Field>
            <Field label="Bedingung"><div className="inline2"><select value={r.op} onChange={(e) => set(i, { op: e.target.value as Draft['op'] })}>{RULE_OPS.map((o) => <option key={o} value={o}>{RULE_OP_LABEL[o]}</option>)}</select>
              <input value={r.value} onChange={(e) => set(i, { value: e.target.value })} inputMode="numeric" aria-label="Zahl" /></div></Field>
            <Field label="Dann gilt" wide><input value={r.text} onChange={(e) => set(i, { text: e.target.value })} placeholder="z. B. Frühstück in der 1. Etage" /></Field>
            <Field label="Nur an diesen Tagen" hint="nichts gewählt = jeden Tag" wide>
              <div className="weekdays">{WD.map(([n, l]) => (
                <button key={n} type="button" className={r.weekdays.includes(n) ? 'on' : ''} aria-pressed={r.weekdays.includes(n)}
                  onClick={() => set(i, { weekdays: r.weekdays.includes(n) ? r.weekdays.filter((x) => x !== n) : [...r.weekdays, n] })}>{l}</button>
              ))}</div>
            </Field>
            <label className="check"><input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} /><span>Aktiv</span></label>
          </div>
          <div className="formactions">
            <Button disabled={i === 0} onClick={() => move(i, -1)}>Nach oben</Button>
            <Button disabled={i === rules.length - 1} onClick={() => move(i, 1)}>Nach unten</Button>
            <Button variant="danger" onClick={() => setRules(rules.filter((_, j) => j !== i))}>Entfernen</Button>
          </div>
        </fieldset>
      ))}
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      <div className="formactions"><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></div>
      <p className="muted small">Gezählt wird für den Morgen des jeweiligen Tages: „Frühstücksgäste“ sind die Personen in Zimmern mit gebuchtem Frühstück, „Gäste im Haus“ alle Personen in belegten Zimmern. An Tagen ohne Frühstücksgäste gilt keine Regel. Die Regeln ändern keine Buchungen und keine Preise – sie zeigen nur an, was gilt.</p>
    </section>
  );
}
