import { useEffect, useState } from 'react';
import { terminalSettingsInput, type TerminalLogDto, type TerminalSettings } from '../../../src/shared/billing.js';
import { formatMoney } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Badge, Button, Field, LoadState, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

const OUTCOME: Record<TerminalLogDto['outcome'], [string, 'ok' | 'danger' | 'warn' | 'neutral']> = {
  approved: ['gezahlt und gebucht', 'ok'], unrecorded: ['gezahlt, NICHT gebucht', 'danger'], declined: ['nicht gezahlt', 'neutral'], unknown: ['ungeklärt – am Gerät prüfen', 'warn'],
};

/** EC-Gerät: Anbindung über die Kassenschnittstelle (ZVT) im Netzwerk. */
export function TerminalCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<TerminalSettings>('GET', '/settings/terminal'));
  const [rev, setRev] = useState(0);
  const log = useLoad(() => api<TerminalLogDto[]>('GET', '/terminal/log'), [rev]).data;
  const [v, setV] = useState<{ enabled: boolean; host: string; port: string; password: string; maker: string; model: string; terminalId: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (data) setV({ enabled: data.enabled, host: data.host, port: String(data.port), password: data.password, maker: data.maker ?? '', model: data.model ?? '', terminalId: data.terminalId ?? '' }); }, [data]);
  const f = useSubmit(terminalSettingsInput, async (d) => { await api('PUT', '/settings/terminal', d); toast('EC-Gerät gespeichert'); });
  if (!v) return <section className="card"><h2>EC-Gerät</h2><LoadState error={error} loading /></section>;
  const payload = () => ({ enabled: v.enabled, host: v.host.trim(), port: Number(v.port), password: v.password.trim(), maker: v.maker, model: v.model, terminalId: v.terminalId });
  const test = async () => {
    setTesting(true);
    try {
      await api('PUT', '/settings/terminal', terminalSettingsInput.parse(payload()));
      const r = await api<{ message: string }>('POST', '/settings/terminal/test', {});
      toast(r.message);
    } catch (e) { toast(e instanceof Error ? e.message : 'Bitte die Eingaben prüfen', 'error'); }
    setTesting(false);
  };
  return (
    <>
      <form className="card" onSubmit={(e) => void f.submit(payload(), e)} noValidate>
        <h2>EC-Gerät</h2>
        <p className="notice warn"><b>Noch nicht mit einem echten EC-Gerät erprobt.</b> Die Anbindung folgt dem ZVT-Protokoll, das EC-Geräte in Deutschland üblicherweise als „Kassenschnittstelle“ anbieten, und ist nur gegen ein simuliertes Gerät getestet. Bitte zuerst die Verbindung prüfen und dann mit einem kleinen Betrag und der eigenen Karte testen. Bei jeder Zahlung gilt: maßgeblich ist der Beleg des EC-Geräts.</p>
        <p className="muted">Das Programm schickt den Betrag an das EC-Gerät, der Gast zahlt dort mit Karte, und bei Erfolg wird die Zahlung als „Karte“ gebucht. Die Kassenschnittstelle (ZVT über Netzwerk/TCP) muss am Gerät eingeschaltet sein – das macht bei Bedarf VR Payment; von dort erfahren Sie auch Port und Passwort. Hersteller, Modell und Terminal-ID können Sie hier notieren; sie dienen nur der Dokumentation und für Rückfragen.</p>
        <div className="formgrid cols3">
          <Field label="IP-Adresse des EC-Geräts" error={f.errors.host} hint="feste Adresse im selben Netz, z. B. 192.168.1.60"><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Port" error={f.errors.port} hint="üblich 20007, je nach Gerät auch anders"><input value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} inputMode="numeric" /></Field>
          <Field label="Passwort der Kassenschnittstelle" error={f.errors.password} hint="6 Ziffern, häufig 000000"><input value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} inputMode="numeric" autoComplete="off" /></Field>
          <Field label="Hersteller" error={f.errors.maker} hint="steht auf dem Gerät, z. B. CCV, Verifone, Ingenico, PAX"><input value={v.maker} onChange={(e) => setV({ ...v, maker: e.target.value })} /></Field>
          <Field label="Modell" error={f.errors.model} hint="z. B. Typenschild auf der Rückseite"><input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} /></Field>
          <Field label="Terminal-ID (TID)" error={f.errors.terminalId} hint="steht auf jedem Beleg des Geräts"><input value={v.terminalId} onChange={(e) => setV({ ...v, terminalId: e.target.value })} /></Field>
          <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>EC-Gerät verwenden <small>Dann erscheint bei Zahlungen im Hotel der Knopf „Mit EC-Gerät kassieren“.</small></span></label>
        </div>
        <p className="muted small">Nicht enthalten: Storno und Gutschrift über das Gerät, Trinkgeld, Kassenschnitt. Die Belege druckt das EC-Gerät selbst. „Verbindung prüfen“ meldet das Programm nur am Gerät an – dabei wird nichts abgebucht.</p>
        <div className="formactions"><Button busy={testing} onClick={() => void test()}>Speichern und Verbindung prüfen</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
      </form>
      <section className="card">
        <div className="cardhead"><h2>Letzte Vorgänge am EC-Gerät</h2><div className="actions"><Button onClick={() => setRev(rev + 1)}>Aktualisieren</Button></div></div>
        {!log ? <LoadState error={null} loading /> : log.length === 0 ? <p className="muted">Noch kein Vorgang.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Zeit</th><th className="num">Betrag</th><th>Ausgang</th><th className="hide-sm">Karte / Beleg</th><th className="hide-sm">Meldung</th><th>Benutzer</th></tr></thead>
            <tbody>{log.map((l) => (
              <tr key={l.id}><td className="nowrap">{fmtDateTime(l.at)}</td><td className="num">{formatMoney(l.amountCents)}</td>
                <td><Badge tone={OUTCOME[l.outcome][1]}>{OUTCOME[l.outcome][0]}</Badge></td>
                <td className="hide-sm">{[l.cardName, l.receiptNo && `Beleg ${l.receiptNo}`, l.trace && `TA ${l.trace}`].filter(Boolean).join(' · ') || '–'}</td>
                <td className="hide-sm"><small>{l.message}</small></td><td>{l.userName}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="muted small">„Ungeklärt“ heißt: Die Verbindung brach ab, nachdem der Betrag am Gerät stand. Dann am Gerät oder auf dessen Beleg nachsehen – wurde gezahlt, die Zahlung von Hand als „Karte“ buchen.</p>
      </section>
    </>
  );
}
