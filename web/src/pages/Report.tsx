import { useState } from 'react';
import { addDays, formatMoney, todayBerlin, type ForecastDto, type OriginStats, type SourceStats, type YearReport } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, LoadState, PageHeader, useLoad, useTabs } from '../ui.tsx';

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const pct = (n: number) => `${String(n).replace('.', ',')} %`;
export const REPORT_TABS = [['vorschau', 'Belegungsvorschau'], ['jahr', 'Jahr'], ['herkunft', 'Herkunft der Gäste'], ['quellen', 'Buchungsquellen']] as const;

/** Auswertung: Belegungsvorschau, Jahresübersicht, Gäste nach Herkunftsland, Umsatz nach Buchungsquelle. */
export function Report() {
  const { current, bar } = useTabs(REPORT_TABS);
  return (
    <>
      <PageHeader title="Auswertung" sub="Vorschau, Auslastung, Umsatz und Statistik" actions={<Button onClick={() => window.print()}>Drucken</Button>} />
      {bar}
      {current === 'vorschau' && <Forecast />}
      {current === 'jahr' && <Year />}
      {current === 'herkunft' && <Origin />}
      {current === 'quellen' && <Sources />}
    </>
  );
}

function YearNav({ year, setYear }: { year: number; setYear: (y: number) => void }) {
  return <p className="noprint yearnav"><Button onClick={() => setYear(year - 1)}>‹ {year - 1}</Button> <b>{year}</b> <Button onClick={() => setYear(year + 1)}>{year + 1} ›</Button></p>;
}

function Forecast() {
  const [from, setFrom] = useState(todayBerlin());
  const { data, error } = useLoad(() => api<ForecastDto>('GET', `/reports/forecast?from=${from}&days=30`), [from]);
  if (!data) return <LoadState error={error} loading />;
  return (
    <>
      <p className="noprint yearnav"><Button onClick={() => setFrom(addDays(from, -30))}>‹ 30 Tage früher</Button> <Button onClick={() => setFrom(todayBerlin())}>Heute</Button> <Button onClick={() => setFrom(addDays(from, 30))}>30 Tage später ›</Button></p>
      <h2 className="printhead">Belegungsvorschau ab {from.slice(8)}.{from.slice(5, 7)}.{from.slice(0, 4)}</h2>
      <div className="tablewrap card flush printable"><table>
        <thead><tr><th>Tag</th><th>Auslastung</th><th className="num">belegt</th><th className="num">vorläufig</th><th className="num">gesperrt</th><th className="num">frei</th>
          {data.categories.map((c) => <th key={c.id} className="num hide-sm">frei {c.name}</th>)}<th className="num">Anreisen</th><th className="num">Abreisen</th></tr></thead>
        <tbody>{data.days.map((d) => {
          const wd = new Date(`${d.date}T12:00:00Z`).getUTCDay();
          return (
            <tr key={d.date} className={wd === 0 || wd === 6 ? 'weekend' : undefined}>
              <td className="strong nowrap">{WD[wd]} {d.date.slice(8)}.{d.date.slice(5, 7)}.</td>
              <td className="barcell"><span className="bar" style={{ width: `${Math.min(100, d.occupancyPercent)}px` }} aria-hidden />{d.occupancyPercent} %</td>
              <td className="num">{d.occupied}</td><td className="num">{d.tentative || '–'}</td><td className="num">{d.blocked || '–'}</td>
              <td className="num">{d.free === 0 ? <b>voll</b> : d.free}</td>
              {d.freeByCategory.map((n, i) => <td key={i} className="num hide-sm">{n}</td>)}
              <td className="num">{d.arrivals || '–'}</td><td className="num">{d.departures || '–'}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="muted small">Gezählt wird die Nacht, die am jeweiligen Tag beginnt, über die {data.rooms} buchbaren Zimmer. „Vorläufig“ sind noch nicht bestätigte Reservierungen; sie belegen das Zimmer ebenfalls. Die Auslastung zählt belegte und vorläufige Zimmer.</p>
    </>
  );
}

function Year() {
  const [year, setYear] = useState(Number(todayBerlin().slice(0, 4)));
  const { data, error } = useLoad(() => api<YearReport>('GET', `/reports/year?year=${year}`), [year]);
  const per = (cents: number, n: number) => (n ? formatMoney(Math.round(cents / n)) : '–');
  return (
    <>
      <YearNav year={year} setYear={setYear} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Auswertung {year} – Auslastung und Umsatz je Monat</h2>
          <div className="tablewrap card flush printable"><table>
            <thead><tr><th>Monat</th><th className="num">Zimmernächte</th><th>Auslastung</th><th className="num">Logisumsatz gebucht</th><th className="num hide-sm">Ø Preis je Nacht</th><th className="num hide-sm">Umsatz je verfügbarem Zimmer</th><th className="num">Rechnungen</th><th className="num">Rechnungssumme</th></tr></thead>
            <tbody>{data.months.map((m) => (
              <tr key={m.month}>
                <td className="strong">{MONTHS[m.month - 1]}</td>
                <td className="num">{m.nights} <small className="muted">von {m.available}</small></td>
                <td className="barcell"><span className="bar" style={{ width: `${Math.min(100, m.occupancyPercent)}px` }} aria-hidden />{pct(m.occupancyPercent)}</td>
                <td className="num">{formatMoney(m.lodgingCents)}</td>
                <td className="num hide-sm">{per(m.lodgingCents, m.nights)}</td><td className="num hide-sm">{per(m.lodgingCents, m.available)}</td>
                <td className="num">{m.invoices}</td>
                <td className="num">{formatMoney(m.invoicedCents)}</td>
              </tr>
            ))}</tbody>
            <tfoot><tr>
              <td>Gesamt</td><td className="num">{data.total.nights} <small className="muted">von {data.total.available}</small></td><td>{pct(data.total.occupancyPercent)}</td>
              <td className="num">{formatMoney(data.total.lodgingCents)}</td><td className="num hide-sm">{per(data.total.lodgingCents, data.total.nights)}</td><td className="num hide-sm">{per(data.total.lodgingCents, data.total.available)}</td>
              <td className="num">{data.total.invoices}</td><td className="num">{formatMoney(data.total.invoicedCents)}</td>
            </tr></tfoot>
          </table></div>
          <p className="muted small">
            Zimmernächte und Logisumsatz: bestätigte, eingecheckte und ausgecheckte Reservierungen (ohne vorläufige, stornierte, nicht angereiste), Preise inklusive Umsatzsteuer, ohne Zusatzleistungen.
            Auslastung: bezogen auf die heute {data.rooms} aktiven Zimmer; gesperrte Zimmer und frühere Zimmerzahlen sind nicht berücksichtigt.
            „Ø Preis je Nacht“ ist der Logisumsatz geteilt durch die verkauften Zimmernächte, „Umsatz je verfügbarem Zimmer“ der Logisumsatz geteilt durch alle verfügbaren Zimmernächte.
            Rechnungssumme: ausgestellte Rechnungen nach Rechnungsdatum, brutto, abzüglich Stornobelege. Diese Übersicht ersetzt keine Buchhaltung.
          </p>
        </>
      )}
    </>
  );
}

function Origin() {
  const now = todayBerlin();
  const [ym, setYm] = useState(now.slice(0, 7));
  const [year, month] = [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
  const { data, error } = useLoad(() => api<OriginStats>('GET', `/reports/origin?year=${year}&month=${month}`), [ym]);
  return (
    <>
      <p className="noprint yearnav"><label>Monat <input type="month" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} /></label></p>
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <h2 className="printhead">Ankünfte und Übernachtungen {MONTHS[month - 1]} {year}</h2>
          <div className="kpis">
            <div className="card kpicard printable"><span>Ankünfte</span><b>{data.total.arrivals}</b><small>Personen</small></div>
            <div className="card kpicard printable"><span>Übernachtungen</span><b>{data.total.nights}</b><small>Personen × Nächte</small></div>
            <div className="card kpicard printable"><span>Bettenauslastung</span><b>{pct(data.bedOccupancyPercent)}</b><small>{data.beds} Betten × {data.openDays} Tage</small></div>
          </div>
          {data.rows.length === 0 ? <p className="card printable">In diesem Monat gibt es keine Übernachtungen.</p> : (
            <div className="tablewrap card flush printable"><table>
              <thead><tr><th>Herkunftsland</th><th className="num">Ankünfte</th><th className="num">Übernachtungen</th></tr></thead>
              <tbody>{data.rows.map((r) => <tr key={r.country}><td>{r.country}</td><td className="num">{r.arrivals}</td><td className="num">{r.nights}</td></tr>)}</tbody>
              <tfoot><tr><td>Gesamt</td><td className="num">{data.total.arrivals}</td><td className="num">{data.total.nights}</td></tr></tfoot>
            </table></div>
          )}
          <p className="muted small">Das sind die Zahlen, die die amtliche Beherbergungsstatistik abfragt (Ankünfte und Übernachtungen nach Herkunftsland). Gezählt werden Personen aus bestätigten, eingecheckten und ausgecheckten Reservierungen.
            Als Herkunft gilt das Land in der Anschrift des Hauptgastes – Mitreisende aus einem anderen Land werden nicht getrennt erfasst. Eine Ankunft zählt in dem Monat, in dem die erste Nacht liegt. „Betten“ ist die Höchstbelegung aller buchbaren Zimmer.
            Ob und in welcher Form Ihr Haus melden muss, sagt das Statistische Landesamt; die Zahlen hier sind eine Arbeitshilfe, keine fertige Meldung.</p>
        </>
      )}
    </>
  );
}

function Sources() {
  const [year, setYear] = useState(Number(todayBerlin().slice(0, 4)));
  const { data, error } = useLoad(() => api<SourceStats>('GET', `/reports/sources?year=${year}`), [year]);
  const total = data?.rows.reduce((s, r) => s + r.lodgingCents, 0) ?? 0;
  return (
    <>
      <YearNav year={year} setYear={setYear} />
      <LoadState error={error} loading={!data} />
      {data && (data.rows.length === 0 ? <p className="card printable">In diesem Jahr gibt es keine Übernachtungen.</p> : (
        <>
          <h2 className="printhead">Buchungsquellen {year}</h2>
          <div className="tablewrap card flush printable"><table>
            <thead><tr><th>Buchungsquelle</th><th className="num">Reservierungen</th><th className="num">Zimmernächte</th><th className="num">Logisumsatz</th><th>Anteil</th></tr></thead>
            <tbody>{data.rows.map((r) => {
              const share = total ? Math.round((r.lodgingCents / total) * 100) : 0;
              return <tr key={r.source}><td className="strong">{r.source}</td><td className="num">{r.bookings}</td><td className="num">{r.nights}</td><td className="num">{formatMoney(r.lodgingCents)}</td>
                <td className="barcell"><span className="bar" style={{ width: `${share}px` }} aria-hidden />{share} %</td></tr>;
            })}</tbody>
          </table></div>
          <p className="muted small">Woher die Reservierungen kommen (Feld „Buchungsquelle“ der Reservierung), gezählt nach dem Tag der Übernachtung. So sehen Sie zum Beispiel, wie viel Umsatz über ein Buchungsportal läuft, für das Provision anfällt.</p>
        </>
      ))}
    </>
  );
}
