import { useState } from 'react';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, useLoad, useToast } from '../ui.tsx';

interface TaxFinding { kind: 'service' | 'offer_item'; id: string; name: string; ratePercent: number; suggestPercent: number; reason: string }
interface TaxCheck { lodgingPercent: number | null; findings: TaxFinding[]; has7: boolean; has19: boolean }

/** Stand der Umsatzsteuersätze (Recherche) und Prüfung der eigenen Leistungen – Änderung nur auf Knopfdruck. */
export function TaxCheckBox() {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, reload } = useLoad(() => api<TaxCheck>('GET', '/tax-check'), [rev]);
  const [pick, setPick] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = pick ?? data?.findings.map((f) => f.id) ?? [];
  const apply = async () => {
    if (!window.confirm(`${chosen.length} ${chosen.length === 1 ? 'Eintrag' : 'Einträge'} auf 7 % umstellen? Bereits gebuchte Leistungen und ausgestellte Rechnungen behalten ihren bisherigen Satz.`)) return;
    setBusy(true);
    try { const r = await api<{ changed: number }>('POST', '/tax-check/apply', { ids: chosen }); toast(`${r.changed} auf 7 % umgestellt`); setPick(null); bump(); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <section className="card taxcheck">
      <h2>Umsatzsteuer für Hotel und Gastronomie – Stand und Prüfung</h2>
      <table className="kv"><tbody>
        <tr><th>Übernachtung</th><td><b>7 %</b></td></tr>
        <tr><th>Speisen im Restaurant und im Hotel (auch Frühstück, Halb-/Vollpension, Buffet)</th><td><b>7 %</b> – seit 1. Januar 2026, egal ob vor Ort gegessen, mitgenommen oder geliefert</td></tr>
        <tr><th>Getränke (auch zum Frühstück und aus der Minibar)</th><td><b>19 %</b></td></tr>
        <tr><th>Sonstiges (z. B. Parkplatz, Wellness, Raummiete ohne Übernachtung)</th><td>in der Regel <b>19 %</b></td></tr>
        <tr><th>Pauschalen mit Speisen und Getränken</th><td>Preis aufteilen: Speiseanteil 7 %, Getränkeanteil 19 %</td></tr>
      </tbody></table>
      <p className="muted small">Recherchiert am 18.11.2026 im Internet. Grundlage ist das Steueränderungsgesetz 2025 (§ 12 Abs. 2 Nr. 15 UStG: „Restaurant- und Verpflegungsdienstleistungen, mit Ausnahme der Abgabe von Getränken“), vom Bundestag am 4.12.2025 beschlossen; die Zustimmung des Bundesrats am 19.12.2025 nennen Fachartikel, die Verkündung im Bundesgesetzblatt habe ich nicht selbst gesehen.
        Quellen: <a href="https://www.bundestag.de/dokumente/textarchiv/2025/kw49-de-steueraenderungsgesetz-1128142" target="_blank" rel="noopener">Bundestag, Textarchiv</a> · <a href="https://dserver.bundestag.de/btd/21/031/2103104.pdf" target="_blank" rel="noopener">Drucksache 21/3104</a> · <a href="https://www.ihk.de/darmstadt/produktmarken/recht-und-fair-play/steuerinfo/mehrwertsteuersenkung-fuer-die-gastronomie-ab-2026-6927450" target="_blank" rel="noopener">IHK Darmstadt</a> · <a href="https://www.etl-adhoga.de/blog/umsatzsteuer-im-hotel-7-oder-19-prozent/" target="_blank" rel="noopener">ETL ADHOGA</a>.{' '}
        <b>Keine Steuerberatung</b> – Sonderfälle (z. B. Frühstück im Zimmerpreis, Pauschalangebote) bitte mit dem Steuerberater klären.</p>
      {!data ? null : <>
        {data.lodgingPercent !== null && data.lodgingPercent !== 7 && <p className="notice warn">Der Standardsatz für Übernachtungen steht bei Ihnen auf {data.lodgingPercent} % – üblich sind 7 %. Bitte oben in der Liste prüfen.</p>}
        {!data.has19 && <p className="notice warn">Es gibt keinen aktiven 19-%-Satz (z. B. für Getränke). Bitte oben anlegen.</p>}
        {data.findings.length === 0
          ? <p className="notice">✓ Ihre Leistungen (Frühstück, Speisen im Angebotskatalog) passen zu den Sätzen oben.</p>
          : <>
            <h3>Vorschläge zum Prüfen</h3>
            <ul className="plain">{data.findings.map((f) => (
              <li key={f.id}><label className="check"><input type="checkbox" checked={chosen.includes(f.id)} onChange={(e) => setPick(e.target.checked ? [...chosen, f.id] : chosen.filter((x) => x !== f.id))} />
                <span><b>{f.name}</b> ({f.kind === 'service' ? 'Leistung im Hotel' : 'Angebotskatalog'}): {f.ratePercent} % → <b>{f.suggestPercent} %</b><small>{f.reason}</small></span></label></li>
            ))}</ul>
            <p className="muted small">Leistungen, in denen Getränke enthalten sind (z. B. Tagungspauschale mit Getränken), schlägt das Programm bewusst nicht vor – dort muss der Preis aufgeteilt werden.</p>
            <div className="formactions"><Button variant="primary" busy={busy} disabled={!chosen.length} onClick={() => void apply()}>Ausgewählte auf 7 % umstellen</Button></div>
          </>}
      </>}
    </section>
  );
}
