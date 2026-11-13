import { useEffect, useState } from 'react';
import { kitchenPrinterInput, type KitchenPrinter } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Küchendrucker: Epson-Bondrucker im Netzwerk (ESC/POS über TCP). */
export function KitchenPrinterCard({ kind }: { kind: 'kitchen' | 'front' }) {
  const front = kind === 'front';
  const path = front ? '/settings/front-printer' : '/settings/kitchen-printer';
  const name = front ? 'Bondrucker vorne' : 'Küchendrucker';
  const toast = useToast();
  const { data, error } = useLoad(() => api<KitchenPrinter>('GET', path));
  const [v, setV] = useState<{ enabled: boolean; host: string; port: string; width: string; autoBreakfastTime: string } | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (data) setV({ enabled: data.enabled, host: data.host, port: String(data.port), width: String(data.width), autoBreakfastTime: data.autoBreakfastTime ?? '' }); }, [data]);
  const f = useSubmit(kitchenPrinterInput, async (d) => { await api('PUT', path, d); toast(`${name} gespeichert`); });
  if (!v) return <section className="card"><h2>{name}</h2><LoadState error={error} loading /></section>;
  const payload = () => ({ enabled: v.enabled, host: v.host.trim(), port: Number(v.port), width: Number(v.width), autoBreakfastTime: v.autoBreakfastTime });
  const test = async () => {
    setTesting(true);
    try { await api('PUT', path, kitchenPrinterInput.parse(payload())); await api('POST', `${path}/test`, {}); toast('Testdruck gesendet – kommt ein Bon aus dem Drucker?'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Bitte die Eingaben prüfen', 'error'); }
    setTesting(false);
  };
  return (
    <form className="card" onSubmit={(e) => void f.submit(payload(), e)} noValidate>
      <h2>{name}</h2>
      {front ? <p className="muted">Epson-Bondrucker an Theke oder Empfang für den Bereich „Schnelldruck“ (Öffnungszeiten, WLAN, Info-Zettel für Gäste). Ohne eigenen Drucker hier nutzt der Schnelldruck den Küchendrucker.</p> : <p className="muted">Epson-Bondrucker im Netzwerk (z. B. TM-T20, TM-T88, TM-m30). Darauf druckt das Programm die Frühstücksliste (Hotel → Frühstück) und die Tischreservierungen des Tages (Restaurant) – auf Knopfdruck „An Küche senden“, die Frühstücksliste auf Wunsch auch täglich von selbst.</p>}
      <div className="formgrid cols3">
        <Field label="IP-Adresse des Druckers" error={f.errors.host} hint="steht auf dem Selbsttest-Ausdruck des Druckers, z. B. 192.168.1.50"><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Port" error={f.errors.port} hint="bei Epson üblicherweise 9100"><input value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Papierbreite" error={f.errors.width}>
          <select value={v.width} onChange={(e) => setV({ ...v, width: e.target.value })}>
            <option value="48">80 mm (48 Zeichen)</option><option value="42">80 mm (42 Zeichen)</option><option value="32">58 mm (32 Zeichen)</option>
          </select>
        </Field>
        {!front && <Field label="Frühstücksliste täglich drucken um" error={f.errors.autoBreakfastTime} hint="leer lassen = nur auf Knopfdruck"><input type="time" value={v.autoBreakfastTime} onChange={(e) => setV({ ...v, autoBreakfastTime: e.target.value })} /></Field>}
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>{name} verwenden</span></label>
      </div>
      <p className="muted small">Der Drucker braucht eine feste IP-Adresse im selben Netz wie dieser Rechner (am Drucker oder im Router einstellen). Gedruckt wird ohne Rückmeldung des Druckers: Ist das Papier leer, meldet das Programm trotzdem „gesendet“.{front ? '' : ' Der tägliche Druck läuft nur, wenn das Programm zu der Zeit geöffnet ist; wird es später gestartet, holt es den Druck bis drei Stunden danach nach. Ohne belegtes Zimmer wird nichts gedruckt.'}</p>
      <div className="formactions"><Button busy={testing} onClick={() => void test()}>Speichern und Testdruck</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
    </form>
  );
}
