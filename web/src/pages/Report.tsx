import { useState } from 'react';
import { formatMoney, todayBerlin, type YearReport } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pct = (n: number) => `${String(n).replace('.', ',')} %`;

/** Jahresauswertung: Auslastung und Umsatz je Monat. */
export function Report() {
  const [year, setYear] = useState(Number(todayBerlin().slice(0, 4)));
  const { data, error } = useLoad(() => api<YearReport>('GET', `/reports/year?year=${year}`), [year]);
  return (
    <>
      <PageHeader title={`Auswertung ${year}`} sub="Auslastung und Umsatz je Monat"
        actions={<><Button onClick={() => setYear(year - 1)} aria-label="Vorjahr">‹ {year - 1}</Button><Button onClick={() => setYear(year + 1)} aria-label="Folgejahr">{year + 1} ›</Button><Button onClick={() => window.print()}>Drucken</Button></>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <div className="tablewrap card flush"><table>
            <thead><tr><th>Monat</th><th className="num">Zimmernächte</th><th>Auslastung</th><th className="num">Logisumsatz gebucht</th><th className="num">Rechnungen</th><th className="num">Rechnungssumme</th></tr></thead>
            <tbody>{data.months.map((m) => (
              <tr key={m.month}>
                <td className="strong">{MONTHS[m.month - 1]}</td>
                <td className="num">{m.nights} <small className="muted">von {m.available}</small></td>
                <td className="barcell"><span className="bar" style={{ width: `${Math.min(100, m.occupancyPercent)}px` }} aria-hidden />{pct(m.occupancyPercent)}</td>
                <td className="num">{formatMoney(m.lodgingCents)}</td>
                <td className="num">{m.invoices}</td>
                <td className="num">{formatMoney(m.invoicedCents)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td>Gesamt</td><td className="num">{data.total.nights} <small className="muted">von {data.total.available}</small></td><td>{pct(data.total.occupancyPercent)}</td>
              <td className="num">{formatMoney(data.total.lodgingCents)}</td><td className="num">{data.total.invoices}</td><td className="num">{formatMoney(data.total.invoicedCents)}</td>
            </tr></tfoot>
          </table></div>
          <p className="muted small">
            Zimmernächte und Logisumsatz: bestätigte, eingecheckte und ausgecheckte Reservierungen (ohne vorläufige, stornierte, nicht angereiste), Preise inklusive Umsatzsteuer, ohne Zusatzleistungen.
            Auslastung: bezogen auf die heute {data.rooms} aktiven Zimmer; gesperrte Zimmer und frühere Zimmerzahlen sind nicht berücksichtigt.
            Rechnungssumme: ausgestellte Rechnungen nach Rechnungsdatum, brutto, abzüglich Stornobelege. Diese Übersicht ersetzt keine Buchhaltung.
          </p>
        </>
      )}
    </>
  );
}
