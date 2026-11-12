import { Link } from 'react-router-dom';
import { ROLE_LABEL } from '../../../src/shared/schemas.js';
import { useAuth } from '../App.tsx';

interface Tile { to: string; title: string; text: string; icon: string; admin?: boolean }
const TILES: Tile[] = [
  { to: '/hotel', title: 'Hotel', text: 'Übersicht, Belegungsplan, Reservierungen, Gäste', icon: '▦' },
  { to: '/kontrollen', title: 'Kontrollen', text: 'Hygieneamt, Finanzamt und weitere: Unterlagen, Temperaturprotokolle, Besuche', icon: '✓' },
  { to: '/benutzer', title: 'Verwaltung', text: 'Benutzer, Änderungsprotokoll, Einstellungen', icon: '⚙', admin: true },
  { to: '/konto', title: 'Mein Konto', text: 'Passwort, Darstellung, Abmelden', icon: '◐' },
];

/** Startmenü nach der Anmeldung: von hier geht es in die einzelnen Bereiche. */
export function Launcher() {
  const { user } = useAuth();
  return (
    <div className="launcher">
      <header>
        <div className="brand big"><span className="mark">S</span><span>Schützenhaus<small>Hotel &amp; Restaurant</small></span></div>
        <p className="muted">{user.name} · {ROLE_LABEL[user.role]}</p>
      </header>
      <nav className="tiles" aria-label="Bereiche">
        {TILES.filter((t) => !t.admin || user.role === 'admin').map((t) => (
          <Link key={t.to} to={t.to} className="tile">
            <span className="tile-icon" aria-hidden>{t.icon}</span>
            <span className="tile-title">{t.title}</span>
            <span className="tile-text">{t.text}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
