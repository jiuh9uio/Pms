import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_LABEL, hasModule, type Module, type OverviewItem } from '../../../src/shared/schemas.js';
import { useAuth, useLogout } from '../App.tsx';
import { api } from '../api.ts';
import { Search } from '../Search.tsx';
import { useLoad } from '../ui.tsx';
import { backupWarning, type BackupStatus } from './BackupCard.tsx';
import type { UpdateStatus } from './UpdateCard.tsx';

interface Tile { to: string; title: string; text: string; icon: string; admin?: boolean; module?: Module }
const TILES: Tile[] = [
  { to: '/hotel', title: 'Hotel', text: 'Übersicht, Belegungsplan, Reservierungen, Gäste, Rechnungen', icon: '▦', module: 'hotel' },
  { to: '/restaurant', title: 'Restaurant', text: 'Tischreservierungen je Tag, Tische verwalten', icon: '◍', module: 'restaurant' },
  { to: '/schnelldruck', title: 'Schnelldruck', text: 'Öffnungszeiten, Telefon, WLAN und eigene Info-Zettel aus dem Bondrucker', icon: '⎙', module: 'schnelldruck' },
  { to: '/kontrollen', title: 'Kontrollen', text: 'Hygieneamt, Finanzamt und weitere: Unterlagen, Temperaturprotokolle, Besuche', icon: '✓', module: 'kontrollen' },
  { to: '/erechnung', title: 'E-Rechnung', text: 'PDF-Rechnungen in ZUGFeRD umwandeln und per E-Mail versenden', icon: '✉', module: 'erechnung' },
  { to: '/internet', title: 'Internet', text: 'Internetverbindung prüfen, Geräte im Hausnetz anzeigen und benennen', icon: '⌁', module: 'internet' },
  { to: '/benutzer', title: 'Verwaltung', text: 'Benutzer, Änderungsprotokoll, Einstellungen', icon: '⚙', admin: true },
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
  // „Heute im Haus“ ist von Haus aus ausgeblendet; die Wahl merkt sich dieser Browser
  const [showToday, setShowToday] = useState(() => { try { return localStorage.getItem('pms.heute') === 'an'; } catch { return false; } });
  const toggleToday = () => { const next = !showToday; setShowToday(next); try { localStorage.setItem('pms.heute', next ? 'an' : 'aus'); } catch { /* ohne Speicher gilt die Wahl bis zum Neuladen */ } };
  const today = useLoad(() => (showToday ? api<OverviewItem[]>('GET', '/overview') : Promise.resolve(null)), [showToday]).data;
  // Logo des Hauses, falls hinterlegt (nur mit Freigabe für den Bereich Hotel abrufbar)
  const [logo, setLogo] = useState(false);
  useEffect(() => { if (hasModule(user, 'hotel')) api<{ present: boolean }>('GET', '/settings/logo-info').then((r) => setLogo(r.present)).catch(() => setLogo(false)); }, [user]);
  const tiles = TILES.filter((t) => (!t.admin || user.role === 'admin') && (!t.module || hasModule(user, t.module)));
  return (
    <div className="launcher">
      <header>
        <div className="brand big">{logo ? <img className="brandlogo" src="/api/v1/settings/logo" alt="" /> : <span className="mark">S</span>}<span>Schützenhaus<small>Hotel &amp; Restaurant</small></span></div>
        <p className="muted">{user.name} · {ROLE_LABEL[user.role]} <button type="button" className="btn" onClick={() => void logout()}>Abmelden</button></p>
      </header>
      <Search variant="big" />
      {upd?.available && <p className="notice warn">Programm-Update verfügbar: Version {upd.latest}. <Link to="/einstellungen?ansicht=update">Jetzt ansehen und einspielen</Link></p>}
      {bakWarn && <p className="notice danger">{bakWarn} <Link to="/einstellungen?ansicht=sicherung">Zur Datensicherung</Link></p>}
      <p className="todaytoggle"><button type="button" className="linkbtn" aria-expanded={showToday} onClick={toggleToday}>{showToday ? 'Heute im Haus ausblenden' : 'Heute im Haus anzeigen'}</button></p>
      {showToday && today && today.length > 0 && (
        <section className="todaystrip" aria-label="Heute im Haus">
          {today.map((t) => (
            <Link key={t.key} to={t.to} className={`todayitem ${t.tone}`}><span>{t.label}</span><b>{t.value}</b><small>{t.sub}</small></Link>
          ))}
        </section>
      )}
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
