import { useEffect, useState } from 'react';
import { todayBerlin } from '../../../src/shared/hotel.js';
import { invoiceNumberInput, type InvoiceNumberState } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Rechnungsnummern: mit welcher Nummer das Jahr weitergeht – für den Start mitten im Jahr. */
export function InvoiceNumberCard() {
  const toast = useToast();
  const year = Number(todayBerlin().slice(0, 4));
  const { data, error, reload } = useLoad(() => api<InvoiceNumberState>('GET', `/settings/invoice-number?year=${year}`));
  const [next, setNext] = useState('');
  useEffect(() => { if (data) setNext(String(data.next)); }, [data]);
  const f = useSubmit(invoiceNumberInput, async (d) => {
    if (!window.confirm(`Die nächste Rechnung in ${year} bekommt die laufende Nummer ${d.next}. Das lässt sich nicht mehr auf eine kleinere Nummer zurückstellen. Fortfahren?`)) return;
    await api('PUT', '/settings/invoice-number', d); toast('Rechnungsnummer festgelegt'); reload();
  });
  if (!data) return <section className="card"><h2>Rechnungsnummern</h2><LoadState error={error} loading /></section>;
  return (
    <form className="card" onSubmit={(e) => void f.submit({ year, next: next.trim() === '' ? NaN : Number(next) }, e)} noValidate>
      <h2>Rechnungsnummern {year}</h2>
      <p>Die nächste Rechnung bekommt die Nummer <b>{data.sample}</b>.</p>
      <p className="muted">Haben Sie in diesem Jahr schon Rechnungen mit einem anderen Programm geschrieben, tragen Sie hier ein, mit welcher laufenden Nummer es weitergehen soll – damit keine Nummer doppelt vorkommt. Ob Sie Ihren bisherigen Nummernkreis fortsetzen oder einen neuen beginnen, stimmen Sie am besten mit der Steuerberatung ab.</p>
      <div className="formgrid cols3">
        <Field label="Nächste laufende Nummer" error={f.errors.next} hint={`mindestens ${data.next}`}><input inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      </div>
      <div className="formactions"><Button type="submit" busy={f.busy} disabled={Number(next) === data.next}>Festlegen</Button></div>
      <p className="muted small">Die Nummer lässt sich nur erhöhen. Den vorangestellten Buchstabenteil (z. B. „RE“) ändern Sie unter „Haus“. Im neuen Jahr beginnt die Zählung von selbst wieder bei 1.</p>
    </form>
  );
}
