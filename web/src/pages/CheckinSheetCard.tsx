import { useEffect, useState } from 'react';
import { checkinSheetInput, type CheckinSheet, type CheckinSheetDto } from '../../../src/shared/hotel.js';
import { wifiSettingsInput, type WifiDto, type WifiSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useToast } from '../ui.tsx';

/** Einstellungen → Haus: Meldeschein beim Check-in mit Gästeinformationen (WLAN-Zugang mit QR-Code, Frühstück, Zimmerreinigung …). */
export function CheckinSheetCard() {
  const toast = useToast();
  const { data, error } = useLoad(async () => {
    const [sheet, wifi, print, policy] = await Promise.all([api<CheckinSheet>('GET', '/settings/checkin-sheet'), api<WifiDto>('GET', '/network/wifi').catch(() => null),
      api<CheckinSheetDto>('GET', '/checkin-sheet').catch(() => null), api<{ publicUrl: string }>('GET', '/settings/cancel-policy').catch(() => null)]);
    return { sheet, wifi, bonName: print?.bonPrinter ?? null, publicUrl: policy?.publicUrl ?? '' };
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
  const bonName = data?.bonName ?? null;
  const save = async () => {
    const a = checkinSheetInput.safeParse(v);
    // WLAN nur prüfen und speichern, wenn der Abschnitt sichtbar ist
    const b = w && v.showInfo && v.showWifi ? wifiSettingsInput.safeParse(w) : null;
    const e: Record<string, string> = {};
    if (!a.success) for (const i of a.error.issues) e[String(i.path[0])] = i.message;
    if (b && !b.success) for (const i of b.error.issues) e[`wifi.${String(i.path[0])}`] = i.message;
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      setV(await api<CheckinSheet>('PUT', '/settings/checkin-sheet', a.data));
      if (b?.success) { const r = await api<WifiDto>('PUT', '/network/wifi', b.data); setQr(r.qr); }
      toast('Check-in-Einstellungen gespeichert');
    } catch (x) { toast(x instanceof Error ? x.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <h2>Check-in &amp; Meldeschein</h2>
      <p className="muted">Nach „Anreise bestätigen“ bietet das Programm an, den Meldeschein zu drucken. Gedruckt wird wahlweise als A4-Blatt (Gästeinformationen unten zum Abtrennen) oder auf dem Bondrucker (ein Bon Meldeschein, ein Bon für den Gast mit WLAN-Zugang, QR-Code und Hausinformationen).</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.autoCheckout} onChange={(e) => setV({ ...v, autoCheckout: e.target.checked })} />
          <span>Bezahlte Gäste am Abreisetag automatisch auschecken<small>Nach der Check-out-Zeit des Hauses (Einstellungen → Haus). Nur wenn alles berechnet und bezahlt ist – sonst bleibt der Gast zur Klärung eingecheckt.</small></span></label>
        <label className="check wide"><input type="checkbox" checked={v.askAfterCheckin} onChange={(e) => setV({ ...v, askAfterCheckin: e.target.checked })} />
          <span>Nach dem Check-in fragen: „Meldeschein drucken?“<small>Ausgeschaltet geht es über „Meldeschein drucken“ in der Reservierung.</small></span></label>
        <div className="field wide"><span className="label">Bevorzugter Druck nach dem Check-in</span>
          <div className="segmented" role="radiogroup" aria-label="Bevorzugter Druck">
            {([['a4', 'A4-Blatt (Gästeinfo zum Abtrennen)'], ['bon', 'Bondrucker (zwei Bons)']] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={v.printMode === k} className={v.printMode === k ? 'on' : ''} onClick={() => setV({ ...v, printMode: k })}>{l}</button>))}
          </div>
          <span className="hint">{bonName ? `Nach dem Check-in stehen beide zur Wahl; die bevorzugte ist hervorgehoben. Bondrucker: ${bonName}.` : 'Für den Bondruck ist noch kein Bondrucker eingerichtet (Einstellungen → Geräte → Drucker).'}</span>
        </div>
        <label className="check wide"><input type="checkbox" checked={v.showInfo} onChange={(e) => setV({ ...v, showInfo: e.target.checked })} />
          <span>Gästeinformationen mitdrucken (WLAN, Hausinformationen)</span></label>
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
        <h3>Gäste-Link (QR-Code zur eigenen Buchung)</h3>
        <label className="check"><input type="checkbox" checked={v.showGuestLink} onChange={(e) => setV({ ...v, showGuestLink: e.target.checked })} />
          <span>Persönlichen Gäste-Link als QR-Code aufdrucken<small>Der Gast scannt ihn und kann während des Aufenthalts Zimmerreinigung wünschen, „heute keine Reinigung“ melden, etwas bestellen (z. B. Handtücher) oder seine Abreise melden. Das erscheint bei Ihnen als Aufgabe im Übergabebuch; bei Reinigungswunsch steht das Zimmer unter „Zu reinigen“. Zum Öffnen gibt der Gast seinen Nachnamen (und, falls hinterlegt, die Postleitzahl) ein.</small></span></label>
        {v.showGuestLink && <>
          <div className="formgrid"><Field label="Text neben dem QR-Code" wide error={errs.guestLinkText}><input value={v.guestLinkText} maxLength={200} onChange={(e) => setV({ ...v, guestLinkText: e.target.value })} /></Field></div>
          {data?.publicUrl
            ? <p className="muted small">Der QR-Code führt zu <code>{data.publicUrl}</code> – erreichbar aus dem Internet.</p>
            : <p className="notice warn small"><b>Noch keine Internet-Adresse eingetragen.</b> Der QR-Code führt dann zu diesem Rechner im Hausnetz. Das klappt nur, wenn das Handy des Gastes im selben Netz ist – in einem getrennten Gäste-WLAN oder über Mobilfunk meist <b>nicht</b>. Zuverlässig funktioniert es erst mit dem Online-Server (Adresse dann unter Einstellungen → Algorithmen → Storno eintragen).</p>}
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
