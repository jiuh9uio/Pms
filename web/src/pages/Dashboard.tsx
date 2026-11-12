import { Link } from 'react-router-dom';
import type { AuditDto, HotelSettings, TaxRateDto, UserDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { Badge, LoadState, PageHeader, fmtDateTime, useLoad } from '../ui.tsx';
import { describeAudit } from './Audit.tsx';

const USE: Record<string, string> = { lodging: 'Standard für Übernachtung', services: 'Standard für Frühstück und Zusatzleistungen' };

/**
 * Übersicht in Phase 1: zeigt ausschließlich echte Daten aus der Datenbank.
 * Die Betriebskennzahlen (Anreisen, Belegung, Umsatz) kommen mit Phase 2 und 3.
 */
export function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const base = useLoad(async () => {
    const [hotel, rates] = await Promise.all([api<HotelSettings>('GET', '/settings/hotel'), api<TaxRateDto[]>('GET', '/tax-rates')]);
    return { hotel, rates };
  });
  const adminData = useLoad(async () => {
    if (!isAdmin) return null;
    const [users, audit] = await Promise.all([api<UserDto[]>('GET', '/users'), api<{ items: AuditDto[] }>('GET', '/audit?limit=6')]);
    return { users, audit: audit.items };
  }, [isAdmin]);

  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const h = base.data?.hotel;
  const incomplete = h && (!h.street || !h.city || !h.taxNumber);

  return (
    <>
      <PageHeader title={`Guten Tag, ${user.name}`} sub={today} />
      <LoadState error={base.error} loading={!base.data} />
      {base.data && h && (
        <div className="cards">
          <section className="card">
            <h2>Hotel</h2>
            <p className="strong">{h.name}</p>
            <p className="muted">{[h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Noch keine Anschrift hinterlegt'}</p>
            <p className="muted">Check-in ab {h.checkinTime} Uhr · Check-out bis {h.checkoutTime} Uhr</p>
            {incomplete && isAdmin && <p className="notice warn">Stammdaten sind unvollständig (Anschrift, Steuernummer). Sie werden später für Rechnungen benötigt. <Link to="/einstellungen">Jetzt ergänzen</Link></p>}
          </section>
          <section className="card">
            <h2>Steuersätze</h2>
            <ul className="plain">
              {base.data.rates.filter((r) => r.active).map((r) => (
                <li key={r.id}><span><b>{r.ratePercent.toLocaleString('de-DE')} %</b> {r.name}</span>{r.defaultFor && <Badge tone="accent">{USE[r.defaultFor]}</Badge>}</li>
              ))}
            </ul>
            {isAdmin && <p><Link to="/einstellungen">Steuersätze verwalten</Link></p>}
          </section>
          {adminData.data && (
            <>
              <section className="card">
                <h2>Benutzer</h2>
                <p className="kpi">{adminData.data.users.filter((u) => u.active).length}<small>aktive Konten</small></p>
                <p className="muted">{adminData.data.users.filter((u) => u.role === 'admin' && u.active).length} Administrator(en)</p>
                <p><Link to="/benutzer">Benutzer verwalten</Link></p>
              </section>
              <section className="card span2">
                <h2>Letzte Änderungen</h2>
                <ul className="plain">
                  {adminData.data.audit.map((e) => (
                    <li key={e.id}><span>{describeAudit(e)} <span className="muted">· {e.userName}</span></span><span className="muted nowrap">{fmtDateTime(e.at)}</span></li>
                  ))}
                </ul>
                <p><Link to="/protokoll">Gesamtes Protokoll</Link></p>
              </section>
            </>
          )}
          <section className="card span2">
            <h2>Stand des Systems</h2>
            <p className="muted">Fertig ist das technische Fundament (Phase 1): Anmeldung, Benutzer und Rollen, Änderungsprotokoll, Stammdaten und Steuersätze.</p>
            <p className="muted">Noch nicht enthalten und deshalb hier nicht sichtbar: Belegungsplan, Reservierungen, Check-in/Check-out, Gäste (Phase 2) sowie Rechnungen, Zahlungen und Firmen (Phase 3).</p>
          </section>
        </div>
      )}
    </>
  );
}
