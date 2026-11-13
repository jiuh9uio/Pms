import { Link } from 'react-router-dom';
import { ROLE_LABEL, hasModule, type Module } from '../../../src/shared/schemas.js';
import { useAuth, useLogout } from '../App.tsx';

interface Tile { to: string; title: string; text: string; icon: string; admin?: boolean; module?: Module }
const TILES: Tile[] = [
  { to: '/hotel', title: 'Hotel', text: 'Übersicht, Belegungsplan, Reservierungen, Gäste', icon: '▦', module: 'hotel' },
  { to: '/kontrollen', title: 'Kontrollen', text: 'Hygieneamt, Finanzamt und weitere: Unterlagen, Temperaturprotokolle, Besuche', icon: '✓', module: 'kontrollen' },
  { to: '/benutzer', title: 'Verwaltung', text: 'Benutzer, Änderungsprotokoll, Einstellungen', icon: '⚙', admin: true },
  { to: '/konto', title: 'Mein Konto', text: 'Passwort, Darstellung', icon: '◐', admin: true },
];

/** Startmenü nach der Anmeldung: von hier geht es in die einzelnen Bereiche. */
export function Launcher() {
  const { user } = useAuth();
  const logout = useLogout();
  const tiles = TILES.filter((t) => (!t.admin || user.role === 'admin') && (!t.module || hasModule(user, t.module)));
  return (
    <div className="launcher">
      <header>
        <div className="brand big"><span className="mark">S</span><span>Schützenhaus<small>Hotel &amp; Restaurant</small></span></div>
        <p className="muted">{user.name} · {ROLE_LABEL[user.role]} <button type="button" className="btn" onClick={() => void logout()}>Abmelden</button></p>
      </header>
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
