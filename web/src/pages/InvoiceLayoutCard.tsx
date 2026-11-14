import { useEffect, useState } from 'react';
import { invoiceLayoutInput, type InvoiceLayoutDto } from '../../../src/shared/billing.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

const ACCENTS: [InvoiceLayoutDto['accent'], string, string][] = [['black', 'Schwarz', '#1a1a1a'], ['blue', 'Dunkelblau', '#1c457a'], ['green', 'Tannengrün', '#215c40'], ['red', 'Weinrot', '#801f29'], ['gold', 'Gold', '#8c6b29'], ['petrol', 'Petrol', '#126169']];

/** Rechnungslayout: Stil, Farbe, Schrift, Logo-Position, Tabelle, Abstände, Schriftgröße, Einleitungs- und Schlusssatz – mit Vorschau als Muster-Rechnung. */
export function InvoiceLayoutCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<InvoiceLayoutDto>('GET', '/settings/invoice-layout'));
  const [v, setV] = useState<InvoiceLayoutDto | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(invoiceLayoutInput, async (d) => { await api('PUT', '/settings/invoice-layout', d); toast('Rechnungslayout gespeichert'); });
  if (!v) return <section className="card"><h2>Rechnungslayout</h2><LoadState error={error} loading /></section>;
  const preview = () => window.open(`/api/v1/settings/invoice-layout/preview?${new URLSearchParams(v).toString()}`, '_blank', 'noopener');
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Rechnungslayout</h2>
      <p className="muted">Gilt für Rechnungen, die ab jetzt ausgestellt werden. Bereits ausgestellte Rechnungen bleiben unverändert im Archiv. Die Vorschau zeigt eine Muster-Rechnung mit erfundenen Angaben, auch ohne zu speichern.</p>
      <div className="formgrid cols3">
        <Field label="Stil" hint="Gesamtbild der Rechnung"><select value={v.style} onChange={(e) => setV({ ...v, style: e.target.value as InvoiceLayoutDto['style'] })}><option value="classic">klassisch – grau hinterlegt</option><option value="modern">modern – Farbbalken und farbige Kopfzeile</option><option value="elegant">elegant – feine Linien</option></select></Field>
        <Field label="Farbe" hint="für Linien, Überschrift und Hervorhebungen">
          <div className="swatches" role="radiogroup" aria-label="Farbe">{ACCENTS.map(([k, name, hex]) => (
            <button key={k} type="button" role="radio" aria-checked={v.accent === k} title={name} className={v.accent === k ? 'on' : ''} style={{ background: hex }} onClick={() => setV({ ...v, accent: k })}><span className="sr-only">{name}</span></button>
          ))}</div>
        </Field>
        <Field label="Schrift"><select value={v.font} onChange={(e) => setV({ ...v, font: e.target.value as InvoiceLayoutDto['font'] })}><option value="sans">schlicht (ohne Serifen)</option><option value="serif">klassisch (mit Serifen)</option></select></Field>
        <Field label="Logo" hint="Position im Kopf"><select value={v.logoPos} onChange={(e) => setV({ ...v, logoPos: e.target.value as InvoiceLayoutDto['logoPos'] })}><option value="right">rechts</option><option value="left">links</option><option value="center">mittig, Anschrift darunter</option></select></Field>
        <Field label="Positionen"><select value={v.table} onChange={(e) => setV({ ...v, table: e.target.value as InvoiceLayoutDto['table'] })}><option value="lines">mit Trennlinien</option><option value="stripes">abwechselnd hinterlegt</option><option value="plain">ohne Linien</option></select></Field>
        <Field label="Abstände"><select value={v.spacing} onChange={(e) => setV({ ...v, spacing: e.target.value as InvoiceLayoutDto['spacing'] })}><option value="compact">eng</option><option value="normal">normal</option><option value="wide">großzügig</option></select></Field>
        <Field label="Schriftgröße"><select value={v.fontSize} onChange={(e) => setV({ ...v, fontSize: e.target.value as InvoiceLayoutDto['fontSize'] })}><option value="small">klein</option><option value="normal">normal</option><option value="large">groß</option></select></Field>
        <Field label="Satz über den Positionen" error={f.errors.intro} hint="leer = kein Satz" wide><input value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} maxLength={300} placeholder="Vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen:" /></Field>
        <Field label="Schlusssatz" error={f.errors.closing} hint="leer = kein Satz" wide><input value={v.closing} onChange={(e) => setV({ ...v, closing: e.target.value })} maxLength={300} placeholder="Wir freuen uns auf Ihren nächsten Besuch." /></Field>
      </div>
      <div className="formactions"><Button onClick={preview}>Vorschau (PDF)</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
    </form>
  );
}
