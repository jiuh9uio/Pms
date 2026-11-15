import { useEffect, useState } from 'react';
import { checkinSheetInput, type CheckinSheet } from '../../../src/shared/hotel.js';
import { wifiSettingsInput, type WifiDto, type WifiSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useToast } from '../ui.tsx';

/** Einstellungen → Haus: Meldeschein beim Check-in mit Gästeinformationen (WLAN-Zugang mit QR-Code, Frühstück, Zimmerreinigung …). */
export function CheckinSheetCard() {
  const toast = useToast();
  const { data, error } = useLoad(async () => {
    const [sheet, wifi] = await Promise.all([api<CheckinSheet>('GET', '/settings/checkin-sheet'), api<WifiDto>('GET', '/network/wifi').catch(() => null)]);
    return { sheet, wifi };
  });
  const [v, setV] = useState<CheckinSheet | null>(null);
  const [w, setW] = useState<WifiSettings | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setV(data.sheet);
    if (data.wifi) { setW({ ssid: data.wifi.ssid, password: data.wifi.password, open: data.wifi.open, note: data.wifi.note }); setQr(data.wifi.qr); }
  }, [data]);
  if (!v) return <section className="card"><h2>Check-in &amp; Meldeschein</h2><LoadState error={error} loading /></section>;
  const save = async () => {
    const a = checkinSheetInput.safeParse(v);
    const b = w ? wifiSettingsInput.safeParse(w) : null;
    const e: Record<string, string> = {};
    if (!a.success) for (const i of a.error.issues) e[String(i.path[0])] = i.message;
    if (b && !b.success) for (const i of b.error.issues) e[`wifi.${String(i.path[0])}`] = i.message;
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      setV(await api<CheckinSheet>('PUT', '/settings/checkin-sheet', a.data));
      if (w && b?.success) { const r = await api<WifiDto>('PUT', '/network/wifi', b.data); setQr(r.qr); }
      toast('Check-in-Einstellungen gespeichert');
    } catch (x) { toast(x instanceof Error ? x.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <h2>Check-in &amp; Meldeschein</h2>
      <p className="muted">Nach „Anreise bestätigen“ bietet das Programm an, den Meldeschein zu drucken. Unten auf dem Blatt stehen – zum Abtrennen für den Gast – WLAN-Zugang mit QR-Code und die Hausinformationen von hier.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.askAfterCheckin} onChange={(e) => setV({ ...v, askAfterCheckin: e.target.checked })} />
          <span>Nach dem Check-in fragen: „Meldeschein drucken?“<small>Ausgeschaltet geht es über „Meldeschein drucken“ in der Reservierung.</small></span></label>
        <label className="check wide"><input type="checkbox" checked={v.showInfo} onChange={(e) => setV({ ...v, showInfo: e.target.checked })} />
          <span>Gästeinformationen unten auf den Meldeschein drucken</span></label>
      </div>
      {v.showInfo && <>
        <h3>WLAN für Gäste</h3>
        {!w ? <p className="muted">Das WLAN wird im Bereich Internet eingetragen; dafür fehlt diesem Benutzer die Freigabe.</p> : <>
          <label className="check"><input type="checkbox" checked={v.showWifi} onChange={(e) => setV({ ...v, showWifi: e.target.checked })} /><span>WLAN-Zugang mit QR-Code aufdrucken</span></label>
          {v.showWifi && <div className="sheet-wifi">
            <div className="formgrid">
              <Field label="WLAN-Name" error={errs['wifi.ssid']}><input value={w.ssid} onChange={(e) => setW({ ...w, ssid: e.target.value })} placeholder="z. B. Schuetzenhaus-Gast" /></Field>
              <Field label="Passwort" error={errs['wifi.password']}><input value={w.password} disabled={w.open} onChange={(e) => setW({ ...w, password: e.target.value })} autoComplete="off" /></Field>
              <label className="check wide"><input type="checkbox" checked={w.open} onChange={(e) => setW({ ...w, open: e.target.checked })} /><span>Offenes WLAN ohne Passwort</span></label>
            </div>
            <div className="sheet-qr">{qr ? <img src={qr} alt="QR-Code für das WLAN" /> : <span className="muted small">QR-Code erscheint nach dem Speichern</span>}</div>
          </div>}
          <p className="muted small">Dieselben WLAN-Angaben gelten für den Aushang unter Internet → Gäste-WLAN. Das Passwort steht im Klartext auf dem Blatt – am besten ein eigenes Gäste-WLAN verwenden.</p>
        </>}
        <h3>Hausinformationen</h3>
        <div className="formgrid">
          <Field label="Überschrift" error={errs.title}><input value={v.title} maxLength={80} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
          <Field label="Schlusssatz" error={errs.closing}><input value={v.closing} maxLength={300} onChange={(e) => setV({ ...v, closing: e.target.value })} /></Field>
          <Field label="Informationen" wide error={errs.info} hint="je Zeile „Bezeichnung | Angabe“, z. B. Frühstück | 7:00 – 10:00 Uhr; höchstens 12 Zeilen">
            <textarea rows={6} value={v.info} onChange={(e) => setV({ ...v, info: e.target.value })} /></Field>
        </div>
      </>}
      <div className="formactions"><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></div>
    </section>
  );
}
