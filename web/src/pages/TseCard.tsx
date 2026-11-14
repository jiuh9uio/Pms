import { useEffect, useState } from 'react';
import { tseSettingsInput, tseSignInput, type TseInfoDto, type TseSettings, type TseSignResult } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Badge, Button, Field, LoadState, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

const yesNo = (v: boolean | null, yes: string, no: string) => (v == null ? <Badge>unbekannt</Badge> : v ? <Badge tone="ok">{yes}</Badge> : <Badge tone="warn">{no}</Badge>);
const n = (v: number | null) => (v == null ? '–' : v.toLocaleString('de-DE'));
const deDay = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : iso || '–');
const STATE: Record<string, string> = { INITIALIZED: 'in Betrieb genommen', UNINITIALIZED: 'noch nicht in Betrieb genommen', DECOMMISSIONED: 'außer Betrieb – nicht mehr verwendbar' };

/** TSE (Epson-Stick): Verbindung einrichten, Daten anzeigen, Selbsttest, Datenblatt drucken, Zertifikat speichern. */
export function TseCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<TseSettings>('GET', '/settings/tse'));
  const [v, setV] = useState<{ enabled: boolean; host: string; port: string } | null>(null);
  const [info, setInfo] = useState<TseInfoDto | null>(null);
  const [busy, setBusy] = useState<'' | 'read' | 'test' | 'print'>('');
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (data) setV({ enabled: data.enabled, host: data.host, port: String(data.port) }); }, [data]);
  const f = useSubmit(tseSettingsInput, async (d) => { await api('PUT', '/settings/tse', d); toast('TSE-Einstellungen gespeichert'); });
  if (!v) return <section className="card"><h2>TSE</h2><LoadState error={error} loading /></section>;
  const payload = () => ({ enabled: v.enabled, host: v.host.trim(), port: Number(v.port) });
  const act = async (what: 'read' | 'test' | 'print') => {
    setBusy(what); setFail(null);
    try {
      await api('PUT', '/settings/tse', tseSettingsInput.parse({ ...payload(), enabled: true }));
      setV({ ...v, enabled: true });
      if (what === 'read') setInfo(await api<TseInfoDto>('GET', '/tse/info'));
      else if (what === 'test') { setInfo(await api<TseInfoDto>('POST', '/tse/selftest', {})); toast('Selbsttest bestanden'); }
      else { await api('POST', '/tse/print', {}); toast('TSE-Datenblatt gedruckt'); }
    } catch (e) { setFail(e instanceof Error ? e.message : 'Bitte die Eingaben prüfen'); }
    setBusy('');
  };
  const savePem = () => {
    if (!info?.certificatePem) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([info.certificatePem], { type: 'application/x-pem-file' }));
    a.download = `tse-zertifikat-${info.serialNumberHex.slice(0, 12)}.pem`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const used = info?.capacityBlocks ? Math.round(((info.usedBlocks ?? 0) / info.capacityBlocks) * 100) : null;
  return (
    <>
      <form className="card" onSubmit={(e) => void f.submit(payload(), e)} noValidate>
        <h2>TSE (Epson)</h2>
        <p className="notice warn"><b>Lesen, Selbsttest und Datenblatt zeichnen nichts in der TSE auf</b> – nur die Test-Signatur weiter unten schreibt einen Eintrag. Zahlungen im Programm werden weiterhin nicht mit der TSE signiert. Umgesetzt nach Epsons Handbüchern und nur gegen eine nachgebaute Schnittstelle getestet, noch nicht mit einem echten Stick.</p>
        <p className="muted">Voraussetzung: Auf dem Rechner, an dem der Stick steckt, ist der „Epson TSE Driver“ (für Windows) installiert und läuft. Steckt der Stick an diesem Rechner, bleibt die Adresse 127.0.0.1.</p>
        <div className="formgrid cols3">
          <Field label="Adresse des Rechners mit der TSE" error={f.errors.host} hint="dieser Rechner: 127.0.0.1"><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} inputMode="decimal" /></Field>
          <Field label="Port" error={f.errors.port} hint="bei Epson 8009"><input value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} inputMode="numeric" /></Field>
        </div>
        {fail && <p className="notice danger" role="alert">{fail}</p>}
        <div className="formactions">
          <Button busy={busy === 'read'} disabled={busy !== ''} variant="primary" onClick={() => void act('read')}>TSE-Daten lesen</Button>
          <Button busy={busy === 'test'} disabled={busy !== ''} onClick={() => { if (window.confirm('Selbsttest der TSE starten? Das kann bis zu einer Minute dauern. Währenddessen sollte keine Kasse auf die TSE zugreifen.')) void act('test'); }}>Selbsttest ausführen</Button>
          <Button busy={busy === 'print'} disabled={busy !== ''} onClick={() => void act('print')}>Datenblatt auf Bon drucken</Button>
          <Button type="submit" busy={f.busy} disabled={busy !== ''}>Speichern</Button>
        </div>
        {busy === 'test' && <p className="muted small">Der Selbsttest läuft – bitte warten, das kann bis zu einer Minute dauern.</p>}
        <p className="muted small">Diese drei Schaltflächen verwenden nur Befehle ohne Anmeldung: Es wird keine PIN gebraucht und es werden keine PIN-Versuche verbraucht. Benutzt gerade ein anderes Programm (z. B. Ihre Kassensoftware) die TSE, kann das Lesen abgelehnt werden.</p>
      </form>
      {info && (
        <section className="card">
          <div className="cardhead"><h2>Daten der TSE</h2><p className="muted">gelesen {fmtDateTime(info.readAt)}</p></div>
          <table className="kv"><tbody>
            <tr><th>Modell</th><td>{info.vendorType || '–'}</td></tr>
            <tr><th>Seriennummer</th><td><code className="wrapcode">{info.serialNumberHex || '–'}</code></td></tr>
            <tr><th>BSI-Zertifizierung</th><td>{info.description || '–'}</td></tr>
            <tr><th>Zustand</th><td>{STATE[info.initializationState] ?? (info.initializationState || '–')}</td></tr>
            <tr><th>Selbsttest</th><td>{yesNo(info.hasPassedSelfTest, 'bestanden', 'noch nicht ausgeführt')}{info.timeUntilNextSelfTest != null && info.hasPassedSelfTest ? <span className="muted"> · nächster nötig in {Math.floor(info.timeUntilNextSelfTest / 3600)} Std.</span> : null}</td></tr>
            <tr><th>Uhrzeit in der TSE</th><td>{yesNo(info.hasValidTime, 'gesetzt', 'nicht gesetzt')} <span className="muted small">(setzt die Kassensoftware beim Start)</span></td></tr>
            <tr><th>Entsperrt</th><td>{yesNo(info.unlocked, 'ja', 'nein')}</td></tr>
            <tr><th>Zertifikat gültig bis</th><td>{deDay(info.certificateExpirationDate)}</td></tr>
            <tr><th>Signaturen</th><td>{n(info.createdSignatures)} erzeugt · {n(info.remainingSignatures)} übrig</td></tr>
            <tr><th>Angemeldete Kassen</th><td>{n(info.registeredClients)} von {n(info.maxRegisteredClients)}</td></tr>
            <tr><th>Offene Vorgänge</th><td>{n(info.startedTransactions)}</td></tr>
            <tr><th>Speicher</th><td>{used == null ? '–' : `${used} % belegt`}{info.healthStatus && <> · Zustand des Speichers: {info.healthStatus === 'PASS' ? <Badge tone="ok">in Ordnung</Badge> : <Badge tone="danger">{info.healthStatus}</Badge>}</>}</td></tr>
            <tr><th>Signaturverfahren</th><td>{info.signatureAlgorithm || '–'}</td></tr>
            <tr><th>Öffentlicher Schlüssel</th><td><code className="wrapcode">{info.publicKeyBase64 || '–'}</code></td></tr>
            <tr><th>Zertifikat</th><td>{info.certificatePem ? <>Fingerabdruck SHA-256: <code className="wrapcode">{info.certificateFingerprint}</code><br /><button type="button" className="linkbtn" onClick={savePem}>Zertifikat als Datei speichern (.pem)</button></> : info.certificateNote || 'nicht lesbar'}</td></tr>
          </tbody></table>
          <p className="muted small">Seriennummer, BSI-Zertifizierung und Gültigkeit werden unter anderem für die Meldung der Kasse beim Finanzamt gebraucht. Welche Angaben dort einzutragen sind, klärt die Steuerberatung.</p>
        </section>
      )}
      <SignCard onDone={() => void act('read')} />
    </>
  );
}

/** Test-Signatur: ein gekennzeichneter Testvorgang wird in der TSE aufgezeichnet und signiert. */
function SignCard({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ clientId: '', pin: '', secretKey: 'EPSONKEY', print: false });
  const [res, setRes] = useState<TseSignResult | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const f = useSubmit(tseSignInput, async (d) => {
    setFail(null); setRes(null);
    if (!window.confirm('Test-Signatur jetzt erzeugen?\n\nDer Testvorgang wird dauerhaft in der TSE gespeichert und lässt sich nicht löschen. Eine falsche PIN verbraucht einen von drei Versuchen.')) return;
    try {
      const r = await api<TseSignResult>('POST', '/tse/test-signature', d);
      setRes(r); setV((x) => ({ ...x, pin: '' })); toast('Test-Signatur erzeugt'); onDone();
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); setV((x) => ({ ...x, pin: '' })); }
  });
  const time = (iso: string) => (iso ? fmtDateTime(iso) : '–');
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Test-Signatur</h2>
      <p className="notice warn"><b>Das schreibt in die TSE.</b> Das Programm meldet sich mit Ihrer Zeit-PIN an, stellt die Uhr der TSE, zeichnet einen Vorgang der Art „SonstigerVorgang“ mit dem Inhalt „PMS Testsignatur - kein Umsatz“ auf und meldet sich wieder ab. Der Eintrag bleibt dauerhaft in der TSE und erscheint in einem späteren Export. Mit einem echten Stick noch nicht erprobt.</p>
      <p className="muted">Voraussetzung: Die TSE ist in Betrieb genommen und die Kassen-Kennung ist darin angemeldet. PIN und Schlüssel werden nur für diesen einen Vorgang verwendet und nirgends gespeichert.</p>
      <div className="formgrid cols3">
        <Field label="Kassen-Kennung (Client-ID)" error={f.errors.clientId} hint="so, wie sie in der TSE angemeldet wurde"><input value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} autoComplete="off" /></Field>
        <Field label="Zeit-PIN (TimeAdmin)" error={f.errors.pin} hint="5 Zeichen · nach 3 Fehlversuchen gesperrt"><input type="password" value={v.pin} onChange={(e) => setV({ ...v, pin: e.target.value })} autoComplete="off" maxLength={5} /></Field>
        <Field label="Geheimer Schlüssel" error={f.errors.secretKey} hint="nur ändern, wenn er umgestellt wurde"><input value={v.secretKey} onChange={(e) => setV({ ...v, secretKey: e.target.value })} autoComplete="off" maxLength={8} /></Field>
        <label className="check wide"><input type="checkbox" checked={v.print} onChange={(e) => setV({ ...v, print: e.target.checked })} /><span>Ergebnis auf dem Bondrucker drucken</span></label>
      </div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Test-Signatur erzeugen</Button></div>
      {res && (
        <>
          <p className="notice"><b>Die TSE hat signiert.</b>{res.printError ? ` Der Ausdruck ist gescheitert: ${res.printError}` : res.printed ? ' Das Ergebnis wurde gedruckt.' : ''}</p>
          <table className="kv"><tbody>
            <tr><th>Transaktionsnummer</th><td>{n(res.transactionNumber)}</td></tr>
            <tr><th>Signaturzähler</th><td>{n(res.signatureCounter)}</td></tr>
            <tr><th>Beginn</th><td>{time(res.startTime)}</td></tr>
            <tr><th>Ende</th><td>{time(res.finishTime)}</td></tr>
            <tr><th>Vorgangsart</th><td>{res.processType}</td></tr>
            <tr><th>Inhalt</th><td>{res.processData}</td></tr>
            <tr><th>Kassen-Kennung</th><td>{res.clientId}</td></tr>
            <tr><th>Seriennummer der TSE</th><td><code className="wrapcode">{res.serialNumberHex}</code></td></tr>
            <tr><th>Signatur</th><td><code className="wrapcode">{res.signatureBase64}</code></td></tr>
          </tbody></table>
        </>
      )}
    </form>
  );
}
