import { useState } from 'react';
import { todayBerlin, type RegistrationRow } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, PageHeader, fmtDateTime, useLoad, useToast } from '../ui.tsx';
import { useAuth } from '../App.tsx';

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/**
 * Meldeschein-Archiv: alle Check-ins mit Nachdruck. Die Angaben kommen aus Reservierung und Gästeprofil (keine eigene Kopie).
 * Zeigt die Aufbewahrungsfrist; gelöscht wird hier nichts.
 */
export function Registrations() {
  const { rev, bump, openBooking } = useData();
  const toast = useToast();
  const { user } = useAuth();
  const today = todayBerlin();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [q, setQ] = useState('');
  const [expired, setExpired] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const qs = new URLSearchParams({ q: q.trim(), expired: expired ? '1' : '0', ...(expired ? {} : { from, to }) }).toString();
  const { data, error } = useLoad(() => api<RegistrationRow[]>('GET', `/registrations?${qs}`), [qs, rev]);
  const all = data ?? [];
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = all.length > 0 && all.every((r) => sel.has(r.bookingId));
  const printSel = () => window.open(`/meldescheine-druck?ids=${[...sel].join(',')}`, '_blank', 'noopener');
  const overdue = (r: RegistrationRow) => r.purged ? null : r.destroyBy < today ? 'danger' : r.keepUntil < today ? 'warn' : null;
  const purge = useLoad(() => api<{ enabled: boolean; lastRun: string | null; lastGuests: number }>('GET', '/registrations/purge'), [rev]);
  const setPurge = async (enabled: boolean) => {
    if (!enabled && !window.confirm('Automatisches Löschen ausschalten? Dann müssen abgelaufene Meldeschein-Angaben von Hand gelöscht werden.')) return;
    try { await api('PUT', '/registrations/purge', { enabled }); toast(enabled ? 'Automatisches Löschen eingeschaltet' : 'Automatisches Löschen ausgeschaltet'); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <>
      <PageHeader title="Meldeschein-Archiv" sub="Alle Check-ins mit ihrem Meldeschein – zum Nachschlagen und Nachdrucken"
        actions={sel.size > 0 ? <Button variant="primary" onClick={printSel}>{sel.size} {sel.size === 1 ? 'Meldeschein' : 'Meldescheine'} drucken</Button> : undefined} />
      <div className="filters regfilters">
        {!expired && <>
          <Field label="Anreise von"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="bis"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </>}
        <Field label="Suche"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, Ort, Zimmer, Reservierung …" /></Field>
        <label className="check"><input type="checkbox" checked={expired} onChange={(e) => { setExpired(e.target.checked); setSel(new Set()); }} /><span>Nur abgelaufene Aufbewahrungsfrist</span></label>
      </div>
      {purge.data && (
        <p className={`notice small${purge.data.enabled ? '' : ' warn'}`}>
          {purge.data.enabled
            ? <>Automatisches Löschen ist <b>an</b>: Ein Jahr nach der Anreise löscht das Programm Geburtsdatum, Staatsangehörigkeit und Ausweisnummer aus dem Gästeprofil, sofern der Gast inzwischen nicht wieder da war oder kommt. Name und Anschrift bleiben (Rechnungen). Papier-Meldescheine bitte weiterhin selbst vernichten.{purge.data.lastRun && <> Zuletzt geprüft {new Date(purge.data.lastRun).toLocaleString('de-DE')}{purge.data.lastGuests ? ` – ${purge.data.lastGuests} Gäste bereinigt` : ''}.</>}</>
            : <>Automatisches Löschen ist <b>aus</b>.</>}
          {user.role === 'admin' && <> <Button onClick={() => void setPurge(!purge.data!.enabled)}>{purge.data.enabled ? 'Ausschalten' : 'Einschalten'}</Button></>}
        </p>
      )}
      <LoadState error={error} loading={!data} />
      {data && (all.length === 0 ? <p className="muted card">{expired ? 'Keine Meldescheine mit abgelaufener Frist.' : 'Keine Check-ins in diesem Zeitraum.'}</p> : (
        <div className="tablewrap card flush">
          <table className="regtable">
            <thead><tr>
              <th className="sel"><input type="checkbox" aria-label="Alle auswählen" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(all.map((r) => r.bookingId)))} /></th>
              <th>Anreise</th><th>Gast</th><th className="hide-sm">Zimmer</th><th className="hide-sm">Angaben</th><th className="hide-sm">Aufbewahren bis</th><th></th>
            </tr></thead>
            <tbody>
              {all.map((r) => {
                const o = overdue(r);
                return (
                  <tr key={r.bookingId} className={sel.has(r.bookingId) ? 'on' : ''}>
                    <td className="sel"><input type="checkbox" aria-label={`${r.guest} auswählen`} checked={sel.has(r.bookingId)} onChange={() => toggle(r.bookingId)} /></td>
                    <td><b>{deDate(r.from)}</b><br /><small className="muted">bis {deDate(r.to)}</small></td>
                    <td><button type="button" className="linkbtn strong" onClick={() => openBooking(r.bookingId)}>{r.guest || '(ohne Namen)'}</button>
                      <br /><small className="muted">{[r.city, r.nationality, `${r.persons} ${r.persons === 1 ? 'Person' : 'Personen'}`, r.number].filter(Boolean).join(' · ')}</small></td>
                    <td className="hide-sm">{r.rooms}</td>
                    <td className="hide-sm">
                      {r.purged ? <Badge tone="neutral">Angaben gelöscht</Badge> : r.missing.length === 0 ? <Badge tone="ok">vollständig</Badge> : <Badge tone="warn">fehlt: {r.missing.join(', ')}</Badge>}
                      {r.onlineAt && <><br /><small className="muted" title={fmtDateTime(r.onlineAt)}>vom Gast online ausgefüllt</small></>}
                    </td>
                    <td className="hide-sm">{deDate(r.keepUntil)}{o && <><br /><Badge tone={o}>{o === 'danger' ? `vernichten war fällig bis ${deDate(r.destroyBy)}` : `Frist abgelaufen – vernichten bis ${deDate(r.destroyBy)}`}</Badge></>}</td>
                    <td className="num"><a className="btn" href={`/meldeschein/${r.bookingId}?info=0`} target="_blank" rel="noopener">Drucken</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {data && all.length >= 500 && <p className="muted small">Es werden höchstens 500 Einträge gezeigt – bitte den Zeitraum eingrenzen.</p>}
      <p className="muted small">
        Die Angaben stammen aus der Reservierung und dem aktuellen Gästeprofil, so wie der Meldeschein gedruckt wird; eine eigene, unveränderliche Kopie wird nicht gespeichert.
        Maßgeblich ist der unterschriebene Meldeschein auf Papier. Aufbewahrung nach § 30 Abs. 4 Bundesmeldegesetz: ein Jahr ab Anreise, danach innerhalb von drei Monaten vernichten –
        bitte selbst prüfen. Das Programm löscht hier nichts automatisch.
      </p>
    </>
  );
}
