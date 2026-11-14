import { useEffect, useState } from 'react';
import { fritzSettingsInput, wifiSettingsInput, type FritzInfoDto, type FritzSettingsDto, type InternetStatusDto, type NetDeviceDto, type NetOutagesDto, type NetScanDto, type WifiDto } from '../../../src/shared/schemas.js';
import { useAuth } from '../App.tsx';
import { api } from '../api.ts';
import { netAlertOn, setNetAlertOn } from '../NetAlert.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, fmtDateTime, printOnly, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

const duration = (a: string, b: string) => {
  const min = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
};

const uptime = (sec: number) => { const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return d ? `${d} Tg. ${h} Std.` : h ? `${h} Std. ${m} Min.` : `${m} Min.`; };

/** FRITZ!Box: Internetverbindung neu aufbauen oder die Box neu starten – direkt aus dem Programm. */
function FritzCard() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<FritzSettingsDto>('GET', '/network/fritz'), [rev]);
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ host: '', port: '49000', user: '', password: '', auto: false, autoAfterMin: '5' });
  const [info, setInfo] = useState<FritzInfoDto | null>(null);
  const [busy, setBusy] = useState<'' | 'info' | 'reconnect' | 'reboot'>('');
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (data) setV({ host: data.host, port: String(data.port), user: data.user, password: '', auto: data.auto, autoAfterMin: String(data.autoAfterMin) }); }, [data]);
  const f = useSubmit(fritzSettingsInput, async (d) => { await api('PUT', '/network/fritz', d); toast('FRITZ!Box gespeichert'); setEdit(false); setRev(rev + 1); });
  const ready = !!data && data.enabled && !!data.host && data.hasPassword;
  const run = async (what: 'info' | 'reconnect' | 'reboot') => {
    if (what === 'reconnect' && !window.confirm('Internetverbindung jetzt trennen und neu aufbauen? Das Internet ist dabei für etwa eine Minute weg.')) return;
    if (what === 'reboot' && !window.confirm('FRITZ!Box jetzt neu starten?\n\nInternet, WLAN und Telefon fallen für einige Minuten aus. Laufende Kartenzahlungen und Telefonate werden unterbrochen.')) return;
    setBusy(what); setFail(null);
    try {
      if (what === 'info') setInfo(await api<FritzInfoDto>('GET', '/network/fritz/info'));
      else { await api('POST', '/network/fritz/action', { action: what }); toast(what === 'reboot' ? 'Die FRITZ!Box startet neu – das dauert einige Minuten' : 'Die Verbindung wird neu aufgebaut'); setInfo(null); }
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy('');
  };
  if (!data) return <section className="card"><h2>FRITZ!Box</h2><LoadState error={error} loading /></section>;
  if (!data.available) return <section className="card"><h2>FRITZ!Box</h2><p className="muted">Das Programm läuft auf einem Server im Internet. Die FRITZ!Box lässt sich nur steuern, wenn es auf einem Rechner im Haus läuft.</p></section>;
  return (
    <section className="card">
      <div className="cardhead"><div><h2>FRITZ!Box</h2><p className="muted">Wenn das Internet hängt: Verbindung neu aufbauen oder die Box neu starten, ohne an den Router zu gehen.</p></div>
        <div className="actions">{isAdmin && !edit && <Button onClick={() => setEdit(true)}>{ready ? 'Ändern' : 'Einrichten'}</Button>}</div></div>
      {edit ? (
        <form onSubmit={(e) => void f.submit({ enabled: true, host: v.host, port: Number(v.port), user: v.user, password: v.password, auto: v.auto, autoAfterMin: Number(v.autoAfterMin) }, e)} noValidate>
          <div className="formgrid">
            <Field label="Adresse der FRITZ!Box" error={f.errors.host} hint="meist 192.168.178.1"><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} inputMode="decimal" /></Field>
            <Field label="Port" error={f.errors.port} hint="bei der FRITZ!Box 49000"><input value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} inputMode="numeric" /></Field>
            <Field label="FRITZ!Box-Benutzer" error={f.errors.user} hint="unter System → FRITZ!Box-Benutzer; braucht das Recht „FRITZ!Box Einstellungen“"><input value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} autoComplete="off" /></Field>
            <Field label="Kennwort" error={f.errors.password} hint={data.hasPassword ? 'gespeichert – leer lassen zum Behalten' : undefined}><input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" /></Field>
            <label className="check wide"><input type="checkbox" checked={v.auto} onChange={(e) => setV({ ...v, auto: e.target.checked })} /><span>Bei Ausfall von selbst zurücksetzen<small>Erst wird die Internetverbindung neu aufgebaut. Bleibt das Internet danach noch einmal so lange weg, wird die Box einmal neu gestartet – höchstens zweimal in 24 Stunden.</small></span></label>
            {v.auto && <Field label="Wartezeit in Minuten" error={f.errors.autoAfterMin} hint="so lange muss das Internet weg sein, bevor etwas geschieht (mindestens 3)"><input value={v.autoAfterMin} onChange={(e) => setV({ ...v, autoAfterMin: e.target.value })} inputMode="numeric" /></Field>}
          </div>
          <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button><Button onClick={() => setEdit(false)}>Abbrechen</Button></div>
          <p className="muted small">In der FRITZ!Box muss unter Heimnetz → Netzwerk → Netzwerkeinstellungen „Zugriff für Anwendungen zulassen“ eingeschaltet sein. Am besten einen eigenen Benutzer für das Programm anlegen. Das Kennwort wird verschlüsselt gespeichert.</p>
        </form>
      ) : !ready ? <p className="muted">Noch nicht eingerichtet.{isAdmin ? '' : ' Das richtet der Administrator ein.'}</p> : (
        <>
          <div className="formactions">
            <Button busy={busy === 'info'} disabled={busy !== ''} onClick={() => void run('info')}>Zustand abfragen</Button>
            <Button variant="primary" busy={busy === 'reconnect'} disabled={busy !== ''} onClick={() => void run('reconnect')}>Internetverbindung neu aufbauen</Button>
            <Button variant="danger" busy={busy === 'reboot'} disabled={busy !== ''} onClick={() => void run('reboot')}>FRITZ!Box neu starten</Button>
          </div>
          <p>{data.auto ? <><Badge tone="ok">Automatik ein</Badge> Nach {data.autoAfterMin} Minuten ohne Internet baut das Programm die Verbindung neu auf, nach weiteren {data.autoAfterMin} Minuten startet es die Box einmal neu.</> : <><Badge>Automatik aus</Badge> Zurückgesetzt wird nur auf Knopfdruck.</>}</p>
          {fail && <p className="notice danger" role="alert">{fail}</p>}
          {info && <p>{info.model || 'FRITZ!Box'}{info.version && ` · Version ${info.version}`}{info.uptimeSec != null && ` · läuft seit ${uptime(info.uptimeSec)}`}
            {info.connection && <> · Internet: {info.connection === 'Connected' ? <Badge tone="ok">verbunden</Badge> : <Badge tone="danger">{info.connection}</Badge>}</>}{info.externalIp && ` · Adresse im Internet ${info.externalIp}`}</p>}
          <p className="muted small">„Neu aufbauen“ trennt nur die Internetverbindung; die Box wählt sich sofort wieder ein (hilft oft schon). „Neu starten“ startet die ganze Box – WLAN und Telefon sind dann einige Minuten weg. Beides wird im Protokoll vermerkt. Hilft auch der Neustart nicht, liegt die Störung beim Anbieter.</p>
        </>
      )}
    </section>
  );
}

/** Gäste-WLAN: Zugangsdaten hinterlegen (Administrator) und als QR-Code zum Aushängen drucken. */
function WifiCard() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user.role === 'admin';
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<WifiDto>('GET', '/network/wifi'), [rev]);
  const [v, setV] = useState<{ ssid: string; password: string; open: boolean; note: string } | null>(null);
  const f = useSubmit(wifiSettingsInput, async (d) => { await api('PUT', '/network/wifi', d); toast('Gäste-WLAN gespeichert'); setV(null); setRev(rev + 1); });
  return (
    <section className="card printable wifi-print">
      <div className="cardhead"><h2>Gäste-WLAN</h2>
        <div className="actions">
          {data?.qr && <Button onClick={() => printOnly('wifi')}>Aushang drucken</Button>}
          {isAdmin && data && !v && <Button onClick={() => setV({ ssid: data.ssid, password: data.password, open: data.open, note: data.note })}>{data.ssid ? 'Ändern' : 'Einrichten'}</Button>}
        </div></div>
      {!data ? <LoadState error={error} loading /> : v ? (
        <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
          <Field label="WLAN-Name (SSID)" error={f.errors.ssid} hint="genau so, wie er am Handy erscheint"><input value={v.ssid} onChange={(e) => setV({ ...v, ssid: e.target.value })} autoCapitalize="none" spellCheck={false} /></Field>
          <Field label="WLAN-Passwort" error={f.errors.password}><input value={v.password} disabled={v.open} onChange={(e) => setV({ ...v, password: e.target.value })} autoCapitalize="none" spellCheck={false} autoComplete="off" /></Field>
          <label className="check wide"><input type="checkbox" checked={v.open} onChange={(e) => setV({ ...v, open: e.target.checked })} /><span>Offenes WLAN ohne Passwort</span></label>
          <Field label="Hinweis auf dem Aushang" error={f.errors.note} wide hint="z. B. Kostenlos für unsere Gäste"><input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
          <div className="formactions wide"><Button onClick={() => setV(null)}>Abbrechen</Button><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
        </form>
      ) : !data.qr ? (
        <p className="muted">{isAdmin ? 'Tragen Sie Name und Passwort Ihres Gäste-WLANs ein – das Programm erzeugt daraus einen QR-Code zum Aushängen. Gäste scannen ihn und sind verbunden, ohne das Passwort abzutippen.' : 'Das Gäste-WLAN ist noch nicht hinterlegt. Das richtet der Administrator ein.'}</p>
      ) : (
        <>
          <h1 className="wifi-title">WLAN · {data.hotelName}</h1>
          <div className="wificard">
            <img src={data.qr} alt="QR-Code für das Gäste-WLAN" width={200} height={200} />
            <dl><dt>WLAN</dt><dd>{data.ssid}</dd><dt>Passwort</dt><dd>{data.open ? 'ohne' : data.password}</dd>{data.note && <><dt /><dd style={{ fontWeight: 400 }}>{data.note}</dd></>}</dl>
          </div>
          <p className="muted small">Gäste scannen den Code mit der Handy-Kamera und werden mit dem WLAN verbunden. Das Passwort steht im Klartext in diesem Programm und auf dem Aushang – hier nur das Gäste-WLAN eintragen, nicht das interne Netz mit Kasse und PMS.</p>
        </>
      )}
    </section>
  );
}

/** Internetverbindung des PMS-Rechners: erreichbar ja/nein, Antwortzeit. */
function InternetCard() {
  const [rev, setRev] = useState(0);
  const { data, error } = useLoad(() => api<InternetStatusDto>('GET', '/network/status'), [rev]);
  const log = useLoad(() => api<NetOutagesDto>('GET', '/network/outages'), [rev]).data;
  const [hint, setHint] = useState(netAlertOn);
  const [perm, setPerm] = useState(() => ('Notification' in window ? Notification.permission : 'unsupported'));
  const allow = async () => { try { setPerm(await Notification.requestPermission()); } catch { setPerm('unsupported'); } };
  return (
    <section className="card">
      <div className="cardhead"><h2>Internetverbindung</h2><div className="actions"><Button onClick={() => setRev(rev + 1)}>Erneut prüfen</Button></div></div>
      {!data ? <LoadState error={error} loading /> : (
        <>
          <p>{data.online ? <Badge tone="ok">verbunden</Badge> : <Badge tone="danger">keine Verbindung</Badge>}{' '}
            {data.online ? `Antwort aus dem Internet nach ${data.ms} ms.` : data.error} <span className="muted">Geprüft {fmtDateTime(data.checkedAt)}.</span></p>
          <p className="muted small">Adresse dieses Rechners im Hausnetz: {data.addresses.join(', ') || 'keine Netzwerkverbindung'}. Geprüft wird die Verbindung dieses Rechners (eine kurze Anfrage an api.github.com) – nicht die Geschwindigkeit und nicht das Gäste-WLAN.</p>
          <h3>Hinweis bei Ausfall</h3>
          <label className="check"><input type="checkbox" checked={hint} onChange={(e) => { setHint(e.target.checked); setNetAlertOn(e.target.checked); }} /><span>Auf diesem Gerät ein Hinweisfenster zeigen, wenn das Internet ausfällt<small>erscheint im Programm, solange es in einem Browserfenster geöffnet ist; dazu ein roter Balken bis das Internet wieder da ist</small></span></label>
          {hint && perm === 'default' && <p><Button onClick={() => void allow()}>Zusätzlich Meldung von Windows erlauben</Button> <span className="muted small">zeigt die Meldung auch, wenn gerade ein anderes Fenster im Vordergrund ist</span></p>}
          {hint && perm === 'granted' && <p className="muted small">Die Meldung von Windows ist für diesen Browser erlaubt.</p>}
          {hint && perm === 'denied' && <p className="muted small">Die Meldung von Windows ist in diesem Browser gesperrt; sie lässt sich nur in den Browser-Einstellungen wieder erlauben. Das Hinweisfenster im Programm erscheint trotzdem.</p>}
          {log && (
            <>
              <h3>Ausfälle</h3>
              {log.outages.length === 0 ? <p className="muted">Bisher kein Ausfall aufgezeichnet.</p> : (
                <div className="tablewrap"><table>
                  <thead><tr><th>Beginn</th><th>Ende</th><th className="num">Dauer</th></tr></thead>
                  <tbody>{log.outages.map((o) => (
                    <tr key={o.id}><td className="nowrap">{fmtDateTime(o.startedAt)}</td>
                      <td className="nowrap">{o.endedAt ? (o.uncertain ? 'unbekannt (Programm wurde beendet)' : fmtDateTime(o.endedAt)) : <Badge tone="danger">dauert an</Badge>}</td>
                      <td className="num nowrap">{o.endedAt && !o.uncertain ? duration(o.startedAt, o.endedAt) : '–'}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
              <p className="muted small">Aufgezeichnet wird nur, solange das Programm läuft: Prüfung jede Minute (api.github.com und cloudflare.com), ein Ausfall zählt ab der zweiten fehlgeschlagenen Prüfung. Kürzere Aussetzer fehlen; die Zeiten sind auf etwa eine Minute genau. Gezeigt werden die letzten 50 Ausfälle.</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Bereich „Internet“: Verbindung prüfen und Geräte im Hausnetz anzeigen. Für Administratoren und freigegebene Benutzer. */
export const NET_TABS = [['verbindung', 'Internetverbindung'], ['wlan', 'Gäste-WLAN'], ['geraete', 'Geräte im Netz']] as const;

export function Network() {
  const { current, bar } = useTabs(NET_TABS);
  return (
    <>
      <PageHeader title="Internet" sub="Internetverbindung und Geräte, die gerade im selben Netz wie dieser Rechner erreichbar sind" />
      {bar}
      {current === 'verbindung' && <><InternetCard /><FritzCard /></>}
      {current === 'wlan' && <WifiCard />}
      {current === 'geraete' && <DeviceList />}
    </>
  );
}

/** Geräte, die gerade im selben Netz wie der PMS-Rechner erreichbar sind. */
function DeviceList() {
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
  const found = s?.devices.filter((d) => d.online).length ?? 0;
  const off = s?.devices.filter((d) => !d.online).length ?? 0;
  return (
    <>
      <div className="cardhead"><h2>Geräte im Netz</h2><div className="actions"><Button variant="primary" busy={!s && !error} onClick={rescan}>Neu suchen</Button></div></div>
      {!s && <LoadState error={error} loading />}
      {!s && !error && <p className="muted">Das Netz wird durchsucht – das dauert einige Sekunden.</p>}
      {s && (
        <>
          {s.note && <p className="notice warn">{s.note}</p>}
          <p className="muted">{found} {found === 1 ? 'Gerät' : 'Geräte'} gefunden{unknown ? `, davon ${unknown} ohne Namen` : ''}{off ? ` · ${off} benannte${off === 1 ? 's Gerät' : ' Geräte'} nicht erreichbar` : ''}{s.gateway && <> · <a href={`http://${s.gateway}`} target="_blank" rel="noopener noreferrer">Router-Oberfläche öffnen ({s.gateway})</a></>} · Netz {s.networks.join(', ') || '–'} · Stand {fmtDateTime(s.scannedAt)}{loading ? ' · sucht …' : ''}</p>
          <div className="tablewrap card flush"><table>
            <thead><tr><th>Name</th><th>IP-Adresse</th><th className="hide-sm">Gerätename im Netz</th><th className="hide-sm">Geräteadresse (MAC)</th><th /></tr></thead>
            <tbody>{s.devices.map((d) => (
              <tr key={d.mac} className={d.online ? undefined : 'faded'}>
                <td className="strong">{d.self ? 'Dieser Rechner (PMS)' : d.name || <span className="muted">unbenannt</span>} {d.self && d.name && <small className="muted">{d.name}</small>}</td>
                <td className="nowrap">{d.online ? <>{d.ip}{d.ip === s.gateway && <> <Badge tone="accent">Router</Badge></>}</> : <Badge tone="warn">nicht erreichbar</Badge>}</td><td className="hide-sm">{d.hostname || '–'}</td>
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
        <Dialog title={`Gerät ${edit.ip || edit.name} benennen`} onClose={() => setEdit(null)}
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
