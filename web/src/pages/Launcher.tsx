import { Link } from 'react-router-dom';
import { ROLE_LABEL, hasModule, type Module } from '../../../src/shared/schemas.js';
import { useAuth, useLogout } from '../App.tsx';
import { api } from '../api.ts';
import { useLoad } from '../ui.tsx';
import { backupWarning, type BackupStatus } from './BackupCard.tsx';
import type { UpdateStatus } from './UpdateCard.tsx';

interface Tile { to: string; title: string; text: string; icon: string; admin?: boolean; module?: Module }
const TILES: Tile[] = [
  { to: '/hotel', title: 'Hotel', text: 'Übersicht, Belegungsplan, Reservierungen, Gäste, Rechnungen', icon: '▦', module: 'hotel' },
  { to: '/kontrollen', title: 'Kontrollen', text: 'Hygieneamt, Finanzamt und weitere: Unterlagen, Temperaturprotokolle, Besuche', icon: '✓', module: 'kontrollen' },
  { to: '/erechnung', title: 'E-Rechnung', text: 'PDF-Rechnungen in ZUGFeRD umwandeln und per E-Mail versenden', icon: '✉', module: 'erechnung' },
  { to: '/benutzer', title: 'Verwaltung', text: 'Benutzer, Geräte im Netz, Änderungsprotokoll, Einstellungen', icon: '⚙', admin: true },
  { to: '/konto', title: 'Mein Konto', text: 'Passwort, Darstellung', icon: '◐', admin: true },
];

/** Startmenü nach der Anmeldung: von hier geht es in die einzelnen Bereiche. */
export function Launcher() {
  const { user } = useAuth();
  const logout = useLogout();
  // Hinweis auf ein neues Programm-Update – nur für Administratoren
  const upd = useLoad(() => (user.role === 'admin' ? api<UpdateStatus>('GET', '/update/status') : Promise.resolve(null))).data;
  const bak = useLoad(() => (user.role === 'admin' ? api<BackupStatus>('GET', '/backup/status') : Promise.resolve(null))).data;
  const bakWarn = bak ? backupWarning(bak) : null;
  const tiles = TILES.filter((t) => (!t.admin || user.role === 'admin') && (!t.module || hasModule(user, t.module)));
  return (
    <div className="launcher">
      <header>
        <div className="brand big"><span className="mark">S</span><span>Schützenhaus<small>Hotel &amp; Restaurant</small></span></div>
        <p className="muted">{user.name} · {ROLE_LABEL[user.role]} <button type="button" className="btn" onClick={() => void logout()}>Abmelden</button></p>
      </header>
      {upd?.available && <p className="notice warn">Programm-Update verfügbar: Version {upd.latest}. <Link to="/einstellungen">Jetzt ansehen und einspielen</Link></p>}
      {bakWarn && <p className="notice danger">{bakWarn} <Link to="/einstellungen">Zur Datensicherung</Link></p>}
      <nav className="tiles" aria-label="Bereiche">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <span className="tile-icon" aria-hidden>{t.icon}</span>
            <span className="tile-title">{t.title}</span>
            <span className="tile-text">{t.text}</span>
          </Link>
        ))}
      </nav>
      {tiles.length === 0 && <p className="notice">Für dieses Konto ist noch kein Bereich freigegeben. Bitte den Administrator ansprechen.</p>}
    </div>
  );
}
