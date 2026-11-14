import { useEffect, useState } from 'react';
import { invoiceLayoutInput, type InvoiceLayoutDto } from '../../../src/shared/billing.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Rechnungslayout: Abstände, Schriftgröße, Einleitungs- und Schlusssatz – mit Vorschau als Muster-Rechnung. */
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
        <Field label="Abstände"><select value={v.spacing} onChange={(e) => setV({ ...v, spacing: e.target.value as InvoiceLayoutDto['spacing'] })}><option value="compact">eng</option><option value="normal">normal</option><option value="wide">großzügig</option></select></Field>
        <Field label="Schriftgröße"><select value={v.fontSize} onChange={(e) => setV({ ...v, fontSize: e.target.value as InvoiceLayoutDto['fontSize'] })}><option value="small">klein</option><option value="normal">normal</option><option value="large">groß</option></select></Field>
        <Field label="Satz über den Positionen" error={f.errors.intro} hint="leer = kein Satz" wide><input value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} maxLength={300} placeholder="Vielen Dank für Ihren Aufenthalt. Wir berechnen Ihnen:" /></Field>
        <Field label="Schlusssatz" error={f.errors.closing} hint="leer = kein Satz" wide><input value={v.closing} onChange={(e) => setV({ ...v, closing: e.target.value })} maxLength={300} placeholder="Wir freuen uns auf Ihren nächsten Besuch." /></Field>
      </div>
      <div className="formactions"><Button onClick={preview}>Vorschau (PDF)</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
    </form>
  );
}
