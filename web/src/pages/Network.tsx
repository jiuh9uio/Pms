import { useState } from 'react';
import type { InternetStatusDto, NetDeviceDto, NetScanDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, fmtDateTime, useLoad, useToast } from '../ui.tsx';

/** Internetverbindung des PMS-Rechners: erreichbar ja/nein, Antwortzeit. */
function InternetCard() {
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<InternetStatusDto>('GET', '/network/status'), [rev]);
  return (
    <section className="card">
      <div className="cardhead"><h2>Internetverbindung</h2><div className="actions"><Button onClick={() => setRev(rev + 1)}>Erneut prüfen</Button></div></div>
      {!data ? <LoadState error={error} loading /> : (
        <>
          <p>{data.online ? <Badge tone="ok">verbunden</Badge> : <Badge tone="danger">keine Verbindung</Badge>}{' '}
            {data.online ? `Antwort aus dem Internet nach ${data.ms} ms.` : data.error} <span className="muted">Geprüft {fmtDateTime(data.checkedAt)}.</span></p>
          <p className="muted small">Adresse dieses Rechners im Hausnetz: {data.addresses.join(', ') || 'keine Netzwerkverbindung'}. Geprüft wird die Verbindung dieses Rechners (eine kurze Anfrage an api.github.com) – nicht die Geschwindigkeit und nicht das Gäste-WLAN.</p>
        </>
      )}
    </section>
  );
}

/** Bereich „Internet“: Verbindung prüfen und Geräte im Hausnetz anzeigen. Für Administratoren und freigegebene Benutzer. */
export function Network() {
  const toast = useToast();
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<NetScanDto>('GET', '/network/devices'), [rev]);
  const [shown, setShown] = useState<NetScanDto | null>(null);
  const [edit, setEdit] = useState<NetDeviceDto | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  if (data && data !== shown) setShown(data);
  const loading = !data || data !== shown || busy;
  const rescan = () => { setBusy(true); setRev((r) => r + 1); setTimeout(() => setBusy(false), 300); };
  const save = async () => {
    if (!edit) return;
    try { await api('PUT', `/network/devices/${edit.mac}`, { name: name.trim() }); toast('Gespeichert'); setEdit(null); setRev((r) => r + 1); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const s = shown;
  const unknown = s?.devices.filter((d) => !d.name && !d.self).length ?? 0;
  return (
    <>
      <PageHeader title="Internet" sub="Internetverbindung und Geräte, die gerade im selben Netz wie dieser Rechner erreichbar sind"
        actions={<Button variant="primary" busy={!s && !error} onClick={rescan}>Neu suchen</Button>} />
      <InternetCard />
      <h2>Geräte im Netz</h2>
      {!s && <LoadState error={error} loading />}
      {!s && !error && <p className="muted">Das Netz wird durchsucht – das dauert einige Sekunden.</p>}
      {s && (
        <>
          {s.note && <p className="notice warn">{s.note}</p>}
          <p className="muted">{s.devices.length} {s.devices.length === 1 ? 'Gerät' : 'Geräte'} gefunden{unknown ? `, davon ${unknown} ohne Namen` : ''} · Netz {s.networks.join(', ') || '–'} · Stand {fmtDateTime(s.scannedAt)}{loading ? ' · sucht …' : ''}</p>
          <div className="tablewrap card flush"><table>
            <thead><tr><th>Name</th><th>IP-Adresse</th><th className="hide-sm">Gerätename im Netz</th><th className="hide-sm">Geräteadresse (MAC)</th><th /></tr></thead>
            <tbody>{s.devices.map((d) => (
              <tr key={d.mac}>
                <td className="strong">{d.self ? 'Dieser Rechner (PMS)' : d.name || <span className="muted">unbenannt</span>} {d.self && d.name && <small className="muted">{d.name}</small>}</td>
                <td className="nowrap">{d.ip}</td><td className="hide-sm">{d.hostname || '–'}</td>
                <td className="hide-sm nowrap"><code>{d.mac}</code> {d.randomMac && <Badge>private Adresse</Badge>}</td>
                <td><button type="button" className="linkbtn" onClick={() => { setEdit(d); setName(d.name); }}>{d.name ? 'umbenennen' : 'benennen'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="muted small">
            Gefunden werden Geräte, die im selben Netz wie dieser Rechner sind und auf Netzwerkebene antworten. <b>Nicht sichtbar</b> sind Geräte in einem getrennten Gäste-WLAN,
            Geräte hinter einer Abschottung des Routers („Geräte dürfen untereinander nicht kommunizieren“) und Geräte im Ruhezustand. Die vollständige Liste führt nur der Router selbst.
            Zu sehen sind Geräte, keine Personen: Handys melden sich meist mit einer zufälligen „privaten Adresse“, die sich je WLAN und teils regelmäßig ändert.
            Es wird kein Datenverkehr mitgelesen; gespeichert werden nur die Namen, die Sie hier vergeben – keine Verlaufsliste.
            Geräteadressen von Gästen und Mitarbeitenden können personenbezogene Daten sein; bitte nur zur Betreuung des eigenen Netzes verwenden.
          </p>
        </>
      )}
      {edit && (
        <Dialog title={`Gerät ${edit.ip} benennen`} onClose={() => setEdit(null)}
          footer={<><Button onClick={() => setEdit(null)}>Abbrechen</Button><Button variant="primary" onClick={() => void save()}>Speichern</Button></>}>
          <form className="formgrid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="Name" wide hint="z. B. Kasse, Drucker Rezeption, Tablet Küche – leer lassen, um den Namen zu entfernen"><input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <p className="muted small wide">Der Name hängt an der Geräteadresse {edit.mac}. {edit.randomMac && 'Dieses Gerät verwendet eine private Adresse; ändert sie sich, erscheint es wieder als unbenannt.'}</p>
          </form>
        </Dialog>
      )}
    </>
  );
}
